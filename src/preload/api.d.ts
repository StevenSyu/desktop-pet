import type { AppEvent } from '../core/events'

declare global {
  interface Window {
    petBridge: {
      onPetEvent: (cb: (event: AppEvent) => void) => void
      setInteractive: (interactive: boolean) => void
    }
  }
}
export {}
