import { app, BrowserWindow, screen } from 'electron'
import { createPetWindow, getSkinSheetPath } from './window'
import { createCenterWindow, CENTER_W, CENTER_H } from './center-window'
import { createCardWindow, CARD_W, CARD_H, CARD_GAP } from './card-window'
import { createSettingsWindow } from './settings-window'
import { createSkinWindow } from './skin-window'
import { createChannelsWindow } from './channels-window'
import { cardPosition } from '../core/card-position'
import type { CardView } from '../core/card-view'
import { needsAutoChannel, type Channel, type SourceMatch } from '../core/channel'
import { DEFAULT_SKIN_ID } from '../core/skins'
import { registerPetScheme, registerPetProtocol } from './pet-protocol'
import { findFreePort, generateToken, writeEndpointFile } from './endpoint'
import { startIngestServer } from './ingest'
import { MessageStore } from '../core/message-store'
import { bus } from './bus'
import { loadPrefs, updatePrefs } from './prefs'
import { handleCommand, handleQuery, pushTo } from '../ipc/main-helpers'
import type { AppEvent } from '../core/events'

// pet: scheme 必須在 app ready 前註冊（一次）
registerPetScheme()

const store = new MessageStore()
let petWindow: BrowserWindow | null = null
let centerWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let skinWindow: BrowserWindow | null = null
let channelsWindow: BrowserWindow | null = null
let cardWindow: BrowserWindow | null = null
let cardLoaded = false
let pendingCard: CardView | null = null
let activeCardId: string | null = null
let pendingDetailId: string | null = null
let dndEnabled = false
let channels: Channel[] = []
let knownSources: SourceMatch[] = []
let defaultSkin = DEFAULT_SKIN_ID // 啟動時快取，供自動建 channel 預設造型（避免每次讀 prefs）
let channelSeq = 0
// 上限：外部 POST 的 source.name 可變 → 防 channel / 來源池無限長 + 寫檔放大
const MAX_AUTO_CHANNELS = 64
const MAX_KNOWN_SOURCES = 200
function nextChannelId(): string {
  channelSeq += 1
  return `ch-${Date.now().toString(36)}-${channelSeq.toString(36)}`
}

function broadcastUnread(): void {
  pushTo(petWindow, 'unread-count', store.unreadCount())
}
function broadcastMessages(): void {
  pushTo(centerWindow, 'messages-updated', store.list())
}
function broadcastChannels(): void {
  pushTo(centerWindow, 'channels-updated', channels)
  pushTo(channelsWindow, 'channels-updated', channels)
}
function broadcastKnownSources() { pushTo(channelsWindow, 'known-sources-updated', knownSources) }
function persistChannels(): void {
  updatePrefs(app.getPath('userData'), { channels }) // 合併寫入，不覆蓋 window.ts 的欄位
}
function persistKnownSources() { updatePrefs(app.getPath('userData'), { knownSources }) }

function computeCenterPos(): { x: number; y: number } | undefined {
  if (!petWindow || petWindow.isDestroyed()) return undefined
  const pet = petWindow.getBounds()
  const display = screen.getDisplayMatching(pet)
  return cardPosition(pet, { width: CENTER_W, height: CENTER_H }, display.workArea, 8)
}

function openCenter(): void {
  const pos = computeCenterPos()
  if (centerWindow && !centerWindow.isDestroyed()) {
    if (pos) centerWindow.setPosition(pos.x, pos.y)
    centerWindow.focus()
    return
  }
  centerWindow = createCenterWindow(pos)
  centerWindow.on('closed', () => {
    centerWindow = null
  })
  centerWindow.webContents.once('did-finish-load', () => broadcastMessages())
}

function ensureCardWindow(): BrowserWindow {
  if (cardWindow && !cardWindow.isDestroyed()) return cardWindow
  cardLoaded = false
  cardWindow = createCardWindow()
  cardWindow.webContents.once('did-finish-load', () => {
    cardLoaded = true
    flushCard()
  })
  cardWindow.on('closed', () => {
    cardWindow = null
    cardLoaded = false
  })
  return cardWindow
}

// 若卡片可見，依寵物 bounds 重新定位卡片並置頂（兩窗同為 floating，需 moveTop 保證在寵物上）
function repositionCard(): void {
  if (!cardWindow || cardWindow.isDestroyed() || !cardWindow.isVisible()) return
  if (!petWindow || petWindow.isDestroyed()) return
  const pet = petWindow.getBounds()
  const display = screen.getDisplayMatching(pet)
  const pos = cardPosition(pet, { width: CARD_W, height: CARD_H }, display.workArea, CARD_GAP)
  cardWindow.setPosition(pos.x, pos.y)
  cardWindow.moveTop()
}

function flushCard(): void {
  if (!pendingCard || !cardWindow || cardWindow.isDestroyed()) return
  pushTo(cardWindow, 'card-data', pendingCard)
  cardWindow.showInactive() // 顯示但不搶焦點
  repositionCard()
  pendingCard = null
}

