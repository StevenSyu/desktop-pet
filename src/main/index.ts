import { app, BrowserWindow, screen } from 'electron'
import { createPetWindow, getSkinSheetPath, getPetWindow, petChannelIds, closePetWindow, builtinRoot, setSkinSheetPaths } from './window'
import { createCenterWindow, CENTER_W, CENTER_H } from './center-window'
import { createCardWindow, CARD_W, CARD_H, CARD_GAP } from './card-window'
import { createSettingsWindow } from './settings-window'
import { createSkinWindow } from './skin-window'
import { createChannelsWindow } from './channels-window'
import { cardPosition } from '../core/card-position'
import type { CardView } from '../core/card-view'
import { matchingChannels, needsAutoChannel, unreadByChannel, type Channel, type SourceMatch } from '../core/channel'
import { DEFAULT_SKIN_ID } from '../core/skins'
import { registerPetScheme, registerPetProtocol } from './pet-protocol'
import { findFreePort, generateToken, writeEndpointFile } from './endpoint'
import { startIngestServer } from './ingest'
import { MessageStore } from '../core/message-store'
import { bus } from './bus'
import { loadPrefs, updatePrefs } from './prefs'
import { handleCommand, handleQuery, pushTo } from '../ipc/main-helpers'
import type { AppEvent } from '../core/events'
import { scanSkins } from './skin-registry'

// pet: scheme 必須在 app ready 前註冊（一次）
registerPetScheme()

const store = new MessageStore()
let centerWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let skinWindow: BrowserWindow | null = null
let channelsWindow: BrowserWindow | null = null
interface CardState { win: BrowserWindow; loaded: boolean; pending: CardView | null; activeId: string | null }
const cardWindows = new Map<string, CardState>()
let pendingDetailId: string | null = null
let pendingChannelTab: string | null = null
let dndEnabled = false
let allEnabled = true
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

function skinFor(channelId: string): string {
  if (channelId === 'all') return loadPrefs(app.getPath('userData')).skin
  const ch = channels.find((c) => c.id === channelId)
  return ch ? ch.skin : DEFAULT_SKIN_ID
}

// 應存在的寵物集合：allEnabled?'all' + 啟用 channel；空則強制留 'all'（≥1 防鎖死）
function desiredPetIds(): string[] {
  const ids = [...(allEnabled ? ['all'] : []), ...channels.filter((c) => c.enabled).map((c) => c.id)]
  return ids.length > 0 ? ids : ['all']
}

function reconcilePets(): void {
  const desired = desiredPetIds()
  const want = new Set(desired)
  for (const id of petChannelIds()) if (!want.has(id)) {
    const cs = cardWindows.get(id)
    if (cs && !cs.win.isDestroyed()) cs.win.close()
    closePetWindow(id)
  }
  desired.forEach((id, index) => {
    if (!getPetWindow(id)) {
      createPetWindow(id, skinFor(id), index)
    }
  })
}

