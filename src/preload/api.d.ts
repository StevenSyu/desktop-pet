import type { AppEvent } from '../core/events'
import type { StoredMessage } from '../core/message-store'
import type { WalkBounds } from '../core/walk-planner'
import type { DiscoveredSkin } from '../core/skin-scan'
import type { CardView } from '../core/card-view'
import type { Channel, SourceMatch } from '../core/channel'
import type { ChannelLabelMode } from '../core/channel-label'

type BridgePrefs = {
  autoWalk: boolean
  walk: WalkBounds
  skin: string
  channelLabelMode: ChannelLabelMode
  dnd: boolean
  allEnabled: boolean
  channels: Channel[]
  knownSources: SourceMatch[]
}

declare global {
  interface Window {
    petBridge: {
      onPetEvent: (cb: (event: AppEvent) => void) => void
      setInteractive: (channelId: string, interactive: boolean) => void
      setScale: (channelId: string, scale: number) => void
      showContextMenu: (channelId: string) => void
      openCenter: (channelId: string) => void
      onSetSkin: (cb: (id: string) => void) => void
      onSetScale: (cb: (scale: number) => void) => void
      onUnreadCount: (cb: (n: number) => void) => void
      markRead: (id: string) => void
      dragStart: (channelId: string, sx: number, sy: number) => void
      dragMove: (channelId: string, sx: number, sy: number) => void
      dragEnd: (channelId: string) => void
      walkStart: (channelId: string, req: { direction: 'left' | 'right'; distance: number; duration: number }) => void
      walkCancel: (channelId: string) => void
      onWalkEnded: (cb: () => void) => void
      onWalkDirection: (cb: (direction: 'left' | 'right') => void) => void
      getAutoWalk: () => Promise<boolean>
      onAutoWalkChanged: (cb: (enabled: boolean) => void) => void
      getPrefs: () => Promise<BridgePrefs>
      getSkins: (channelId: string) => Promise<{ skins: DiscoveredSkin[]; requestedId: string; effectiveId: string }>
      selectSkin: (channelId: string, id: string) => Promise<{ ok: boolean; effectiveId: string }>
      openPetsFolder: () => void
      setWalkBounds: (bounds: Partial<WalkBounds>) => void
      onPrefsChanged: (cb: (prefs: BridgePrefs) => void) => void
      setDnd: (enabled: boolean) => void
      getDnd: () => Promise<boolean>
      onDndOn: (cb: () => void) => void
      onDndChanged: (cb: (enabled: boolean) => void) => void
      getMessages: () => Promise<StoredMessage[]>
      markReadIds: (ids: string[]) => void
      clearMessages: () => void
      onMessagesUpdated: (cb: (msgs: StoredMessage[]) => void) => void
      showCard: (channelId: string, view: CardView) => void
      hideCard: (channelId: string) => void
      onCardDismissed: (cb: (p: { id: string }) => void) => void
      getPendingDetail: () => Promise<{ id: string | null }>
      onOpenDetail: (cb: () => void) => void
      getPendingChannelTab: () => Promise<string | null>
      onOpenChannelTab: (cb: () => void) => void
      getChannels: () => Promise<Channel[]>
      onChannelsUpdated: (cb: (channels: Channel[]) => void) => void
    }
    cardBridge: {
      onCardData: (cb: (view: CardView) => void) => void
      cardClicked: (channelId: string, id: string) => void
      cardMore: (channelId: string, id: string) => void
    }
    channelsBridge: {
      getChannels: () => Promise<Channel[]>
      upsertChannel: (ch: Channel) => void
      deleteChannel: (id: string) => void
      getAllEnabled: () => Promise<boolean>
      setAllEnabled: (v: boolean) => void
      onAllEnabledUpdated: (cb: (v: boolean) => void) => void
      onChannelsUpdated: (cb: (channels: Channel[]) => void) => void
      getKnownSources: () => Promise<import('../core/channel').SourceMatch[]>
      removeKnownSource: (s: import('../core/channel').SourceMatch) => void
      onKnownSourcesUpdated: (cb: (s: import('../core/channel').SourceMatch[]) => void) => void
      getSkins: () => Promise<{
        skins: import('../core/skin-scan').DiscoveredSkin[]
        requestedId: string
        effectiveId: string
      }>
      openSkinPicker: (channelId: string) => void
      getDefaultSkin: () => Promise<string>
      onDefaultSkinUpdated: (cb: (id: string) => void) => void
    }
  }
}
export {}
