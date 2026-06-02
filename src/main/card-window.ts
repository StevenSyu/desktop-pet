import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { pinWindow } from './win-util'

// 卡片視窗尺寸（含透明邊距給 CSS 陰影；定位以視窗 bounds 計）
export const CARD_W = 264
export const CARD_H = 148
export const CARD_GAP = 8

export function createCardWindow(channelId: string): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { x, y } = primary.workArea

  const win = new BrowserWindow({
    width: CARD_W,
    height: CARD_H,
    x, // 佔位座標，實際位置由 main 的 repositionCard() 設定
    y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/card.cjs'),
    },
  })

  // 置頂 + 跨 Spaces / 全螢幕（mac）；非 mac 走一般 alwaysOnTop。建立時設一次避免閃爍
  pinWindow(win, true)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/card.html?c=${encodeURIComponent(channelId)}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/card.html'), { query: { c: channelId } })
  }

  return win
}
