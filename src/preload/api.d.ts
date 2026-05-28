import type { AppEvent } from '../core/events'
import type { StoredMessage } from '../core/message-store'

declare global {
  interface Window {
    petBridge: {
      onPetEvent: (cb: (event: AppEvent) => void) => void
      setInteractive: (interactive: boolean) => void
      showContextMenu: () => void
      onSetSkin: (cb: (id: string) => void) => void
      onUnreadCount: (cb: (n: number) => void) => void
      markRead: (id: string) => void
      dragStart: (sx: number, sy: number) => void
      dragMove: (sx: number, sy: number) => void
      dragEnd: () => void
      walkStart: (req: { direction: 'left' | 'right'; distance: number; duration: number }) => void
      walkCancel: () => void
      onWalkEnded: (cb: () => void) => void
      getAutoWalk: () => Promise<boolean>
      onAutoWalkChanged: (cb: (enabled: boolean) => void) => void
      getMessages: () => Promise<StoredMessage[]>
      markAllRead: () => void
      clearMessages: () => void
      onMessagesUpdated: (cb: (msgs: StoredMessage[]) => void) => void
    }
  }
}
export {}
