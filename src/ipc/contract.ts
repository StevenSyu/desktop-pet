// ============================================================================
// IPC Contract — main / preload / renderer 之間所有 IPC channel 的單一型別來源
// ============================================================================
//
// 三種方向各一張表。channel 名與 payload 型別只在此宣告一次；preload 的
// sendCommand/invokeQuery/subscribePush 與 main 的 handleCommand/handleQuery/
// pushTo 都對這三張表做型別檢查——channel 打錯或 payload 型別不符在編譯期就擋掉。
//
// 約定：
//   Command — renderer → main，單向（fire-and-forget）。value = payload 型別。
//   Query   — renderer → main，往返（request/response）。{ args, result }。
//   Push    — main → renderer，單向。value = payload 型別。
//
// payload 為 `void` 表示該 channel 不帶資料。

import type { AppEvent } from '../core/events'
import type { StoredMessage } from '../core/message-store'
import type { WalkBounds } from '../core/walk-planner'
import type { DiscoveredSkin } from '../core/skin-scan'
import type { CardView } from '../core/card-view'
import type { Prefs } from '../main/prefs'
import type { Channel, SourceMatch } from '../core/channel'

/** renderer → main，單向命令。 */
export interface Commands {
  'set-interactive': { channelId: string; interactive: boolean }
  'set-scale': { channelId: string; scale: number }
  'show-context-menu': { channelId: string }
  'open-center': { channelId: string }
  'mark-read': string
  'mark-read-ids': string[]
  'clear-messages': void
  'drag-start': { channelId: string; sx: number; sy: number }
  'drag-move': { channelId: string; sx: number; sy: number }
  'drag-end': { channelId: string }
  'walk-start': { channelId: string; direction: 'left' | 'right'; distance: number; duration: number }
  'walk-cancel': { channelId: string }
  'set-walk-bounds': Partial<WalkBounds>
  'set-dnd': boolean
  'open-pets-folder': void
  'show-card': { channelId: string; view: CardView }
  'hide-card': { channelId: string }
  'card-clicked': { channelId: string; id: string }
  'card-more': { channelId: string; id: string }
  'channel-upsert': Channel
  'channel-delete': { id: string }
  'set-all-enabled': boolean
  'open-skin-picker': { channelId: string }
}

/** renderer → main，往返查詢。 */
export interface Queries {
  'get-auto-walk': { args: void; result: boolean }
  'get-prefs': { args: void; result: Prefs }
  'get-dnd': { args: void; result: boolean }
  'get-messages': { args: void; result: StoredMessage[] }
  'get-skins': { args: { channelId: string }; result: { skins: DiscoveredSkin[]; requestedId: string; effectiveId: string } }
  'select-skin': { args: { channelId: string; id: string }; result: { ok: boolean; effectiveId: string } }
  'get-default-skin': { args: void; result: string }
  'get-pending-detail': { args: void; result: { id: string | null } }
  'get-pending-channel-tab': { args: void; result: string | null }
  'get-channels': { args: void; result: Channel[] }
  'get-known-sources': { args: void; result: SourceMatch[] }
  'get-all-enabled': { args: void; result: boolean }
}

/** main → renderer，單向推播。 */
export interface Pushes {
  'pet-event': AppEvent
  'set-skin': string
  'set-scale': number
  'unread-count': number
  'walk-ended': void
  'walk-direction': 'left' | 'right'
  'auto-walk-changed': boolean
  'prefs-changed': Prefs
  'dnd-on': void
  'dnd-changed': boolean
  'messages-updated': StoredMessage[]
  'card-data': CardView
  'card-dismissed': { id: string }
  'open-detail': void
  'open-channel-tab': void
  'channels-updated': Channel[]
  'known-sources-updated': SourceMatch[]
  'all-enabled-updated': boolean
  'default-skin-updated': string
}
