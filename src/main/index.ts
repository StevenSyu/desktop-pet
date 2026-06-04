import { app, BrowserWindow, screen } from 'electron'
import { createPetWindow, getSkinSheetPath, getPetWindow, petChannelIds, closePetWindow, builtinRoot, setSkinSheetPaths } from './window'
import {
  makeOpener,
  createCenterWindow, CENTER_W, CENTER_H,
  createCardWindow, CARD_W, CARD_H, CARD_GAP, CARD_SHADOW_PAD,
  createSettingsWindow,
  createSkinWindow,
  createChannelsWindow,
} from './window-factory'
import { loadWindowStates, saveWindowState } from './window-state'
import { cardReduce, initialCardState, type CardEvent, type CardCommand, type CardLifecycleState } from '../core/card-lifecycle'
import { matchingChannels, unreadByChannel, activePetCount, applySourceEvent, healKnownKinds, healSkins, type Channel, type SourceMatch } from '../core/channel'
import { desiredPetIds, diffFleet } from '../core/pet-fleet'
import { cardWindowBounds } from '../core/card-layout'
import { resolveCenterPos } from '../core/center-pos'
import { DEFAULT_SKIN_ID } from '../core/skins'
import { registerPetScheme, registerPetProtocol } from './pet-protocol'
import { findFreePort, generateToken, writeEndpointFile } from './endpoint'
import { startIngestServer } from './ingest'
import { MessageStore } from '../core/message-store'
import { bus } from './bus'
import { getPrefs, updatePrefsStore, subscribePrefs } from './prefs-store'
import { handleCommand, handleQuery, pushTo } from '../ipc/main-helpers'
import type { AppEvent } from '../core/events'
import { scanSkins } from './skin-registry'

// pet: scheme 必須在 app ready 前註冊（一次）
registerPetScheme()

const store = new MessageStore()
let centerWindow: BrowserWindow | null = null
// 單例工具窗：已開則 focus；造型挑選改關舊開新（頻道參數可能不同）
const settingsOpener = makeOpener(createSettingsWindow)
const skinOpener = makeOpener(createSkinWindow, { replace: true })
const channelsOpener = makeOpener(createChannelsWindow)
interface CardState {
  win: BrowserWindow
  state: CardLifecycleState // show/loaded/hide/dismiss 時序決策在 core 的 cardReduce
  dragOffset: { x: number; y: number } | null
}
type PetBounds = { x: number; y: number; width: number; height: number }
const cardWindows = new Map<string, CardState>()
let pendingDetailId: string | null = null
let pendingChannelTab: string | null = null
let channelSeq = 0

// 頻道目錄無鏡像 globals：讀走 getPrefs()、寫走 updatePrefsStore，
// persist+broadcast 配對由此訂閱統一處理（與 window.ts 的 prefs-changed 訂閱同模式）
subscribePrefs((p, changed) => {
  if (changed.has('channels')) broadcastChannels()
  if (changed.has('knownSources')) broadcastKnownSources()
  if (changed.has('allEnabled')) pushTo(channelsOpener.current(), 'all-enabled-updated', p.allEnabled)
})
// 上限：外部 POST 的 source.name 可變 → 防 channel / 來源池無限長 + 寫檔放大
const MAX_AUTO_CHANNELS = 64
const MAX_KNOWN_SOURCES = 200
function nextChannelId(): string {
  channelSeq += 1
  return `ch-${Date.now().toString(36)}-${channelSeq.toString(36)}`
}

function skinFor(channelId: string): string {
  if (channelId === 'all') return getPrefs().skin
  const ch = getPrefs().channels.find((c) => c.id === channelId)
  return ch ? ch.skin : DEFAULT_SKIN_ID
}

function reconcilePets(): void {
  // 差集決策在 core 的 desiredPetIds/diffFleet，此處只執行視窗開關副作用
  const d = diffFleet(petChannelIds(), desiredPetIds(getPrefs().channels, getPrefs().allEnabled))
  for (const id of d.close) {
    const cs = cardWindows.get(id)
    if (cs && !cs.win.isDestroyed()) cs.win.close()
    closePetWindow(id)
  }
  for (const { id, index } of d.create) {
    createPetWindow(id, skinFor(id), index)
  }
}

