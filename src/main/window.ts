import { app, BrowserWindow, screen, Menu, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SKIN_ID } from '../core/skins'
import { scanSkins } from './skin-registry'
import { bus } from './bus'
import { clampToValidPosition, defaultPosition, type DisplayInfo } from '../core/window-position'
import { sanitizeWalkBounds, DEFAULT_WALK_BOUNDS, type WalkBounds } from '../core/walk-planner'
import { WalkSession } from '../core/walk-session'
import { loadWindowState, saveWindowState } from './window-state'
import { loadPrefs, updatePrefs, type Prefs } from './prefs'
import { handleCommand, handleQuery, pushTo } from '../ipc/main-helpers'

const PET_WIDTH = 135
const PET_HEIGHT = 146
const MARGIN = 24
let handlersRegistered = false
let petWinRef: BrowserWindow | null = null
let prefs: Prefs = {
  autoWalk: true,
  walk: { ...DEFAULT_WALK_BOUNDS },
  skin: DEFAULT_SKIN_ID,
  dnd: false,
  channels: [],
}
// 最近一次掃描的 id → spritesheet 絕對路徑（供 pet:// protocol handler 取檔）
let skinSheetPaths = new Map<string, string>()

export function getSkinSheetPath(id: string): string | undefined {
  return skinSheetPaths.get(id)
}

// 內建造型根目錄：打包後 resources/pets 由 electron-builder extraResources 放到 asar 外的
// process.resourcesPath（pet:// 用 file:// 讀得到）；開發/未打包時用 app.getAppPath()。
function builtinRoot(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath()
}

