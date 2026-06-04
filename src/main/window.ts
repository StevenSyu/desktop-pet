import { app, BrowserWindow, screen, Menu, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SKIN_ID } from '../core/skins'
import { scanSkins } from './skin-registry'
import { bus } from './bus'
import { isMac, isWindows, pinWindow } from './win-util'
import { type ChannelLabelMode } from '../core/channel-label'
import { defaultPosition, isWithinAnyDisplay } from '../core/window-position'
import { stackPosition } from '../core/pet-layout'
import { clampScale } from '../core/pet-scale'
import { sanitizeWalkBounds } from '../core/walk-planner'
import { WalkSession } from '../core/walk-session'
import { loadWindowStates, saveWindowState } from './window-state'
import { type Prefs } from './prefs'
import { getPrefs, updatePrefsStore, subscribePrefs } from './prefs-store'
import { handleCommand, handleQuery, pushTo, type PushArgs } from '../ipc/main-helpers'
import type { Pushes } from '../ipc/contract'

const PET_WIDTH = 135
const PET_HEIGHT = 146
const MARGIN = 24
const GAP = 12

let handlersRegistered = false
const petWindows = new Map<string, BrowserWindow>() // channelId → window；'all' = 全部
let skinSheetPaths = new Map<string, string>()

// renderer 的 prefs-changed 只在這些欄位變更時才推（高頻 persist 的 channels/knownSources
// 不推，否則 renderer 每次通知都會重設走動排程）
const PET_PREFS_KEYS: readonly (keyof Prefs)[] = ['channelLabelMode', 'walk', 'skin', 'pomodoro']
subscribePrefs((p, changed) => {
  if (!PET_PREFS_KEYS.some((k) => changed.has(k))) return
  broadcastToPets('prefs-changed', p)
})

function petWindowSize(scale: number): { width: number; height: number } {
  return {
    width: Math.round(PET_WIDTH * scale),
    height: Math.round(PET_HEIGHT * scale),
  }
}

function setPetContentSize(win: BrowserWindow, scale: number): void {
  const size = petWindowSize(scale)
  win.setContentSize(size.width, size.height)
  if (isWindows) {
    win.setShape([{ x: 0, y: 0, width: size.width, height: size.height }])
  }
}

export function getSkinSheetPath(id: string): string | undefined {
  return skinSheetPaths.get(id)
}
export function setSkinSheetPaths(paths: Map<string, string>): void {
  skinSheetPaths = paths
}
export function getPetWindow(channelId: string): BrowserWindow | undefined {
  const w = petWindows.get(channelId)
  return w && !w.isDestroyed() ? w : undefined
}
export function petChannelIds(): string[] {
  return [...petWindows.keys()]
}
/** 推播給所有寵物視窗（取代各處手寫 for-of pushTo loop）。 */
export function broadcastToPets<K extends keyof Pushes>(channel: K, ...args: PushArgs<K>): void {
  for (const w of petWindows.values()) pushTo(w, channel, ...args)
}
export function closePetWindow(channelId: string): void {
  endWalk(channelId, false)
  const w = petWindows.get(channelId)
  if (w && !w.isDestroyed()) w.close()
  petWindows.delete(channelId)
}

export function builtinRoot(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath()
}

// ===== per-pet 拖動與走動狀態 =====
const dragOffsets = new Map<string, { x: number; y: number }>()
const walks = new Map<string, { session: WalkSession; timer: NodeJS.Timeout | null }>()
function endWalk(channelId: string, notify: boolean): void {
  const walk = walks.get(channelId)
  if (!walk) return
  if (walk.timer) clearTimeout(walk.timer)
  walk.session.cancel()
  walks.delete(channelId)
  if (notify) pushTo(getPetWindow(channelId), 'walk-ended')
}
function endAllWalks(notify: boolean): void {
  for (const id of [...walks.keys()]) endWalk(id, notify)
}

function setLabelMode(mode: ChannelLabelMode): void {
  updatePrefsStore({ channelLabelMode: mode }) // broadcast 由 subscribePrefs 統一處理
}

function setPetInteractive(win: BrowserWindow, interactive: boolean): void {
  if (isMac) {
    win.setIgnoreMouseEvents(!interactive, { forward: true })
  } else {
    win.setIgnoreMouseEvents(false)
  }
}