function applyAllEnabled(v: boolean): void {
  updatePrefsStore({ allEnabled: v }) // all-enabled-updated push 由訂閱處理
  reconcilePets()
  broadcastUnread()
}

function broadcastUnread(): void {
  const counts = unreadByChannel(store.list(), getPrefs().channels)
  for (const id of petChannelIds()) {
    pushTo(getPetWindow(id), 'unread-count', id === 'all' ? counts.all : (counts[id] ?? 0))
  }
}
function broadcastMessages(): void {
  pushTo(centerWindow, 'messages-updated', store.list())
}
function broadcastChannels(): void {
  pushTo(centerWindow, 'channels-updated', getPrefs().channels)
  pushTo(channelsOpener.current(), 'channels-updated', getPrefs().channels)
}
function broadcastKnownSources() { pushTo(channelsOpener.current(), 'known-sources-updated', getPrefs().knownSources) }

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
  const healed = healSkins(getPrefs().channels, new Set(sheetPaths.keys()), DEFAULT_SKIN_ID)
  if (healed) updatePrefsStore({ channels: healed })
  if (!sheetPaths.has(getPrefs().skin)) updatePrefsStore({ skin: DEFAULT_SKIN_ID })
}

function healKnownKindSources(): void {
  // 啟動時補齊既有來源缺的 kind 整類項（決策在 core 的 healKnownKinds）
  const healed = healKnownKinds(getPrefs().knownSources, MAX_KNOWN_SOURCES)
  if (healed) updatePrefsStore({ knownSources: healed })
}

function upsertChannel(ch: Channel): Channel {
  // 空 id → 新建（main 指派 id，renderer 不產 id）；否則依 id 覆蓋
  const withId: Channel = ch.id ? ch : { ...ch, id: nextChannelId() }
  const channels = getPrefs().channels
  const i = channels.findIndex((c) => c.id === withId.id)
  const next = i >= 0 ? channels.map((c, idx) => (idx === i ? withId : c)) : [...channels, withId]
  updatePrefsStore({ channels: next }) // channels-updated broadcast 由訂閱處理
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
  const cs: CardState = { win, state: { ...initialCardState }, dragOffset: null }
  cardWindows.set(channelId, cs)
  win.webContents.once('did-finish-load', () => dispatchCard(channelId, { kind: 'loaded' }))
  win.on('closed', () => {
    if (cardWindows.get(channelId) === cs) cardWindows.delete(channelId)
  })
  return cs
}

function execCardCommand(channelId: string, cs: CardState, cmd: CardCommand): void {
  switch (cmd.type) {
    case 'flush':
      if (cs.win.isDestroyed()) return
      pushTo(cs.win, 'card-data', cmd.view)
      cs.win.showInactive() // 顯示但不搶焦點
      repositionCard(channelId)
      break
    case 'hide':
      if (!cs.win.isDestroyed()) cs.win.hide()
      break
    case 'notifyDismissed':
      pushTo(getPetWindow(channelId), 'card-dismissed', { id: cmd.id })
      break
  }
}

