import { app, BrowserWindow, screen, Menu, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SKIN_ID } from '../core/skins'
import { scanSkins } from './skin-registry'
import { busEmit, busOn } from './bus'
import { isMac, isWindows, pinWindow } from './win-util'
import { type ChannelLabelMode } from '../core/channel-label'
import { petMenuTemplate, type PetMenuAction, type PetMenuItem } from '../core/pet-menu'
import { defaultPosition, isWithinAnyDisplay } from '../core/window-position'
import { stackPosition } from '../core/pet-layout'
import { clampScale } from '../core/pet-scale'
import { sanitizeWalkBounds } from '../core/walk-planner'
import { initWalkDriver } from './walk-driver'
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
  walkDriver.endWalk(channelId, false)
  const w = petWindows.get(channelId)
  if (w && !w.isDestroyed()) w.close()
  petWindows.delete(channelId)
}

export function builtinRoot(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath()
}

// ===== per-pet 拖動狀態 =====
const dragOffsets = new Map<string, { x: number; y: number }>()
// 走動驅動在 walk-driver.ts（自註冊 walk-start/walk-cancel）；Electron 能力以 deps 注入
const walkDriver = initWalkDriver({
  getWindow: (id) => getPetWindow(id),
  workAreaFor: (point) => screen.getDisplayNearestPoint(point).workArea,
  notifyEnded: (id) => pushTo(getPetWindow(id), 'walk-ended'),
  notifyDirection: (id, direction) => pushTo(getPetWindow(id), 'walk-direction', direction),
})

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

  // 選單顯示狀態的決策在 core 的 petMenuTemplate（純模板），此處只 dispatch action 副作用
  function runMenuAction(action: PetMenuAction, channelId: string, checked: boolean): void {
    switch (action.type) {
      case 'set-label-mode':
        setLabelMode(action.mode)
        break
      case 'open-channels':
        busEmit('open-channels')
        break
      case 'toggle-auto-walk': {
        const next = updatePrefsStore({ autoWalk: checked })
        broadcastToPets('auto-walk-changed', next.autoWalk)
        if (!next.autoWalk) walkDriver.endAllWalks(true)
        break
      }
      case 'toggle-dnd':
        applyDnd(checked)
        break
      case 'toggle-sound':
        updatePrefsStore({ soundEnabled: checked })
        break
      case 'open-settings':
        busEmit('open-settings')
        break
      case 'open-center':
        busEmit('open-center')
        break
      case 'close-pet':
        busEmit('close-pet', channelId)
        break
      case 'quit':
        app.quit()
        break
    }
  }
  function menuSpecToElectron(items: PetMenuItem[], dispatch: (action: PetMenuAction, checked: boolean) => void): Electron.MenuItemConstructorOptions[] {
    return items.map((it) =>
      it.kind === 'separator'
        ? { type: 'separator' as const }
        : {
            label: it.label,
            type: it.kind === 'normal' ? undefined : it.kind, // submenu 項不可標 normal，留給 Electron 推斷
            checked: it.checked,
            enabled: it.enabled,
            submenu: it.submenu ? menuSpecToElectron(it.submenu, dispatch) : undefined,
            click: it.action ? (mi) => dispatch(it.action!, mi.checked) : undefined,
          },
    )
  }
  handleCommand('show-context-menu', ({ channelId }) => {
    const win = getPetWindow(channelId)
    if (!win) return
    const spec = petMenuTemplate(getPrefs(), petChannelIds().length)
    const menu = Menu.buildFromTemplate(menuSpecToElectron(spec, (action, checked) => runMenuAction(action, channelId, checked)))
    menu.popup({ window: win })
  })

  // ===== 拖動（per-pet）=====
  handleCommand('drag-start', ({ channelId }) => {
    const win = getPetWindow(channelId)
    if (!win) return
    walkDriver.endWalk(channelId, true) // 走動中被拖 → 立即停
    const cursor = screen.getCursorScreenPoint()
    const bounds = win.getBounds()
    dragOffsets.set(channelId, { x: cursor.x - bounds.x, y: cursor.y - bounds.y })
    busEmit('pet-drag-start', channelId)
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
    busEmit('pet-moved', channelId, { x, y, width: bounds.width, height: bounds.height })
  })
  handleCommand('drag-end', ({ channelId }) => {
    dragOffsets.delete(channelId)
    busEmit('pet-drag-end', channelId)
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
    busEmit('pet-moved', channelId, win.getBounds())
  })

  // ===== 全域命令 / 查詢（不分 pet）=====
  handleCommand('open-center', ({ channelId }) => busEmit('open-center', channelId))
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
  handleCommand('set-sound-enabled', (v) => updatePrefsStore({ soundEnabled: v }))
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
        busEmit('pet-moved', channelId, { ...win.getBounds(), x: pos.x, y: pos.y })
      }
    }
  })
}
