import { app, BrowserWindow, screen, Menu } from 'electron'
import { join } from 'node:path'
import { SKINS, isValidSkinId, DEFAULT_SKIN_ID } from '../core/skins'
import { bus } from './bus'
import { clampToValidPosition, defaultPosition, type DisplayInfo } from '../core/window-position'
import { sanitizeWalkBounds, DEFAULT_WALK_BOUNDS, type WalkBounds } from '../core/walk-planner'
import { WalkSession } from '../core/walk-session'
import { loadWindowState, saveWindowState } from './window-state'
import { loadPrefs, savePrefs, type Prefs } from './prefs'
import { handleCommand, handleQuery, pushTo } from '../ipc/main-helpers'

const PET_WIDTH = 280
const PET_HEIGHT = 300
const MARGIN = 24
let handlersRegistered = false
let petWinRef: BrowserWindow | null = null
let prefs: Prefs = {
  autoWalk: true,
  walk: { ...DEFAULT_WALK_BOUNDS },
  skin: DEFAULT_SKIN_ID,
  dnd: false,
}

export function createPetWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const displays: DisplayInfo[] = screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea }))
  const primaryInfo: DisplayInfo = { id: primary.id, workArea: primary.workArea }
  prefs = loadPrefs(app.getPath('userData'))
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
    // 把上次選的 skin 推給 renderer；renderer 啟動時會先用 DEFAULT_SKIN_ID 渲染，這裡覆寫成上次選的
    pushTo(win, 'set-skin', prefs.skin)
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
        {
          label: '更換造型',
          submenu: SKINS.map((s) => ({
            label: s.name,
            type: 'radio' as const,
            checked: prefs.skin === s.id,
            click: () => {
              if (!isValidSkinId(s.id)) return
              prefs = { ...prefs, skin: s.id }
              savePrefs(app.getPath('userData'), prefs)
              pushTo(petWinRef, 'set-skin', s.id)
            },
          })),
        },
        {
          label: '自動走動',
          type: 'checkbox',
          checked: prefs.autoWalk,
          click: (menuItem) => {
            prefs = { ...prefs, autoWalk: menuItem.checked }
            savePrefs(app.getPath('userData'), prefs)
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
    let dragStartScreen: { x: number; y: number } | null = null
    let dragStartWin: { x: number; y: number } | null = null

    handleCommand('drag-start', ({ sx, sy }) => {
      if (!petWinRef || petWinRef.isDestroyed()) return
      endWalk(true) // 拖動時取消任何走動
      const [wx, wy] = petWinRef.getPosition()
      dragStartScreen = { x: sx, y: sy }
      dragStartWin = { x: wx, y: wy }
    })
    handleCommand('drag-move', ({ sx, sy }) => {
      if (!petWinRef || petWinRef.isDestroyed()) return
      if (!dragStartScreen || !dragStartWin) return
      const nx = dragStartWin.x + (sx - dragStartScreen.x)
      const ny = dragStartWin.y + (sy - dragStartScreen.y)
      petWinRef.setPosition(Math.round(nx), Math.round(ny))
    })
    handleCommand('drag-end', () => {
      dragStartScreen = null
      dragStartWin = null
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
    handleCommand('set-walk-bounds', (partial) => {
      const next = sanitizeWalkBounds({ ...prefs.walk, ...partial })
      prefs = { ...prefs, walk: next }
      savePrefs(app.getPath('userData'), prefs)
      pushTo(petWinRef, 'prefs-changed', prefs)
    })

    function applyDnd(enabled: boolean): void {
      prefs = { ...prefs, dnd: enabled }
      savePrefs(app.getPath('userData'), prefs)
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
      }
    })
  }
  return win
}
