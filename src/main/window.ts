import { app, BrowserWindow, screen, Menu, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SKIN_ID } from '../core/skins'
import { scanSkins } from './skin-registry'
import { bus } from './bus'
import { isMac, isWindows, pinWindow } from './win-util'
import { type ChannelLabelMode } from '../core/channel-label'
import { defaultPosition, type DisplayInfo } from '../core/window-position'
import { stackPosition } from '../core/pet-layout'
import { clampScale } from '../core/pet-scale'
import { sanitizeWalkBounds, DEFAULT_WALK_BOUNDS, type WalkBounds } from '../core/walk-planner'
import { WalkSession } from '../core/walk-session'
import { loadWindowStates, saveWindowState } from './window-state'
import { loadPrefs, updatePrefs, type Prefs } from './prefs'
import { handleCommand, handleQuery, pushTo } from '../ipc/main-helpers'

const PET_WIDTH = 135
const PET_HEIGHT = 146
const MARGIN = 24
const GAP = 12

let handlersRegistered = false
const petWindows = new Map<string, BrowserWindow>() // channelId → window；'all' = 全部
let prefs: Prefs = {
  autoWalk: true,
  walk: { ...DEFAULT_WALK_BOUNDS },
  skin: DEFAULT_SKIN_ID,
  channelLabelMode: 'hidden',
  dnd: false,
  allEnabled: true,
  channels: [],
  knownSources: [],
}
let skinSheetPaths = new Map<string, string>()

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
export function closePetWindow(channelId: string): void {
  const w = petWindows.get(channelId)
  if (w && !w.isDestroyed()) w.close()
  petWindows.delete(channelId)
}

export function builtinRoot(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath()
}

// ===== per-pet 拖動狀態；walk 只給 'all' =====
const dragOffsets = new Map<string, { x: number; y: number }>()
const walkSession = new WalkSession()
let walkTimer: NodeJS.Timeout | null = null
function endWalk(notify: boolean): void {
  if (walkTimer) {
    clearTimeout(walkTimer)
    walkTimer = null
  }
  walkSession.cancel()
  if (notify) pushTo(getPetWindow('all'), 'walk-ended')
}

function setLabelMode(mode: ChannelLabelMode): void {
  prefs = updatePrefs(app.getPath('userData'), { channelLabelMode: mode })
  for (const id of petChannelIds()) pushTo(getPetWindow(id), 'prefs-changed', prefs)
}

function setPetInteractive(win: BrowserWindow, interactive: boolean): void {
  if (isMac) {
    win.setIgnoreMouseEvents(!interactive, { forward: true })
  } else {
    win.setIgnoreMouseEvents(false)
  }
}

export function createPetWindow(channelId: string, requestedSkin: string, index: number): BrowserWindow {
  prefs = loadPrefs(app.getPath('userData'))
  skinSheetPaths = scanSkins(app.getPath('userData'), builtinRoot()).sheetPaths

  const states = loadWindowStates(app.getPath('userData'))
  const saved = states[channelId]
  const scale = clampScale(saved?.scale)
  const { width: winW, height: winH } = petWindowSize(scale)
  let pos: { x: number; y: number }
  const displays: DisplayInfo[] = screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea }))
  const validSaved = saved && displays.some((d) => saved.x >= d.workArea.x && saved.y >= d.workArea.y && saved.x + winW <= d.workArea.x + d.workArea.width && saved.y + winH <= d.workArea.y + d.workArea.height)
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
          prefs = updatePrefs(app.getPath('userData'), { autoWalk: mi.checked })
          pushTo(getPetWindow('all'), 'auto-walk-changed', prefs.autoWalk)
          if (!prefs.autoWalk) endWalk(true)
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
    if (channelId === 'all') endWalk(true) // 只有 'all' 會走動
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

  // ===== walk：只給 'all' =====
  handleCommand('walk-start', (req) => {
    if (req.channelId !== 'all') return
    const win = getPetWindow('all')
    if (!win) return
    endWalk(false)
    const [startX, startY] = win.getPosition()
    const display = screen.getDisplayNearestPoint({ x: startX, y: startY })
    const res = walkSession.start(
      { startX, requestedDirection: req.direction, distance: req.distance, duration: req.duration, workArea: display.workArea, petWidth: PET_WIDTH },
      Date.now(),
    )
    if (!res.ok) {
      pushTo(win, 'walk-ended')
      return
    }
    if (res.flippedTo) pushTo(win, 'walk-direction', res.flippedTo)
    const step = (): void => {
      const w = getPetWindow('all')
      if (!w) {
        endWalk(false)
        return
      }
      const frame = walkSession.step(Date.now())
      if (!frame) return
      w.setPosition(frame.x, startY)
      if (frame.done) {
        endWalk(true)
        return
      }
      walkTimer = setTimeout(step, 16)
    }
    step()
  })
  handleCommand('walk-cancel', ({ channelId }) => {
    if (channelId === 'all') endWalk(true)
  })

  // ===== 全域命令 / 查詢（不分 pet）=====
  handleCommand('open-center', ({ channelId }) => bus.emit('open-center', channelId))
  handleQuery('get-auto-walk', () => prefs.autoWalk)
  handleQuery('get-prefs', () => prefs)
  handleCommand('open-pets-folder', () => {
    const dir = join(app.getPath('userData'), 'pets')
    mkdirSync(dir, { recursive: true })
    shell.openPath(dir)
  })
  handleCommand('set-walk-bounds', (partial) => {
    const next = sanitizeWalkBounds({ ...prefs.walk, ...partial })
    prefs = updatePrefs(app.getPath('userData'), { walk: next })
    pushTo(getPetWindow('all'), 'prefs-changed', prefs)
  })

  function applyDnd(enabled: boolean): void {
    prefs = updatePrefs(app.getPath('userData'), { dnd: enabled })
    bus.emit('dnd-changed', enabled)
    for (const w of petWindows.values()) {
      if (enabled) pushTo(w, 'dnd-on')
      pushTo(w, 'dnd-changed', enabled)
    }
  }
  handleCommand('set-dnd', (enabled) => applyDnd(enabled))
  handleQuery('get-dnd', () => prefs.dnd)

  // ===== display-removed：每隻寵物各自失效重吸附 =====
  screen.on('display-removed', () => {
    const displays = screen.getAllDisplays()
    for (const [channelId, win] of petWindows) {
      if (win.isDestroyed()) continue
      const b = win.getBounds()
      const inside = displays.some(
        (d) => b.x >= d.workArea.x && b.y >= d.workArea.y && b.x + b.width <= d.workArea.x + d.workArea.width && b.y + b.height <= d.workArea.y + d.workArea.height,
      )
      if (!inside) {
        const primary = screen.getPrimaryDisplay()
        const pos = defaultPosition({ id: primary.id, workArea: primary.workArea }, { width: PET_WIDTH, height: PET_HEIGHT }, MARGIN)
        win.setPosition(pos.x, pos.y)
        bus.emit('pet-moved', channelId, { ...win.getBounds(), x: pos.x, y: pos.y })
      }
    }
  })
}
