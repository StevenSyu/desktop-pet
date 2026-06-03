import type { CardView } from './card-view'

// 單一卡片視窗的生命週期狀態機：show / loaded / hide / dismiss 的時序決策。
// adapter（main/index.ts）持有 BrowserWindow 與 per-channel 狀態，只執行回傳指令：
// flush = 推 card-data + showInactive + reposition；hide = win.hide()；
// notifyDismissed = 通知該寵物標已讀。幾何（cardWindowBounds）與拖動同步留在 adapter。

export interface CardLifecycleState {
  loaded: boolean // did-finish-load 是否完成
  pending: CardView | null // 視窗載入完成前暫存的卡片內容
  activeId: string | null // 目前顯示中的訊息 id
}

export type CardEvent =
  | { kind: 'show'; view: CardView }
  | { kind: 'loaded' }
  | { kind: 'hide' }
  | { kind: 'dismiss'; id: string } // 同 id 才反應（防舊卡片誤關）

export type CardCommand =
  | { type: 'flush'; view: CardView }
  | { type: 'hide' }
  | { type: 'notifyDismissed'; id: string }

export const initialCardState: CardLifecycleState = { loaded: false, pending: null, activeId: null }

export function cardReduce(
  s: CardLifecycleState,
  e: CardEvent,
): { state: CardLifecycleState; commands: CardCommand[] } {
  switch (e.kind) {
    case 'show':
      if (s.loaded) {
        return { state: { ...s, pending: null, activeId: e.view.id }, commands: [{ type: 'flush', view: e.view }] }
      }
      // 未載入完成 → 暫存，等 loaded 再 flush
      return { state: { ...s, pending: e.view, activeId: e.view.id }, commands: [] }
    case 'loaded':
      if (s.pending) {
        return { state: { ...s, loaded: true, pending: null }, commands: [{ type: 'flush', view: s.pending }] }
      }
      return { state: { ...s, loaded: true }, commands: [] }
    case 'hide':
      return { state: { ...s, pending: null, activeId: null }, commands: [{ type: 'hide' }] }
    case 'dismiss':
      if (s.activeId !== e.id) return { state: s, commands: [] }
      // pending 一併清掉：載入中被 dismiss 的卡片不得在 loaded 後復活（ghost card）
      return {
        state: { ...s, pending: null, activeId: null },
        commands: [{ type: 'hide' }, { type: 'notifyDismissed', id: e.id }],
      }
  }
}
