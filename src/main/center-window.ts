import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

const W = 300
const H = 440
const MARGIN = 24
const PET_RESERVE = 320 // 寵物視窗高度的預留，讓中心落在寵物上方

export function createCenterWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.workArea

  const win = new BrowserWindow({
    width: W,
    height: H,
    x: x + width - W - MARGIN,
    y: Math.max(y + 8, y + height - H - MARGIN - PET_RESERVE),
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
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/center.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/center.html'))
  }

  win.on('blur', () => {
    if (!win.isDestroyed()) win.close()
  })
  return win
}
