import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

const W = 480
const H = 520

export function createSkinWindow(channelId: string): BrowserWindow {
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

  win.setAlwaysOnTop(true, 'floating')

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/skins.html?c=${encodeURIComponent(channelId)}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/skins.html'), { query: { c: channelId } })
  }
  return win
}