export function createPetWindow(channelId: string, requestedSkin: string, index: number): BrowserWindow {
  skinSheetPaths = scanSkins(app.getPath('userData'), builtinRoot()).sheetPaths

  const states = loadWindowStates(app.getPath('userData'))
  const saved = states[channelId]
  const scale = clampScale(saved?.scale)
  const { width: winW, height: winH } = petWindowSize(scale)
  let pos: { x: number; y: number }
  const workAreas = screen.getAllDisplays().map((d) => d.workArea)
  const validSaved = saved && isWithinAnyDisplay({ x: saved.x, y: saved.y, width: winW, height: winH }, workAreas)
  if (validSaved && saved) {
    pos = { x: saved.x, y: saved.y }
  } else if (channelId === 'all') {
    const primary = screen.getPrimaryDisplay()
    pos = defaultPosition({ id: primary.id, workArea: primary.workArea }, { width: PET_WIDTH, height: PET_HEIGHT }, MARGIN)
  } else {
    pos = stackPosition(index, { width: PET_WIDTH, height: PET_HEIGHT }, screen.getPrimaryDisplay().workArea, MARGIN, GAP)
  }

  const win = new BrowserWindow({
    width: winW,
    height: winH,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    useContentSize: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      backgroundThrottling: false,
    },
  })
  pinWindow(win, true)
  setPetContentSize(win, scale)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?c=${encodeURIComponent(channelId)}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { c: channelId } })
  }
  win.webContents.once('did-finish-load', () => {
    const { sheetPaths } = scanSkins(app.getPath('userData'), builtinRoot())
    skinSheetPaths = sheetPaths
    const effectiveId = sheetPaths.has(requestedSkin) ? requestedSkin : DEFAULT_SKIN_ID
    setPetContentSize(win, scale)
    pushTo(win, 'set-skin', effectiveId)
    pushTo(win, 'set-scale', scale)
  })
  setPetInteractive(win, false)
  petWindows.set(channelId, win)
  win.on('closed', () => {
    if (petWindows.get(channelId) === win) petWindows.delete(channelId)
  })

  if (!handlersRegistered) {
    handlersRegistered = true
    registerHandlers()
  }
  return win
}

