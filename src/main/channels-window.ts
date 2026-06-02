import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { pinWindow, toolWindowChrome } from './win-util'

const W = 480
const H = 620

export function createChannelsWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.workArea

  const win = new BrowserWindow({
    ...toolWindowChrome({ title: '寵物設定' }),
    width: W,
    height: H,
    x: x + Math.max(0, Math.floor((width - W) / 2)),
    y: y + Math.max(0, Math.floor((height - H) / 2)),
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/channels.cjs'),
    },
  })

  pinWindow(win)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/channels.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/channels.html'))
  }
  return win
}
