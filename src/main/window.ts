import { BrowserWindow, screen, ipcMain } from 'electron'
import { join } from 'node:path'

const PET_WIDTH = 180
const PET_HEIGHT = 220
const MARGIN = 24
let interactiveHandlerRegistered = false

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
      preload: join(__dirname, '../preload/index.js'),
    },
  })

  win.setAlwaysOnTop(true, 'screen-saver')

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  win.setIgnoreMouseEvents(true, { forward: true })
  if (!interactiveHandlerRegistered) {
    interactiveHandlerRegistered = true
    ipcMain.on('set-interactive', (_event, interactive: boolean) => {
      win.setIgnoreMouseEvents(!interactive, { forward: true })
    })
  }
  return win
}
