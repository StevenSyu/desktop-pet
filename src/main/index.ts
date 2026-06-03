import { app, BrowserWindow, screen } from 'electron'
import { createPetWindow, getSkinSheetPath, getPetWindow, petChannelIds, closePetWindow, builtinRoot, setSkinSheetPaths } from './window'
import { createCenterWindow, CENTER_W, CENTER_H } from './center-window'
import { createCardWindow, CARD_W, CARD_H, CARD_GAP, CARD_SHADOW_PAD } from './card-window'
import { createSettingsWindow } from './settings-window'
import { createSkinWindow } from './skin-window'
import { createChannelsWindow } from './channels-window'
import { loadWindowStates, saveWindowState } from './window-state'
import type { CardView } from '../core/card-view'
import { matchingChannels, unreadByChannel, activePetCount, applySourceEvent, healKnownKinds, healSkins, type Channel, type SourceMatch } from '../core/channel'
import { cardWindowBounds } from '../core/card-layout'
import { resolveCenterPos } from '../core/center-pos'
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
interface CardState {
  win: BrowserWindow
  loaded: boolean
  pending: CardView | null
  activeId: string | null
  dragOffset: { x: number; y: number } | null
}
type PetBounds = { x: number; y: number; width: number; height: number }
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
  const ids = [...(allEnabled ? ['all'] : []), ...channels.filter((c) => c.enabled && c.showPet).map((c) => c.id)]
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