function registerHandlers(): void {
  handleCommand('set-interactive', ({ channelId, interactive }) => {
    const win = getPetWindow(channelId)
    if (win) setPetInteractive(win, interactive)
  })

  handleCommand('show-context-menu', ({ channelId }) => {
    const win = getPetWindow(channelId)
    if (!win) return
    const prefs = getPrefs()
    const menu = Menu.buildFromTemplate([
      {
        label: '名稱標籤',
        submenu: [
          { label: '隱藏', type: 'radio', checked: prefs.channelLabelMode === 'hidden', click: () => setLabelMode('hidden') },
          { label: '滑過時顯示', type: 'radio', checked: prefs.channelLabelMode === 'hover', click: () => setLabelMode('hover') },
          { label: '常態顯示', type: 'radio', checked: prefs.channelLabelMode === 'always', click: () => setLabelMode('always') },
        ],
      },
      { label: '寵物設定…', click: () => bus.emit('open-channels') },
      {
        label: '自動走動',
        type: 'checkbox',
        checked: prefs.autoWalk,
        click: (mi) => {
          const next = updatePrefsStore({ autoWalk: mi.checked })
          broadcastToPets('auto-walk-changed', next.autoWalk)
          if (!next.autoWalk) endAllWalks(true)
        },
      },
      { label: '勿擾模式', type: 'checkbox', checked: prefs.dnd, click: (mi) => applyDnd(mi.checked) },
      { label: '進階設定…', click: () => bus.emit('open-settings') },
      { type: 'separator' },
      { label: '通知中心', click: () => bus.emit('open-center') },
      { type: 'separator' },
      {
        label: petChannelIds().length >= 2 ? '關閉這隻寵物' : '關閉這隻寵物（至少保留一隻）',
        enabled: petChannelIds().length >= 2,
        click: () => bus.emit('close-pet', channelId),
      },
      { label: '關閉小幫手', click: () => app.quit() },
    ])
    menu.popup({ window: win })
  })

  // ===== 拖動（per-pet）=====
  handleCommand('drag-start', ({ channelId }) => {
    const win = getPetWindow(channelId)
    if (!win) return
    endWalk(channelId, true) // 走動中被拖 → 立即停
    const cursor = screen.getCursorScreenPoint()
    const bounds = win.getBounds()
    dragOffsets.set(channelId, { x: cursor.x - bounds.x, y: cursor.y - bounds.y })
    bus.emit('pet-drag-start', channelId)
  })
  handleCommand('drag-move', ({ channelId }) => {
    const win = getPetWindow(channelId)
    const off = dragOffsets.get(channelId)
    if (!win || !off) return
    const cursor = screen.getCursorScreenPoint()
    const bounds = win.getBounds()
    const x = Math.round(cursor.x - off.x)
    const y = Math.round(cursor.y - off.y)
    win.setPosition(x, y)
    bus.emit('pet-moved', channelId, { x, y, width: bounds.width, height: bounds.height })
  })
  handleCommand('drag-end', ({ channelId }) => {
    dragOffsets.delete(channelId)
    bus.emit('pet-drag-end', channelId)
    const win = getPetWindow(channelId)
    if (!win) return
    const [x, y] = win.getPosition()
    const d = screen.getDisplayMatching(win.getBounds())
    const scale = clampScale(loadWindowStates(app.getPath('userData'))[channelId]?.scale)
    saveWindowState(app.getPath('userData'), channelId, { displayId: d.id, x, y, scale })
  })
  handleCommand('set-scale', ({ channelId, scale }) => {
    const s = clampScale(scale)
    const win = getPetWindow(channelId)
    if (!win) return
    const b = win.getBounds()
    setPetContentSize(win, s)
    const d = screen.getDisplayMatching(win.getBounds())
    saveWindowState(app.getPath('userData'), channelId, { displayId: d.id, x: b.x, y: b.y, scale: s })
    bus.emit('pet-moved', channelId, win.getBounds())
  })

  // ===== walk（per-pet）=====
  handleCommand('walk-start', (req) => {
    const { channelId } = req
    const win = getPetWindow(channelId)
    if (!win) return
    endWalk(channelId, false)
    const { x: startX, y: startY, width: winWidth } = win.getBounds()
    const display = screen.getDisplayNearestPoint({ x: startX, y: startY })
    const walk = { session: new WalkSession(), timer: null as NodeJS.Timeout | null }
    const res = walk.session.start(
      // petWidth 用實際視窗寬（含 scale），固定 PET_WIDTH 會讓放大的寵物走出螢幕右緣被切
      { startX, requestedDirection: req.direction, distance: req.distance, duration: req.duration, workArea: display.workArea, petWidth: winWidth },
      Date.now(),
    )
    if (!res.ok) {
      pushTo(win, 'walk-ended')
      return
    }
    walks.set(channelId, walk)
    if (res.flippedTo) pushTo(win, 'walk-direction', res.flippedTo)
    const step = (): void => {
      const w = getPetWindow(channelId)
      if (!w) {
        endWalk(channelId, false)
        return
      }
      const frame = walk.session.step(Date.now())
      if (!frame) return
      w.setPosition(frame.x, startY)
      if (frame.done) {
        endWalk(channelId, true)
        return
      }
      walk.timer = setTimeout(step, 16)
    }
    step()
  })
  handleCommand('walk-cancel', ({ channelId }) => endWalk(channelId, true))

  // ===== 全域命令 / 查詢（不分 pet）=====
  handleCommand('open-center', ({ channelId }) => bus.emit('open-center', channelId))
  handleQuery('get-auto-walk', () => getPrefs().autoWalk)
  handleQuery('get-prefs', () => getPrefs())
  handleCommand('open-pets-folder', () => {
    const dir = join(app.getPath('userData'), 'pets')
    mkdirSync(dir, { recursive: true })
    shell.openPath(dir)
  })
  handleCommand('set-walk-bounds', (partial) => {
    const next = sanitizeWalkBounds({ ...getPrefs().walk, ...partial })
    updatePrefsStore({ walk: next }) // broadcast 由 subscribePrefs 統一處理
  })

  function applyDnd(enabled: boolean): void {
    updatePrefsStore({ dnd: enabled })
    if (enabled) broadcastToPets('dnd-on')
    broadcastToPets('dnd-changed', enabled)
  }
  handleCommand('set-dnd', (enabled) => applyDnd(enabled))
  handleQuery('get-dnd', () => getPrefs().dnd)

  // ===== display-removed：每隻寵物各自失效重吸附 =====
  screen.on('display-removed', () => {
    const workAreas = screen.getAllDisplays().map((d) => d.workArea)
    for (const [channelId, win] of petWindows) {
      if (win.isDestroyed()) continue
      const b = win.getBounds()
      if (!isWithinAnyDisplay(b, workAreas)) {
        const primary = screen.getPrimaryDisplay()
        const pos = defaultPosition({ id: primary.id, workArea: primary.workArea }, { width: PET_WIDTH, height: PET_HEIGHT }, MARGIN)
        win.setPosition(pos.x, pos.y)
        bus.emit('pet-moved', channelId, { ...win.getBounds(), x: pos.x, y: pos.y })
      }
    }
  })
}