export function createPetWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const displays: DisplayInfo[] = screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea }))
  const primaryInfo: DisplayInfo = { id: primary.id, workArea: primary.workArea }
  prefs = loadPrefs(app.getPath('userData'))
  // 先掃一次填好 skinSheetPaths，確保 renderer 啟動請求 pet://<id>/sheet 時 protocol 已有對應（避免 race 404）
  skinSheetPaths = scanSkins(app.getPath('userData'), builtinRoot()).sheetPaths
  const saved = loadWindowState(app.getPath('userData'))
  const winSize = { width: PET_WIDTH, height: PET_HEIGHT }
  const { x: initX, y: initY } = clampToValidPosition(saved, displays, primaryInfo, winSize, MARGIN)

  const win = new BrowserWindow({
    width: PET_WIDTH,
    height: PET_HEIGHT,
    x: initX,
    y: initY,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
    },
  })

  win.setAlwaysOnTop(true, 'floating')
  // 顯示在所有虛擬桌面 / Spaces（含全螢幕 App 的 Space）
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  win.webContents.once('did-finish-load', () => {
    // 掃描決定有效造型；prefs.skin 失效（資料夾刪了）則退回 DEFAULT_SKIN_ID
    const { sheetPaths } = scanSkins(app.getPath('userData'), builtinRoot())
    skinSheetPaths = sheetPaths
    const effectiveId = sheetPaths.has(prefs.skin) ? prefs.skin : DEFAULT_SKIN_ID
    pushTo(win, 'set-skin', effectiveId)
  })
  win.setIgnoreMouseEvents(true, { forward: true })
  petWinRef = win
  win.on('closed', () => {
    if (petWinRef === win) petWinRef = null
  })
  if (!handlersRegistered) {
    handlersRegistered = true
    handleCommand('set-interactive', (interactive) => {
      win.setIgnoreMouseEvents(!interactive, { forward: true })
    })
    handleCommand('show-context-menu', () => {
      const menu = Menu.buildFromTemplate([
        { label: '更換造型…', click: () => bus.emit('open-skins') },
        {
          label: '自動走動',
          type: 'checkbox',
          checked: prefs.autoWalk,
          click: (menuItem) => {
            prefs = { ...prefs, autoWalk: menuItem.checked }
            prefs = updatePrefs(app.getPath('userData'), { autoWalk: prefs.autoWalk })
            pushTo(petWinRef, 'auto-walk-changed', prefs.autoWalk)
            if (!prefs.autoWalk) endWalk(true)
          },
        },
        {
          label: '勿擾模式',
          type: 'checkbox',
          checked: prefs.dnd,
          click: (menuItem) => {
            applyDnd(menuItem.checked)
          },
        },
        { label: '進階設定…', click: () => bus.emit('open-settings') },
        { type: 'separator' },
        { label: '通知中心', click: () => bus.emit('open-center') },
        { type: 'separator' },
        {
          label: '關閉小幫手',
          click: () => app.quit(),
        },
      ])
      menu.popup({ window: win })
    })

    // ===== 拖動 =====
    // 位置一律由 main 自己讀 screen.getCursorScreenPoint()（全域 DIP，與 getPosition 同座標系、
    // 不受各螢幕 scaleFactor 影響）計算，不用 renderer 的 e.screenX/screenY（跨不同 scale 螢幕時
    // 參考基準會變而造成抖動 / flip-flop）。grabOffset = 拖動起點時 游標 - 視窗左上。
    let dragGrabOffset: { x: number; y: number } | null = null

    handleCommand('drag-start', () => {
      if (!petWinRef || petWinRef.isDestroyed()) return
      endWalk(true) // 拖動時取消任何走動
      const cursor = screen.getCursorScreenPoint()
      const [wx, wy] = petWinRef.getPosition()
      dragGrabOffset = { x: cursor.x - wx, y: cursor.y - wy }
    })
    handleCommand('drag-move', () => {
      if (!petWinRef || petWinRef.isDestroyed() || !dragGrabOffset) return
      const cursor = screen.getCursorScreenPoint()
      // 視窗自由跟游標（grabOffset 固定）。不夾 workArea——改用 getCursorScreenPoint 後沒有
      // renderer screenX 的回饋迴圈，macOS 自身的選單列夾值不會造成抖動。
      const nx = Math.round(cursor.x - dragGrabOffset.x)
      const ny = Math.round(cursor.y - dragGrabOffset.y)
      petWinRef.setPosition(nx, ny)
      bus.emit('pet-moved') // 同步卡片視窗（index.ts 監聽）
    })
    handleCommand('drag-end', () => {
      dragGrabOffset = null
      if (!petWinRef || petWinRef.isDestroyed()) return
      const [x, y] = petWinRef.getPosition()
      const d = screen.getDisplayMatching(petWinRef.getBounds())
      saveWindowState(app.getPath('userData'), { displayId: d.id, x, y })
    })

    // ===== walk session：狀態機在 core/WalkSession（可測），此處只做計時 + IO =====
    const walkSession = new WalkSession()
    let walkTimer: NodeJS.Timeout | null = null
    function endWalk(notify: boolean): void {
      if (walkTimer) {
        clearTimeout(walkTimer)
        walkTimer = null
      }
      walkSession.cancel()
      if (notify) pushTo(petWinRef, 'walk-ended')
    }

    handleCommand('walk-start', (req) => {
      if (!petWinRef || petWinRef.isDestroyed()) return
      endWalk(false)
      const [startX, startY] = petWinRef.getPosition()
      const display = screen.getDisplayNearestPoint({ x: startX, y: startY })
      const res = walkSession.start(
        {
          startX,
          requestedDirection: req.direction,
          distance: req.distance,
          duration: req.duration,
          workArea: display.workArea,
          petWidth: PET_WIDTH,
        },
        Date.now(),
      )
      if (!res.ok) {
        pushTo(petWinRef, 'walk-ended')
        return
      }
      if (res.flippedTo) pushTo(petWinRef, 'walk-direction', res.flippedTo)
      const step = (): void => {
        if (!petWinRef || petWinRef.isDestroyed()) {
          endWalk(false)
          return
        }
        const frame = walkSession.step(Date.now())
        if (!frame) return // 已被 cancel
        petWinRef.setPosition(frame.x, startY)
        if (frame.done) {
          endWalk(true)
          return
        }
        walkTimer = setTimeout(step, 16)
      }
      step()
    })
    handleCommand('walk-cancel', () => endWalk(true))

    handleCommand('open-center', () => bus.emit('open-center'))
    handleQuery('get-auto-walk', () => prefs.autoWalk)
    handleQuery('get-prefs', () => prefs)
    handleQuery('get-skins', () => {
      const { skins, sheetPaths } = scanSkins(app.getPath('userData'), builtinRoot())
      skinSheetPaths = sheetPaths
      const requestedId = prefs.skin
      const effectiveId = sheetPaths.has(requestedId) ? requestedId : DEFAULT_SKIN_ID
      return { skins, requestedId, effectiveId }
    })
    handleQuery('select-skin', (id) => {
      const { sheetPaths } = scanSkins(app.getPath('userData'), builtinRoot())
      skinSheetPaths = sheetPaths
      if (!sheetPaths.has(id)) {
        const effectiveId = sheetPaths.has(prefs.skin) ? prefs.skin : DEFAULT_SKIN_ID
        return { ok: false, effectiveId }
      }
      prefs = { ...prefs, skin: id }
      prefs = updatePrefs(app.getPath('userData'), { skin: prefs.skin })
      pushTo(petWinRef, 'set-skin', id)
      return { ok: true, effectiveId: id }
    })
    handleCommand('open-pets-folder', () => {
      const dir = join(app.getPath('userData'), 'pets')
      mkdirSync(dir, { recursive: true }) // 不存在就先建，確保開得起來
      shell.openPath(dir)
    })
    handleCommand('set-walk-bounds', (partial) => {
      const next = sanitizeWalkBounds({ ...prefs.walk, ...partial })
      prefs = { ...prefs, walk: next }
      prefs = updatePrefs(app.getPath('userData'), { walk: prefs.walk })
      pushTo(petWinRef, 'prefs-changed', prefs)
    })

    function applyDnd(enabled: boolean): void {
      prefs = { ...prefs, dnd: enabled }
      prefs = updatePrefs(app.getPath('userData'), { dnd: prefs.dnd })
      bus.emit('dnd-changed', enabled) // 讓 index.ts 的 onEvent gate 讀到
      if (enabled) pushTo(petWinRef, 'dnd-on') // renderer 清當前 replay 卡片
      pushTo(petWinRef, 'dnd-changed', enabled) // 通知中心顯示「勿擾中」
    }

    handleCommand('set-dnd', (enabled) => applyDnd(enabled))
    handleQuery('get-dnd', () => prefs.dnd)

    // ===== display-removed：失效時吸附回 primary =====
    screen.on('display-removed', () => {
      if (!petWinRef || petWinRef.isDestroyed()) return
      const bounds = petWinRef.getBounds()
      const displays = screen.getAllDisplays()
      const containing = displays.find((d) => {
        const wa = d.workArea
        return (
          bounds.x >= wa.x &&
          bounds.y >= wa.y &&
          bounds.x + bounds.width <= wa.x + wa.width &&
          bounds.y + bounds.height <= wa.y + wa.height
        )
      })
      if (!containing) {
        const primary = screen.getPrimaryDisplay()
        const pos = defaultPosition(
          { id: primary.id, workArea: primary.workArea },
          { width: PET_WIDTH, height: PET_HEIGHT },
          MARGIN,
        )
        petWinRef.setPosition(pos.x, pos.y)
        bus.emit('pet-moved')
      }
    })
  }
  return win
}
