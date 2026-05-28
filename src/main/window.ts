import { app, BrowserWindow, screen, ipcMain, Menu } from 'electron'
import { join } from 'node:path'
import { SKINS } from '../core/skins'
import { bus } from './bus'

const PET_WIDTH = 280
const PET_HEIGHT = 300
const MARGIN = 24
let handlersRegistered = false

export function createPetWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.workArea

  const win = new BrowserWindow({
    width: PET_WIDTH,
    height: PET_HEIGHT,
    x: x + width - PET_WIDTH - MARGIN,
    y: y + height - PET_HEIGHT - MARGIN,
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

  win.setAlwaysOnTop(true, 'screen-saver')
  // 顯示在所有虛擬桌面 / Spaces（含全螢幕 App 的 Space）
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  win.setIgnoreMouseEvents(true, { forward: true })
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
        { type: 'separator' },
        { label: '通知中心', click: () => bus.emit('open-center') },
        { type: 'separator' },
        { label: '關閉小幫手', click: () => app.quit() },
      ])
      menu.popup({ window: win })
    })
  }
  return win
}