function applyAllEnabled(v: boolean): void {
  allEnabled = v
  updatePrefs(app.getPath('userData'), { allEnabled })
  pushTo(channelsWindow, 'all-enabled-updated', allEnabled)
  reconcilePets()
  broadcastUnread()
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

// 啟動時修正失效造型：channel.skin / prefs.skin 指向已不存在的造型時，桌面寵物會 fallback
// 預設 may，但設定頁仍顯示舊造型名 → 兩邊不一致（#7）。改成把失效造型回正成預設並持久化，
// 確保「設定頁顯示」與「桌面實際」一致。
function healInvalidSkins(): void {
  const { sheetPaths } = scanAvailableSkins()
  const healed = healSkins(channels, new Set(sheetPaths.keys()), DEFAULT_SKIN_ID)
  if (healed) {
    channels = healed
    persistChannels()
    broadcastChannels()
  }
  if (!sheetPaths.has(defaultSkin)) {
    defaultSkin = DEFAULT_SKIN_ID
    updatePrefs(app.getPath('userData'), { skin: DEFAULT_SKIN_ID })
  }
}

function healKnownKindSources(): void {
  // 啟動時補齊既有來源缺的 kind 整類項（決策在 core 的 healKnownKinds）
  const healed = healKnownKinds(knownSources, MAX_KNOWN_SOURCES)
  if (healed) {
    knownSources = healed
    persistKnownSources()
    broadcastKnownSources()
  }
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
  // 決策在 core 的 resolveCenterPos：記住的位置仍有效則沿用，否則開在「全部」寵物那一側
  const saved = loadWindowStates(app.getPath('userData'))['center']
  const all = getPetWindow('all')
  const pet = all ? { bounds: all.getBounds(), workArea: screen.getDisplayMatching(all.getBounds()).workArea } : undefined
  return resolveCenterPos(
    saved,
    { width: CENTER_W, height: CENTER_H },
    screen.getAllDisplays().map((d) => d.workArea),
    pet,
  )
}

let centerSaveTimer: ReturnType<typeof setTimeout> | null = null
function saveCenterPos(): void {
  if (!centerWindow || centerWindow.isDestroyed()) return
  const b = centerWindow.getBounds()
  const d = screen.getDisplayMatching(b)
  saveWindowState(app.getPath('userData'), 'center', { displayId: d.id, x: b.x, y: b.y, scale: 1 })
}
// 'move' 拖動中頻繁觸發 → debounce，停下 250ms 才寫檔
function scheduleCenterSave(): void {
  if (centerSaveTimer) clearTimeout(centerSaveTimer)
  centerSaveTimer = setTimeout(saveCenterPos, 250)
}

function openCenter(channelTab?: string): void {
  if (channelTab) pendingChannelTab = channelTab
  if (centerWindow && !centerWindow.isDestroyed()) {
    centerWindow.focus() // 已開：保持使用者拖曳的位置，不重新定位
    pushTo(centerWindow, 'open-channel-tab')
    return
  }
  centerWindow = createCenterWindow(computeCenterPos())
  centerWindow.on('move', scheduleCenterSave) // 拖動時記住位置（debounce 寫檔）
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
  const cs: CardState = { win, loaded: false, pending: null, activeId: null, dragOffset: null }
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
function repositionCard(channelId: string, bringToFront = true, movedBounds?: PetBounds): void {
  const cs = cardWindows.get(channelId)
  const pet = getPetWindow(channelId)
  if (!cs || cs.win.isDestroyed() || !cs.win.isVisible() || !pet) return
  const petBounds = movedBounds ?? pet.getBounds()
  const workArea = screen.getDisplayMatching(petBounds).workArea
  // 幾何決策在 core 的 cardWindowBounds（drag 同步偏移 / 可見卡翻轉定位 + 陰影外擴）
  cs.win.setBounds(
    cardWindowBounds(petBounds, workArea, { width: CARD_W, height: CARD_H, shadowPad: CARD_SHADOW_PAD, gap: CARD_GAP }, cs.dragOffset),
  )
  if (!cs.dragOffset && bringToFront) cs.win.moveTop()
}

function startCardDragSync(channelId: string): void {
  const cs = cardWindows.get(channelId)
  const pet = getPetWindow(channelId)
  if (!cs || cs.win.isDestroyed() || !cs.win.isVisible() || !pet) return
  repositionCard(channelId, false)
  const cardBounds = cs.win.getBounds()
  const petBounds = pet.getBounds()
  cs.dragOffset = {
    x: cardBounds.x - petBounds.x,
    y: cardBounds.y - petBounds.y,
  }
}

function endCardDragSync(channelId: string): void {
  const cs = cardWindows.get(channelId)
  if (!cs) return
  cs.dragOffset = null
}

function flushCard(channelId: string): void {
  const cs = cardWindows.get(channelId)
  if (!cs || !cs.pending || cs.win.isDestroyed()) return
  pushTo(cs.win, 'card-data', cs.pending)
  cs.win.showInactive() // 顯示但不搶焦點
  repositionCard(channelId)
  cs.pending = null
}

// 關閉所有顯示同一訊息（同 event id）的卡片：同訊息可能在多隻寵物各彈一張，
// 點關一張即連帶關掉其餘同 id 的，並通知各自寵物標已讀。
function dismissCardsById(id: string): void {
  for (const [cid, cs] of cardWindows) {
    if (cs.activeId !== id) continue
    cs.activeId = null
    if (!cs.win.isDestroyed()) cs.win.hide()
    pushTo(getPetWindow(cid), 'card-dismissed', { id })
  }
}

app.whenReady().then(async () => {
  registerPetProtocol(getSkinSheetPath) // 在任何載入 pet: 的視窗前
  const startupPrefs = loadPrefs(app.getPath('userData'))
  dndEnabled = startupPrefs.dnd
  allEnabled = startupPrefs.allEnabled
  channels = startupPrefs.channels
  knownSources = startupPrefs.knownSources
  defaultSkin = startupPrefs.skin
  healInvalidSkins() // 失效造型回正成預設，避免桌面 fallback 與設定頁顯示不一致（#7）
  healKnownKindSources() // 補齊既有來源缺的 kind 整類項（早於整類邏輯記錄的舊來源）
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
      for (const id of targets) {
        const win = getPetWindow(id)
        if (!win || win.isDestroyed()) continue
        if (win.webContents.isLoading()) {
          // 剛由 autoDetect/死角 reconcile 長出的寵物還在載入，等 renderer 掛好 listener 再推，
          // 否則首訊息會丟失（寵物跳出來但不演、也不彈卡）。
          win.webContents.once('did-finish-load', () => {
            if (!win.isDestroyed()) pushTo(win, 'pet-event', event)
          })
        } else {
          pushTo(win, 'pet-event', event)
        }
      }
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
  handleCommand('remove-known-source', (s) => {
    const key = `${s.kind ?? ''} ${s.name ?? ''}`
    knownSources = knownSources.filter((k) => `${k.kind ?? ''} ${k.name ?? ''}` !== key)
    persistKnownSources()
    broadcastKnownSources()
  })
  handleQuery('get-all-enabled', () => allEnabled)
  handleCommand('set-all-enabled', (v) => applyAllEnabled(v))
  handleCommand('open-skin-picker', ({ channelId }) => bus.emit('open-skins', channelId))
  // 快速關閉目前頻道的寵物（右鍵選單）：停用該頻道（'all' → allEnabled false）。
  // 防呆保險：至少保留一隻（選單項已 disable，這裡再擋一次避免 race）。
  bus.on('close-pet', (channelId: string) => {
    if (activePetCount(channels, allEnabled) <= 1) return
    if (channelId === 'all') {
      applyAllEnabled(false)
    } else {
      const ch = channels.find((c) => c.id === channelId)
      if (ch) upsertChannel({ ...ch, showPet: false }) // 只關寵物顯示，頻道仍啟用（分頁/分類照常）
    }
  })

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
  handleCommand('card-clicked', ({ id }) => {
    dismissCardsById(id) // 點關一張 → 連帶關掉所有顯示同一訊息的卡片
  })
  handleCommand('card-more', ({ channelId, id }) => {
    dismissCardsById(id) // 同上：開詳情前先關掉所有同 id 卡片
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

  bus.on('pet-drag-start', (channelId: string) => startCardDragSync(channelId))
  bus.on('pet-drag-end', (channelId: string) => endCardDragSync(channelId))

  bus.on('pet-moved', (channelId: string, bounds?: PetBounds) => repositionCard(channelId, false, bounds)) // 拖動 / display-removed 重吸附後同步卡片
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
  // 決策全在 core 的 applySourceEvent（已知來源補登／自動建啟用頻道跳專屬寵物／死角兜底），
  // 此處只套用結果並依 flags 執行副作用。
  const r = applySourceEvent(
    { channels, knownSources, allEnabled },
    source,
    { defaultSkin, nextId: nextChannelId, maxKnown: MAX_KNOWN_SOURCES, maxAuto: MAX_AUTO_CHANNELS },
  )
  channels = r.state.channels
  knownSources = r.state.knownSources
  if (r.knownChanged) {
    persistKnownSources()
    broadcastKnownSources()
  }
  if (r.channelsChanged) {
    persistChannels()
    broadcastChannels()
  }
  if (r.petsChanged) {
    reconcilePets() // 立刻長出該寵物，當下訊息隨後（onEvent 路由）演到它身上
    broadcastUnread()
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
