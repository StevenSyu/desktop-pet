import { app, BrowserWindow, screen, ipcMain, Menu, dialog } from 'electron'
import { join } from 'node:path'
import { SKINS } from '../core/skins'
import { bus } from './bus'
import { clampToValidPosition, defaultPosition, type DisplayInfo } from '../core/window-position'
import { clampWalkToWorkArea, sanitizeWalkBounds, DEFAULT_WALK_BOUNDS, type WalkBounds } from '../core/walk-planner'
import { loadWindowState, saveWindowState } from './window-state'
import { loadPrefs, savePrefs, type Prefs } from './prefs'

const PET_WIDTH = 280
const PET_HEIGHT = 300
const MARGIN = 24
let handlersRegistered = false
let petWinRef: BrowserWindow | null = null
let prefs: Prefs = { autoWalk: true, walk: { ...DEFAULT_WALK_BOUNDS } }

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
  win.setIgnoreMouseEvents(true, { forward: true })
  petWinRef = win
  win.on('closed', () => {
    if (petWinRef === win) petWinRef = null
  })
  if (!handlersRegistered) {
    handlersRegistered = true
    ipcMain.on('set-interactive', (_event, interactive: boolean) => {
      win.setIgnoreMouseEvents(!interactive, { forward: true })
    })
    ipcMain.on('show-context-menu', () => {
      const menu = Menu.buildFromTemplate([
        {
          label: '更換造型',
          submenu: SKINS.map((s) => ({
            label: s.name,
            click: () => win.webContents.send('set-skin', s.id),
          })),
        },
        {
          label: '自動走動',
          type: 'checkbox',
          checked: prefs.autoWalk,
          click: (menuItem) => {
            prefs = { ...prefs, autoWalk: menuItem.checked }
            savePrefs(app.getPath('userData'), prefs)
            if (petWinRef && !petWinRef.isDestroyed()) {
              petWinRef.webContents.send('auto-walk-changed', prefs.autoWalk)
            }
            if (!prefs.autoWalk) endWalk(true)
          },
        },
        { label: '進階設定…', click: () => bus.emit('open-settings') },
        { type: 'separator' },
        { label: '通知中心', click: () => bus.emit('open-center') },
        { type: 'separator' },
        {
          label: '關閉小幫手',
          click: async () => {
            if (!petWinRef || petWinRef.isDestroyed()) {
              app.quit()
              return
            }
            const { response } = await dialog.showMessageBox(petWinRef, {
              type: 'question',
              buttons: ['取消', '關閉'],
              defaultId: 0,
              cancelId: 0,
              title: '關閉 may？',
              message: '關閉 may？',
              detail: '關閉後 Claude Code hook 仍會觸發，但 may 不會顯示。',
            })
            if (response === 1) app.quit()
          },
        },
      ])
      menu.popup({ window: win })
    })

    // ===== 拖動 =====
    let dragStartScreen: { x: number; y: number } | null = null
    let dragStartWin: { x: number; y: number } | null = null

    ipcMain.on('drag-start', (_event, sx: number, sy: number) => {
      if (!petWinRef || petWinRef.isDestroyed()) return
      endWalk(true) // 拖動時取消任何走動
      const [wx, wy] = petWinRef.getPosition()
      dragStartScreen = { x: sx, y: sy }
      dragStartWin = { x: wx, y: wy }
    })
    ipcMain.on('drag-move', (_event, sx: number, sy: number) => {
      if (!petWinRef || petWinRef.isDestroyed()) return
      if (!dragStartScreen || !dragStartWin) return
      const nx = dragStartWin.x + (sx - dragStartScreen.x)
      const ny = dragStartWin.y + (sy - dragStartScreen.y)
      petWinRef.setPosition(Math.round(nx), Math.round(ny))
    })
    ipcMain.on('drag-end', () => {
      dragStartScreen = null
      dragStartWin = null
      if (!petWinRef || petWinRef.isDestroyed()) return
      const [x, y] = petWinRef.getPosition()
      const d = screen.getDisplayMatching(petWinRef.getBounds())
      saveWindowState(app.getPath('userData'), { displayId: d.id, x, y })
    })

    // ===== walk session：單一 in-flight；setTimeout 鏈式推進避免時鐘漂移 =====
    let walkTimer: NodeJS.Timeout | null = null
    const endWalkInner = (notify: boolean): void => {
      if (walkTimer) {
        clearTimeout(walkTimer)
        walkTimer = null
      }
      if (notify && petWinRef && !petWinRef.isDestroyed()) {
        petWinRef.webContents.send('walk-ended')
      }
    }
    function endWalk(notify: boolean): void {
      endWalkInner(notify)
    }

    ipcMain.on(
      'walk-start',
      (_event, req: { direction: 'left' | 'right'; distance: number; duration: number }) => {
        if (!petWinRef || petWinRef.isDestroyed()) return
        endWalk(false)
        const [startX, startY] = petWinRef.getPosition()
        const display = screen.getDisplayNearestPoint({ x: startX, y: startY })
        let direction: 'left' | 'right' = req.direction
        let available = clampWalkToWorkArea(startX, direction, req.distance, display.workArea, PET_WIDTH)
        if (available <= 0) {
          // 該方向到底了，試對向
          const flipped: 'left' | 'right' = direction === 'right' ? 'left' : 'right'
          const alt = clampWalkToWorkArea(startX, flipped, req.distance, display.workArea, PET_WIDTH)
          if (alt > 0) {
            direction = flipped
            available = alt
            petWinRef.webContents.send('walk-direction', direction)
          } else {
            petWinRef.webContents.send('walk-ended')
            return
          }
        }
        const sign: number = direction === 'right' ? 1 : -1
        const startedAt = Date.now()
        const step = (): void => {
          if (!petWinRef || petWinRef.isDestroyed()) {
            walkTimer = null
            return
          }
          const elapsed = Date.now() - startedAt
          const t = Math.min(1, elapsed / req.duration)
          const x = Math.round(startX + sign * available * t)
          petWinRef.setPosition(x, startY)
          if (t >= 1) {
            endWalk(true)
            return
          }
          walkTimer = setTimeout(step, 16)
        }
        step()
      },
    )
    ipcMain.on('walk-cancel', () => endWalk(true))

    ipcMain.handle('get-auto-walk', () => prefs.autoWalk)
    ipcMain.handle('get-prefs', () => prefs)
    ipcMain.on('set-walk-bounds', (_e, partial: Partial<WalkBounds>) => {
      const next = sanitizeWalkBounds({ ...prefs.walk, ...partial })
      prefs = { ...prefs, walk: next }
      savePrefs(app.getPath('userData'), prefs)
      if (petWinRef && !petWinRef.isDestroyed()) {
        petWinRef.webContents.send('prefs-changed', prefs)
      }
    })

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
