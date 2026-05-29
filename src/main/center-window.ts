import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

export const CENTER_W = 300
export const CENTER_H = 440
const MARGIN = 24
const PET_RESERVE = 320 // 寵物視窗高度的預留，讓中心落在寵物上方（fallback 用）

export function createCenterWindow(pos?: { x: number; y: number }): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.workArea

  const win = new BrowserWindow({
    width: CENTER_W,
    height: CENTER_H,
    x: pos?.x ?? x + width - CENTER_W - MARGIN,
    y: pos?.y ?? Math.max(y + 8, y + height - CENTER_H - MARGIN - PET_RESERVE),
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
