import { app, BrowserWindow } from 'electron'
import { createPetWindow } from './window'
import { createCenterWindow } from './center-window'
import { createSettingsWindow } from './settings-window'
import { findFreePort, generateToken, writeEndpointFile } from './endpoint'
import { startIngestServer } from './ingest'
import { MessageStore } from '../core/message-store'
import { bus } from './bus'
import { loadPrefs } from './prefs'
import { handleCommand, handleQuery, pushTo } from '../ipc/main-helpers'
import type { AppEvent } from '../core/events'

const store = new MessageStore()
let petWindow: BrowserWindow | null = null
let centerWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let dndEnabled = false

function broadcastUnread(): void {
  pushTo(petWindow, 'unread-count', store.unreadCount())
}
function broadcastMessages(): void {
  pushTo(centerWindow, 'messages-updated', store.list())
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

  dndEnabled = loadPrefs(app.getPath('userData')).dnd
  bus.on('dnd-changed', (enabled: boolean) => {
    dndEnabled = enabled
  })

  const port = await findFreePort()
  const token = generateToken()
  writeEndpointFile(app.getPath('userData'), { port, token })

  startIngestServer({
    port,
    token,
    onEvent: (event: AppEvent) => {
      store.push(event)
      broadcastUnread()
      broadcastMessages()
      if (dndEnabled) return // 勿擾模式：不彈卡片、不演反應動畫
      pushTo(petWindow, 'pet-event', event)
    },
  })

  handleCommand('mark-read', (id) => {
    store.markRead(id)
    broadcastUnread()
    broadcastMessages()
  })
  handleCommand('mark-all-read', () => {
    store.markAllRead()
    broadcastUnread()
    broadcastMessages()
  })
  handleCommand('clear-messages', () => {
    store.clear()
    broadcastUnread()
    broadcastMessages()
  })
  handleQuery('get-messages', () => store.list())

  bus.on('open-center', openCenter)
  bus.on('open-settings', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus()
      return
    }
    settingsWindow = createSettingsWindow()
    settingsWindow.on('closed', () => {
      settingsWindow = null
    })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) petWindow = createPetWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
