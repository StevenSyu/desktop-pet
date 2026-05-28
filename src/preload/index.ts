import { contextBridge, ipcRenderer } from 'electron'
import type { AppEvent } from '../core/events'
import type { WalkBounds } from '../core/walk-planner'

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
  dragStart: (sx: number, sy: number) => ipcRenderer.send('drag-start', sx, sy),
  dragMove: (sx: number, sy: number) => ipcRenderer.send('drag-move', sx, sy),
  dragEnd: () => ipcRenderer.send('drag-end'),
  walkStart: (req: { direction: 'left' | 'right'; distance: number; duration: number }) =>
    ipcRenderer.send('walk-start', req),
  walkCancel: () => ipcRenderer.send('walk-cancel'),
  onWalkEnded: (cb: () => void) => {
    ipcRenderer.on('walk-ended', () => cb())
  },
  onWalkDirection: (cb: (direction: 'left' | 'right') => void) => {
    ipcRenderer.on('walk-direction', (_e, direction: 'left' | 'right') => cb(direction))
  },
  getAutoWalk: () => ipcRenderer.invoke('get-auto-walk') as Promise<boolean>,
  onAutoWalkChanged: (cb: (enabled: boolean) => void) => {
    ipcRenderer.on('auto-walk-changed', (_e, enabled: boolean) => cb(enabled))
  },
  getPrefs: () => ipcRenderer.invoke('get-prefs') as Promise<{ autoWalk: boolean; walk: WalkBounds }>,
  setWalkBounds: (bounds: Partial<WalkBounds>) => ipcRenderer.send('set-walk-bounds', bounds),
  onPrefsChanged: (cb: (prefs: { autoWalk: boolean; walk: WalkBounds }) => void) => {
    ipcRenderer.on('prefs-changed', (_e, prefs) => cb(prefs))
  },
  getMessages: () => ipcRenderer.invoke('get-messages'),
  markAllRead: () => ipcRenderer.send('mark-all-read'),
  clearMessages: () => ipcRenderer.send('clear-messages'),
  onMessagesUpdated: (cb: (msgs: unknown[]) => void) => {
    ipcRenderer.on('messages-updated', (_e, msgs) => cb(msgs))
  },
})
