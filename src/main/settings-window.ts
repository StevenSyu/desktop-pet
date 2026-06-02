import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { pinWindow } from './win-util'

const W = 340
const H = 400

export function createSettingsWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.workArea

  const win = new BrowserWindow({
    width: W,
    height: H,
    x: x + Math.max(0, Math.floor((width - W) / 2)),
    y: y + Math.max(0, Math.floor((height - H) / 2)),
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
    },
  })

  pinWindow(win)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/settings.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/settings.html'))
  }
  // 不在失焦時自動關閉（使用者可能要切回查看 may，避免誤關設定）
  // 由視窗自身的「關閉」按鈕或 Esc 處理。
  return win
}
