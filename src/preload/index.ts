import { contextBridge, ipcRenderer } from 'electron'
import type { AppEvent } from '../core/events'

contextBridge.exposeInMainWorld('petBridge', {
  onPetEvent: (cb: (event: AppEvent) => void) => {
    ipcRenderer.on('pet-event', (_e, event: AppEvent) => cb(event))
  },
})
