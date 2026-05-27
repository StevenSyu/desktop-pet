import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('petBridge', {
  ping: () => 'pong',
})
