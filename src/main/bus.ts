import { EventEmitter } from 'node:events'

// main 端的小型事件匯流排，解耦視窗事件（右鍵選單／拖動）與其消費者。
// 事件名與 payload 與 IPC contract 同紀律：只在 BusEvents 表宣告一次，
// busEmit / busOn 對表做編譯期檢查，事件名打錯或 payload 不符在 tsc 階段擋下。

export type PetBounds = { x: number; y: number; width: number; height: number }

export interface BusEvents {
  'pet-drag-start': [channelId: string]
  'pet-drag-end': [channelId: string]
  /** 拖動 / display-removed 重吸附後的寵物視窗 bounds（同步卡片位置用）。 */
  'pet-moved': [channelId: string, bounds?: PetBounds]
  'open-center': [channelId?: string]
  'open-settings': []
  'open-skins': [channelId?: string]
  'open-channels': []
  'close-pet': [channelId: string]
}

const bus = new EventEmitter()
bus.setMaxListeners(50) // 多 module 訂閱 + 測試多 instance，避免 MaxListenersExceededWarning

export function busEmit<K extends keyof BusEvents>(event: K, ...args: BusEvents[K]): void {
  bus.emit(event, ...args)
}

export function busOn<K extends keyof BusEvents>(event: K, listener: (...args: BusEvents[K]) => void): () => void {
  bus.on(event, listener as (...args: unknown[]) => void)
  return () => bus.off(event, listener as (...args: unknown[]) => void)
}