app.whenReady().then(async () => {
  registerPetProtocol(getSkinSheetPath) // 在任何載入 pet: 的視窗前
  petWindow = createPetWindow()
  petWindow.on('closed', () => {
    if (cardWindow && !cardWindow.isDestroyed()) cardWindow.close()
  })

  const startupPrefs = loadPrefs(app.getPath('userData'))
  dndEnabled = startupPrefs.dnd
  channels = startupPrefs.channels
  knownSources = startupPrefs.knownSources
  defaultSkin = startupPrefs.skin
  bus.on('dnd-changed', (enabled: boolean) => {
    dndEnabled = enabled
  })

  const port = await findFreePort()
  const token = generateToken()
  writeEndpointFile(app.getPath('userData'), { port, token })

  startIngestServer({
    port,
    token,
    onEvent: (event: AppEvent) => {
      store.push(event)
      autoDetectChannel(event.source)
      broadcastUnread()
      broadcastMessages()
      if (dndEnabled) return // 勿擾模式：不彈卡片、不演反應動畫
      pushTo(petWindow, 'pet-event', event)
    },
  })

  handleCommand('mark-read', (id) => {
    store.markRead(id)
    broadcastUnread()
    broadcastMessages()
  })
  handleCommand('mark-all-read', () => {
    store.markAllRead()
    broadcastUnread()
    broadcastMessages()
  })
  handleCommand('clear-messages', () => {
    store.clear()
    broadcastUnread()
    broadcastMessages()
  })
  handleQuery('get-messages', () => store.list())
  handleQuery('get-channels', () => channels)
  handleQuery('get-known-sources', () => knownSources)
  handleCommand('channel-upsert', (ch) => {
    // 空 id → 新建（main 指派 id，renderer 不產 id）；否則依 id 覆蓋
    const withId: Channel = ch.id ? ch : { ...ch, id: nextChannelId() }
    const i = channels.findIndex((c) => c.id === withId.id)
    if (i >= 0) channels[i] = withId
    else channels = [...channels, withId]
    persistChannels()
    broadcastChannels()
    broadcastMessages() // 讓中心分頁重算
  })
  handleCommand('channel-delete', ({ id }) => {
    channels = channels.filter((c) => c.id !== id)
    persistChannels()
    broadcastChannels()
    broadcastMessages()
  })

  handleCommand('show-card', (view) => {
    activeCardId = view.id
    pendingCard = view
    ensureCardWindow()
    if (cardLoaded) flushCard()
    // 未載入完成則由 did-finish-load → flushCard 處理
  })
  handleCommand('hide-card', () => {
    activeCardId = null
    pendingCard = null
    if (cardWindow && !cardWindow.isDestroyed()) cardWindow.hide()
  })
  handleCommand('card-clicked', ({ id }) => {
    if (id !== activeCardId) return // 舊卡片殘留點擊：忽略
    activeCardId = null
    if (cardWindow && !cardWindow.isDestroyed()) cardWindow.hide()
    pushTo(petWindow, 'card-dismissed', { id })
  })
  handleCommand('card-more', ({ id }) => {
    if (id !== activeCardId) return
    activeCardId = null
    if (cardWindow && !cardWindow.isDestroyed()) cardWindow.hide()
    pushTo(petWindow, 'card-dismissed', { id }) // pet renderer 照常 markRead + 清理
    pendingDetailId = id
    openCenter()
    pushTo(centerWindow, 'open-detail') // 已開窗 → 觸發重查；新開窗靠載入時 query
  })
  handleQuery('get-pending-detail', () => {
    const id = pendingDetailId
    pendingDetailId = null
    return { id }
  })

  bus.on('pet-moved', repositionCard) // 拖動 / display-removed 重吸附後同步卡片
  screen.on('display-metrics-changed', repositionCard) // 解析度 / 排列變更

  bus.on('open-center', openCenter)
  bus.on('open-settings', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus()
      return
    }
    settingsWindow = createSettingsWindow()
    settingsWindow.on('closed', () => {
      settingsWindow = null
    })
  })
  bus.on('open-skins', () => {
    if (skinWindow && !skinWindow.isDestroyed()) {
      skinWindow.focus()
      return
    }
    skinWindow = createSkinWindow()
    skinWindow.on('closed', () => {
      skinWindow = null
    })
  })
  bus.on('open-channels', () => {
    if (channelsWindow && !channelsWindow.isDestroyed()) {
      channelsWindow.focus()
      return
    }
    channelsWindow = createChannelsWindow()
    channelsWindow.on('closed', () => {
      channelsWindow = null
    })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) petWindow = createPetWindow()
  })
})

function autoDetectChannel(source: { kind: string; name?: string }): void {
  // 收集已知來源池（去重）
  const key = `${source.kind} ${source.name ?? ''}`
  if (knownSources.length < MAX_KNOWN_SOURCES && !knownSources.some((s) => `${s.kind ?? ''} ${s.name ?? ''}` === key)) {
    const sm: SourceMatch = { kind: source.kind }
    if (source.name) sm.name = source.name
    knownSources = [...knownSources, sm]
    persistKnownSources()
    broadcastKnownSources()
  }
  // 自動建 channel（沒有任何既有 channel 命中、且未達上限）
  if (channels.length >= MAX_AUTO_CHANNELS) return
  if (!needsAutoChannel(source, channels)) return
  const member: SourceMatch = { kind: source.kind }
  if (source.name) member.name = source.name
  channels = [...channels, { id: nextChannelId(), name: source.name || source.kind, skin: defaultSkin, enabled: false, members: [member] }]
  persistChannels()
  broadcastChannels()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