function broadcastUnread(): void {
  const counts = unreadByChannel(store.list(), channels)
  for (const id of petChannelIds()) {
    pushTo(getPetWindow(id), 'unread-count', id === 'all' ? counts.all : (counts[id] ?? 0))
  }
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

function scanAvailableSkins(): ReturnType<typeof scanSkins> {
  const result = scanSkins(app.getPath('userData'), builtinRoot())
  setSkinSheetPaths(result.sheetPaths)
  return result
}

function upsertChannel(ch: Channel): Channel {
  // 空 id → 新建（main 指派 id，renderer 不產 id）；否則依 id 覆蓋
  const withId: Channel = ch.id ? ch : { ...ch, id: nextChannelId() }
  const i = channels.findIndex((c) => c.id === withId.id)
  if (i >= 0) channels[i] = withId
  else channels = [...channels, withId]
  persistChannels()
  broadcastChannels()
  broadcastMessages() // 讓中心分頁重算
  reconcilePets()
  pushTo(getPetWindow(withId.id), 'set-skin', withId.skin) // 既有寵物的造型即時更新（新建的由 did-finish-load 推）
  broadcastUnread()
  return withId
}

function computeCenterPos(): { x: number; y: number } | undefined {
  const all = getPetWindow('all')
  if (!all) return undefined
  const pet = all.getBounds()
  const display = screen.getDisplayMatching(pet)
  return cardPosition(pet, { width: CENTER_W, height: CENTER_H }, display.workArea, 8)
}

function openCenter(channelTab?: string): void {
  if (channelTab) pendingChannelTab = channelTab
  const pos = computeCenterPos()
  if (centerWindow && !centerWindow.isDestroyed()) {
    if (pos) centerWindow.setPosition(pos.x, pos.y)
    centerWindow.focus()
    pushTo(centerWindow, 'open-channel-tab')
    return
  }
  centerWindow = createCenterWindow(pos)
  centerWindow.on('closed', () => {
    centerWindow = null
  })
  centerWindow.webContents.once('did-finish-load', () => broadcastMessages())
  pushTo(centerWindow, 'open-channel-tab')
}

function ensureCard(channelId: string): CardState {
  const existing = cardWindows.get(channelId)
  if (existing && !existing.win.isDestroyed()) return existing
  const win = createCardWindow(channelId)
  const cs: CardState = { win, loaded: false, pending: null, activeId: null }
  cardWindows.set(channelId, cs)
  win.webContents.once('did-finish-load', () => {
    cs.loaded = true
    flushCard(channelId)
  })
  win.on('closed', () => {
    if (cardWindows.get(channelId) === cs) cardWindows.delete(channelId)
  })
  return cs
}

// 若卡片可見，依寵物 bounds 重新定位卡片並置頂（兩窗同為 floating，需 moveTop 保證在寵物上）
function repositionCard(channelId: string): void {
  const cs = cardWindows.get(channelId)
  const pet = getPetWindow(channelId)
  if (!cs || cs.win.isDestroyed() || !cs.win.isVisible() || !pet) return
  const display = screen.getDisplayMatching(pet.getBounds())
  const pos = cardPosition(pet.getBounds(), { width: CARD_W, height: CARD_H }, display.workArea, CARD_GAP)
  cs.win.setPosition(pos.x, pos.y)
  cs.win.moveTop()
}

function flushCard(channelId: string): void {
  const cs = cardWindows.get(channelId)
  if (!cs || !cs.pending || cs.win.isDestroyed()) return
  pushTo(cs.win, 'card-data', cs.pending)
  cs.win.showInactive() // 顯示但不搶焦點
  repositionCard(channelId)
  cs.pending = null
}

app.whenReady().then(async () => {
  registerPetProtocol(getSkinSheetPath) // 在任何載入 pet: 的視窗前
  const startupPrefs = loadPrefs(app.getPath('userData'))
  dndEnabled = startupPrefs.dnd
  allEnabled = startupPrefs.allEnabled
  channels = startupPrefs.channels
  knownSources = startupPrefs.knownSources
  defaultSkin = startupPrefs.skin
  reconcilePets()
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
      const targets = new Set<string>([...(allEnabled ? ['all'] : []), ...matchingChannels(event.source, channels)])
      for (const id of targets) pushTo(getPetWindow(id), 'pet-event', event)
    },
  })

  handleCommand('mark-read', (id) => {
    store.markRead(id)
    broadcastUnread()
    broadcastMessages()
  })
  handleCommand('mark-read-ids', (ids) => {
    for (const id of ids) store.markRead(id)
    broadcastUnread()
    broadcastMessages()
  })
  handleCommand('clear-messages', () => {
    store.clear()
    broadcastUnread()
    broadcastMessages()
  })
  handleQuery('get-messages', () => store.list())
  handleQuery('get-skins', ({ channelId }) => {
    const { skins, sheetPaths } = scanAvailableSkins()
    const requestedId = skinFor(channelId)
    return { skins, requestedId, effectiveId: sheetPaths.has(requestedId) ? requestedId : DEFAULT_SKIN_ID }
  })
  handleQuery('select-skin', ({ channelId, id }) => {
    const { sheetPaths } = scanAvailableSkins()
    if (!sheetPaths.has(id)) {
      const cur = skinFor(channelId)
      return { ok: false, effectiveId: sheetPaths.has(cur) ? cur : DEFAULT_SKIN_ID }
    }
    if (channelId === 'all') {
      const nextPrefs = updatePrefs(app.getPath('userData'), { skin: id })
      defaultSkin = id
      pushTo(getPetWindow('all'), 'set-skin', id)
      for (const petId of petChannelIds()) pushTo(getPetWindow(petId), 'prefs-changed', nextPrefs)
      pushTo(channelsWindow, 'default-skin-updated', id)
    } else {
      const ch = channels.find((c) => c.id === channelId)
      if (ch) upsertChannel({ ...ch, skin: id })
    }
    return { ok: true, effectiveId: id }
  })
  handleQuery('get-default-skin', () => loadPrefs(app.getPath('userData')).skin)
  handleQuery('get-channels', () => channels)
  handleQuery('get-known-sources', () => knownSources)
  handleCommand('channel-upsert', (ch) => {
    upsertChannel(ch)
  })
  handleCommand('channel-delete', ({ id }) => {
    channels = channels.filter((c) => c.id !== id)
    persistChannels()
    broadcastChannels()
    broadcastMessages()
    reconcilePets()
    broadcastUnread()
  })
  handleQuery('get-all-enabled', () => allEnabled)
  handleCommand('set-all-enabled', (v) => {
    allEnabled = v
    updatePrefs(app.getPath('userData'), { allEnabled })
    pushTo(channelsWindow, 'all-enabled-updated', allEnabled)
    reconcilePets()
    broadcastUnread()
  })
  handleCommand('open-skin-picker', ({ channelId }) => bus.emit('open-skins', channelId))

  handleCommand('show-card', ({ channelId, view }) => {
    const cs = ensureCard(channelId)
    cs.activeId = view.id
    cs.pending = view
    if (cs.loaded) flushCard(channelId)
    // 未載入完成則由 did-finish-load → flushCard 處理
  })
  handleCommand('hide-card', ({ channelId }) => {
    const cs = cardWindows.get(channelId)
    if (!cs) return
    cs.activeId = null
    cs.pending = null
    if (!cs.win.isDestroyed()) cs.win.hide()
  })
  handleCommand('card-clicked', ({ channelId, id }) => {
    const cs = cardWindows.get(channelId)
    if (!cs || id !== cs.activeId) return
    cs.activeId = null
    if (!cs.win.isDestroyed()) cs.win.hide()
    pushTo(getPetWindow(channelId), 'card-dismissed', { id })
  })
  handleCommand('card-more', ({ channelId, id }) => {
    const cs = cardWindows.get(channelId)
    if (!cs || id !== cs.activeId) return
    cs.activeId = null
    if (!cs.win.isDestroyed()) cs.win.hide()
    pushTo(getPetWindow(channelId), 'card-dismissed', { id })
    pendingDetailId = id
    openCenter(channelId) // 開該頻道分頁 + 詳情
    pushTo(centerWindow, 'open-detail') // 已開窗 → 觸發重查；新開窗靠載入時 query
  })
  handleQuery('get-pending-detail', () => {
    const id = pendingDetailId
    pendingDetailId = null
    return { id }
  })
  handleQuery('get-pending-channel-tab', () => {
    const t = pendingChannelTab
    pendingChannelTab = null
    return t
  })

  bus.on('pet-moved', (channelId: string) => repositionCard(channelId)) // 拖動 / display-removed 重吸附後同步卡片
  screen.on('display-metrics-changed', () => { for (const id of cardWindows.keys()) repositionCard(id) }) // 解析度 / 排列變更

  bus.on('open-center', (channelId?: string) => openCenter(channelId))
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
  bus.on('open-skins', (channelId: string = 'all') => {
    if (skinWindow && !skinWindow.isDestroyed()) {
      const oldWindow = skinWindow
      skinWindow = null
      oldWindow.close()
    }
    skinWindow = createSkinWindow(channelId)
    const currentWindow = skinWindow
    currentWindow.on('closed', () => {
      if (skinWindow === currentWindow) skinWindow = null
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
    if (BrowserWindow.getAllWindows().length === 0) reconcilePets()
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
