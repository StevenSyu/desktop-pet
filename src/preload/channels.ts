import { contextBridge, ipcRenderer } from 'electron'
import type { Channel } from '../core/channel'
import type { DiscoveredSkin } from '../core/skin-scan'

contextBridge.exposeInMainWorld('channelsBridge', {
  getChannels: (): Promise<Channel[]> => ipcRenderer.invoke('get-channels'),
  upsertChannel: (ch: Channel) => ipcRenderer.send('channel-upsert', ch),
  deleteChannel: (id: string) => ipcRenderer.send('channel-delete', { id }),
  getAllEnabled: (): Promise<boolean> => ipcRenderer.invoke('get-all-enabled'),
  setAllEnabled: (v: boolean) => ipcRenderer.send('set-all-enabled', v),
  onAllEnabledUpdated: (cb: (v: boolean) => void) => ipcRenderer.on('all-enabled-updated', (_e, v) => cb(v)),
  onChannelsUpdated: (cb: (channels: Channel[]) => void) =>
    ipcRenderer.on('channels-updated', (_e, channels: Channel[]) => cb(channels)),
  getKnownSources: (): Promise<import('../core/channel').SourceMatch[]> => ipcRenderer.invoke('get-known-sources'),
  removeKnownSource: (s: import('../core/channel').SourceMatch) => ipcRenderer.send('remove-known-source', s),
  onKnownSourcesUpdated: (cb: (s: import('../core/channel').SourceMatch[]) => void) =>
    ipcRenderer.on('known-sources-updated', (_e, s) => cb(s)),
  getSkins: (): Promise<{ skins: DiscoveredSkin[]; requestedId: string; effectiveId: string }> =>
    ipcRenderer.invoke('get-skins', { channelId: 'all' }),
  openSkinPicker: (channelId: string) => ipcRenderer.send('open-skin-picker', { channelId }),
  getDefaultSkin: (): Promise<string> => ipcRenderer.invoke('get-default-skin'),
  onDefaultSkinUpdated: (cb: (id: string) => void) => ipcRenderer.on('default-skin-updated', (_e, id: string) => cb(id)),
})
