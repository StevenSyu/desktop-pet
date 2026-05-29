import type { AppEvent } from '../core/events'
import type { StoredMessage } from '../core/message-store'
import type { WalkBounds } from '../core/walk-planner'
import type { DiscoveredSkin } from '../core/skin-scan'
import type { CardView } from '../core/card-view'

declare global {
  interface Window {
    petBridge: {
      onPetEvent: (cb: (event: AppEvent) => void) => void
      setInteractive: (interactive: boolean) => void
      showContextMenu: () => void
      openCenter: () => void
      onSetSkin: (cb: (id: string) => void) => void
      onUnreadCount: (cb: (n: number) => void) => void
      markRead: (id: string) => void
      dragStart: (sx: number, sy: number) => void
      dragMove: (sx: number, sy: number) => void
      dragEnd: () => void
      walkStart: (req: { direction: 'left' | 'right'; distance: number; duration: number }) => void
      walkCancel: () => void
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
      showCard: (view: CardView) => void
      hideCard: () => void
      onCardDismissed: (cb: (p: { id: string }) => void) => void
      getPendingDetail: () => Promise<{ id: string | null }>
      onOpenDetail: (cb: () => void) => void
    }
    cardBridge: {
      onCardData: (cb: (view: CardView) => void) => void
      cardClicked: (id: string) => void
      cardMore: (id: string) => void
    }
  }
}
export {}
