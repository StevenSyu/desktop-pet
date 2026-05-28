import type { AppEvent } from '../core/events'

declare global {
  interface Window {
    petBridge: {
      onPetEvent: (cb: (event: AppEvent) => void) => void
      setInteractive: (interactive: boolean) => void
      showContextMenu: () => void
      onSetSkin: (cb: (id: string) => void) => void
    }
  }
}
export {}
