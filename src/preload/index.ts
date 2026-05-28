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
})