function dispatchCard(channelId: string, event: CardEvent): void {
  const cs = cardWindows.get(channelId)
  if (!cs) return
  const r = cardReduce(cs.state, event)
  cs.state = r.state
  for (const cmd of r.commands) execCardCommand(channelId, cs, cmd)
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

// 關閉所有顯示同一訊息（同 event id）的卡片：同訊息可能在多隻寵物各彈一張，
// 點關一張即連帶關掉其餘同 id 的，並通知各自寵物標已讀（id 比對在 cardReduce）。
function dismissCardsById(id: string): void {
  for (const cid of cardWindows.keys()) dispatchCard(cid, { kind: 'dismiss', id })
}

app.whenReady().then(async () => {
  registerPetProtocol(getSkinSheetPath) // 在任何載入 pet: 的視窗前
  healInvalidSkins() // 失效造型回正成預設，避免桌面 fallback 與設定頁顯示不一致（#7）
  healKnownKindSources() // 補齊既有來源缺的 kind 整類項（早於整類邏輯記錄的舊來源）
  reconcilePets()

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
      const p = getPrefs()
      if (p.dnd) return // 勿擾模式：不彈卡片、不演反應動畫
      const targets = new Set<string>([...(p.allEnabled ? ['all'] : []), ...matchingChannels(event.source, p.channels)])
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
  handleCommand('clear-messages', (ids) => {
    store.removeByIds(ids)
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
      updatePrefsStore({ skin: id }) // prefs-changed broadcast 由 window.ts 的 subscribePrefs 統一處理
      pushTo(getPetWindow('all'), 'set-skin', id)
      pushTo(channelsOpener.current(), 'default-skin-updated', id)
    } else {
      const ch = getPrefs().channels.find((c) => c.id === channelId)
      if (ch) upsertChannel({ ...ch, skin: id })
    }
    return { ok: true, effectiveId: id }
  })
  handleQuery('get-default-skin', () => getPrefs().skin)
  handleQuery('get-channels', () => getPrefs().channels)
  handleQuery('get-known-sources', () => getPrefs().knownSources)
  handleCommand('channel-upsert', (ch) => {
    upsertChannel(ch)
  })
  handleCommand('channel-delete', ({ id }) => {
    updatePrefsStore({ channels: getPrefs().channels.filter((c) => c.id !== id) })
    broadcastMessages()
    reconcilePets()
    broadcastUnread()
  })
  handleCommand('remove-known-source', (s) => {
    const key = `${s.kind ?? ''} ${s.name ?? ''}`
    updatePrefsStore({ knownSources: getPrefs().knownSources.filter((k) => `${k.kind ?? ''} ${k.name ?? ''}` !== key) })
  })
  handleQuery('get-all-enabled', () => getPrefs().allEnabled)
  handleCommand('set-all-enabled', (v) => applyAllEnabled(v))
  handleCommand('open-skin-picker', ({ channelId }) => bus.emit('open-skins', channelId))
  // 快速關閉目前頻道的寵物（右鍵選單）：停用該頻道（'all' → allEnabled false）。
  // 防呆保險：至少保留一隻（選單項已 disable，這裡再擋一次避免 race）。
  bus.on('close-pet', (channelId: string) => {
    const p = getPrefs()
    if (activePetCount(p.channels, p.allEnabled) <= 1) return
    if (channelId === 'all') {
      applyAllEnabled(false)
    } else {
      const ch = p.channels.find((c) => c.id === channelId)
      if (ch) upsertChannel({ ...ch, showPet: false }) // 只關寵物顯示，頻道仍啟用（分頁/分類照常）
    }
  })

  handleCommand('show-card', ({ channelId, view }) => {
    ensureCard(channelId) // 未載入完成 → reducer 暫存 pending，loaded 事件補 flush
    dispatchCard(channelId, { kind: 'show', view })
  })
  handleCommand('hide-card', ({ channelId }) => dispatchCard(channelId, { kind: 'hide' }))
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
  bus.on('open-settings', () => settingsOpener.open())
  bus.on('open-skins', (channelId: string = 'all') => skinOpener.open(channelId))
  bus.on('open-channels', () => channelsOpener.open())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) reconcilePets()
  })
})

function autoDetectChannel(source: { kind: string; name?: string }): void {
  // 決策全在 core 的 applySourceEvent（已知來源補登／自動建啟用頻道跳專屬寵物／死角兜底），
  // 此處只套用結果並依 flags 執行副作用。
  const p = getPrefs()
  const r = applySourceEvent(
    { channels: p.channels, knownSources: p.knownSources, allEnabled: p.allEnabled },
    source,
    { defaultSkin: p.skin, nextId: nextChannelId, maxKnown: MAX_KNOWN_SOURCES, maxAuto: MAX_AUTO_CHANNELS },
  )
  const partial: { channels?: Channel[]; knownSources?: SourceMatch[] } = {}
  if (r.knownChanged) partial.knownSources = r.state.knownSources
  if (r.channelsChanged) partial.channels = r.state.channels
  if (partial.channels || partial.knownSources) updatePrefsStore(partial) // broadcast 由訂閱處理
  if (r.petsChanged) {
    reconcilePets() // 立刻長出該寵物，當下訊息隨後（onEvent 路由）演到它身上
    broadcastUnread()
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
