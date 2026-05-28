import { contextBridge, ipcRenderer } from 'electron'
import type { AppEvent } from '../core/events'

contextBridge.exposeInMainWorld('petBridge', {
  onPetEvent: (cb: (event: AppEvent) => void) => {
    ipcRenderer.on('pet-event', (_e, event: AppEvent) => cb(event))
  },
  setInteractive: (interactive: boolean) => ipcRenderer.send('set-interactive', interactive),
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
  onSetSkin: (cb: (id: string) => void) => {
    ipcRenderer.on('set-skin', (_e, id: string) => cb(id))
  },
  onUnreadCount: (cb: (n: number) => void) => {
    ipcRenderer.on('unread-count', (_e, n: number) => cb(n))
  },
  markRead: (id: string) => ipcRenderer.send('mark-read', id),
  getMessages: () => ipcRenderer.invoke('get-messages'),
  markAllRead: () => ipcRenderer.send('mark-all-read'),
  clearMessages: () => ipcRenderer.send('clear-messages'),
  onMessagesUpdated: (cb: (msgs: unknown[]) => void) => {
    ipcRenderer.on('messages-updated', (_e, msgs) => cb(msgs))
  },
})
