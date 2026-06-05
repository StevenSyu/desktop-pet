import { app, BrowserWindow, screen, shell } from 'electron'
import { createPetWindow, getSkinSheetPath, getPetWindow, petChannelIds, closePetWindow, builtinRoot, setSkinSheetPaths, broadcastToPets } from './window'
import {
  makeOpener,
  createCenterWindow, CENTER_W, CENTER_H,
  createCardWindow,
  createSettingsWindow,
  createSkinWindow,
  createChannelsWindow,
} from './window-factory'
import { loadWindowStates, saveWindowState } from './window-state'
import { initCardManager, type CardManager } from './card-manager'
import { unreadByChannel, activePetCount, applySourceEvent, healKnownKinds, healSkins, type Channel, type SourceMatch } from '../core/channel'
import { routeEvent } from '../core/event-route'
import { desiredPetIds, diffFleet } from '../core/pet-fleet'
import { resolveCenterPos } from '../core/center-pos'
import { DEFAULT_SKIN_ID } from '../core/skins'
import { registerPetScheme, registerPetProtocol } from './pet-protocol'
import { findFreePort, generateToken, writeEndpointFile } from './endpoint'
import { startIngestServer } from './ingest'
import { MessageStore } from '../core/message-store'
import { busEmit, busOn } from './bus'
import { getPrefs, updatePrefsStore, subscribePrefs } from './prefs-store'
import { handleCommand, handleQuery, pushTo } from '../ipc/main-helpers'
import type { AppEvent } from '../core/events'
import { scanSkins } from './skin-registry'
import { initPomodoro } from './pomodoro-driver'

// pet: scheme 必須在 app ready 前註冊（一次）
registerPetScheme()

const store = new MessageStore()
let centerWindow: BrowserWindow | null = null
// 單例工具窗：已開則 focus；造型挑選改關舊開新（頻道參數可能不同）
const settingsOpener = makeOpener(createSettingsWindow)
const skinOpener = makeOpener(createSkinWindow, { replace: true })
const channelsOpener = makeOpener(createChannelsWindow)
// 卡片視窗管理在 card-manager.ts；app ready 時 init（deps 注入 electron 能力）
let cardManager: CardManager
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
    cardManager.closeFor(id) // 頻道寵物收掉 → 連帶收卡片
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

// 通知音（蕃茄鐘路徑）：soundEnabled 檢查在此；DND guard 在 pomodoro-driver 的 showInternal。
// 外部事件路徑的響音決策在 core 的 routeEvent，不走這裡。
function playNotifySound(): void {
  if (getPrefs().soundEnabled) shell.beep()
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
  broadcastToPets('channels-updated', getPrefs().channels)
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
app.whenReady().then(async () => {
  registerPetProtocol(getSkinSheetPath) // 在任何載入 pet: 的視窗前
  // 卡片視窗管理：electron 能力以 deps 注入；card domain 的 IPC/bus 接線在 init 內自訂閱
  cardManager = initCardManager({
    createWindow: createCardWindow,
    getPetWindow,
    workAreaFor: (b) => screen.getDisplayMatching(b).workArea,
    onDisplayChange: (cb) => screen.on('display-metrics-changed', cb),
    onMore: (channelId, id) => {
      pendingDetailId = id
      openCenter(channelId) // 開該頻道分頁 + 詳情
      pushTo(centerWindow, 'open-detail') // 已開窗 → 觸發重查；新開窗靠載入時 query
    },
  })
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
      // 路由決策在 core 的 routeEvent（勿擾吞掉／響音一次／目標集合），此處只執行副作用
      const r = routeEvent(getPrefs(), event.source)
      if (r.sound) shell.beep()
      for (const id of r.targets) {
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
  handleCommand('open-skin-picker', ({ channelId }) => busEmit('open-skins', channelId))
  // 快速關閉目前頻道的寵物（右鍵選單）：停用該頻道（'all' → allEnabled false）。
  // 防呆保險：至少保留一隻（選單項已 disable，這裡再擋一次避免 race）。
  busOn('close-pet', (channelId: string) => {
    const p = getPrefs()
    if (activePetCount(p.channels, p.allEnabled) <= 1) return
    if (channelId === 'all') {
      applyAllEnabled(false)
    } else {
      const ch = p.channels.find((c) => c.id === channelId)
      if (ch) upsertChannel({ ...ch, showPet: false }) // 只關寵物顯示，頻道仍啟用（分頁/分類照常）
    }
  })

  initPomodoro({ showCard: (channelId, view) => cardManager.show(channelId, view), playSound: playNotifySound })
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

  busOn('open-center', (channelId?: string) => openCenter(channelId))
  busOn('open-settings', () => settingsOpener.open())
  busOn('open-skins', (channelId: string = 'all') => skinOpener.open(channelId))
  busOn('open-channels', () => channelsOpener.open())

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
