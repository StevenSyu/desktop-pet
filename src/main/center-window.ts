import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { pinWindow, toolWindowChrome } from './win-util'

export const CENTER_W = 360
export const CENTER_H = 480
const MARGIN = 24
const PET_RESERVE = 320 // 寵物視窗高度的預留，讓中心落在寵物上方（fallback 用）

export function createCenterWindow(pos?: { x: number; y: number }): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.workArea

  const win = new BrowserWindow({
    ...toolWindowChrome({ title: '通知中心' }),
    width: CENTER_W,
    height: CENTER_H,
    x: pos?.x ?? x + width - CENTER_W - MARGIN,
    y: pos?.y ?? Math.max(y + 8, y + height - CENTER_H - MARGIN - PET_RESERVE),
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
    },
  })

  pinWindow(win, true)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/center.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/center.html'))
  }

  // 失焦不自動關閉：避免點桌面卡片/寵物時連帶關掉通知中心（#4）。只由 ✕ / Esc 關。
  return win
}
