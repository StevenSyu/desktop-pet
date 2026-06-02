import type { AppEvent } from '../core/events'
import type { StoredMessage } from '../core/message-store'
import type { WalkBounds } from '../core/walk-planner'
import type { DiscoveredSkin } from '../core/skin-scan'
import type { CardView } from '../core/card-view'
import type { Channel } from '../core/channel'

declare global {
  interface Window {
    petBridge: {
      onPetEvent: (cb: (event: AppEvent) => void) => void
      setInteractive: (channelId: string, interactive: boolean) => void
      showContextMenu: (channelId: string) => void
      openCenter: (channelId: string) => void
      onSetSkin: (cb: (id: string) => void) => void
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
      getPrefs: () => Promise<{ autoWalk: boolean; walk: WalkBounds }>
      getSkins: () => Promise<{ skins: DiscoveredSkin[]; requestedId: string; effectiveId: string }>
      selectSkin: (id: string) => Promise<{ ok: boolean; effectiveId: string }>
      openPetsFolder: () => void
      setWalkBounds: (bounds: Partial<WalkBounds>) => void
      onPrefsChanged: (cb: (prefs: { autoWalk: boolean; walk: WalkBounds }) => void) => void
      setDnd: (enabled: boolean) => void
      getDnd: () => Promise<boolean>
      onDndOn: (cb: () => void) => void
      onDndChanged: (cb: (enabled: boolean) => void) => void
      getMessages: () => Promise<StoredMessage[]>
      markAllRead: () => void
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
      onKnownSourcesUpdated: (cb: (s: import('../core/channel').SourceMatch[]) => void) => void
      getSkins: () => Promise<{
        skins: import('../core/skin-scan').DiscoveredSkin[]
        requestedId: string
        effectiveId: string
      }>
    }
  }
}
export {}
