import { app, BrowserWindow, ipcMain } from 'electron'
import { createPetWindow } from './window'
import { createCenterWindow } from './center-window'
import { findFreePort, generateToken, writeEndpointFile } from './endpoint'
import { startIngestServer } from './ingest'
import { MessageStore } from '../core/message-store'
import { bus } from './bus'
import type { AppEvent } from '../core/events'

const store = new MessageStore()
let petWindow: BrowserWindow | null = null
let centerWindow: BrowserWindow | null = null

function broadcastUnread(): void {
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('unread-count', store.unreadCount())
}
function broadcastMessages(): void {
  if (centerWindow && !centerWindow.isDestroyed()) centerWindow.webContents.send('messages-updated', store.list())
}

function openCenter(): void {
  if (centerWindow && !centerWindow.isDestroyed()) {
    centerWindow.focus()
    return
  }
  centerWindow = createCenterWindow()
  centerWindow.on('closed', () => {
    centerWindow = null
  })
  centerWindow.webContents.once('did-finish-load', () => broadcastMessages())
}

app.whenReady().then(async () => {
  petWindow = createPetWindow()

  const port = await findFreePort()
  const token = generateToken()
  writeEndpointFile(app.getPath('userData'), { port, token })

  startIngestServer({
    port,
    token,
    onEvent: (event: AppEvent) => {
      store.push(event)
      if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet-event', event)
      broadcastUnread()
      broadcastMessages()
    },
  })

  ipcMain.on('mark-read', (_e, id: string) => {
    store.markRead(id)
    broadcastUnread()
    broadcastMessages()
  })
  ipcMain.on('mark-all-read', () => {
    store.markAllRead()
    broadcastUnread()
    broadcastMessages()
  })
  ipcMain.on('clear-messages', () => {
    store.clear()
    broadcastUnread()
    broadcastMessages()
  })
  ipcMain.handle('get-messages', () => store.list())

  bus.on('open-center', openCenter)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) petWindow = createPetWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
