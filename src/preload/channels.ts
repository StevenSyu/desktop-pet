import { contextBridge, ipcRenderer } from 'electron'
import type { Channel } from '../core/channel'
import type { DiscoveredSkin } from '../core/skin-scan'

contextBridge.exposeInMainWorld('channelsBridge', {
  getChannels: (): Promise<Channel[]> => ipcRenderer.invoke('get-channels'),
  upsertChannel: (ch: Channel) => ipcRenderer.send('channel-upsert', ch),
  deleteChannel: (id: string) => ipcRenderer.send('channel-delete', { id }),
  onChannelsUpdated: (cb: (channels: Channel[]) => void) =>
    ipcRenderer.on('channels-updated', (_e, channels: Channel[]) => cb(channels)),
  getSkins: (): Promise<{ skins: DiscoveredSkin[]; requestedId: string; effectiveId: string }> =>
    ipcRenderer.invoke('get-skins'),
})
