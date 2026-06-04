import type { NotifyType } from './events'

/** 卡片視窗顯示用的精簡資料（pet renderer 組好 → main → card renderer 純顯示）。 */
export interface CardView {
  id: string
  type: NotifyType
  /** 狀態標籤，如「完成」「錯誤」（由 type 對應，pet renderer 算好）。 */
  label: string
  /** 內文，已 stripMarkdown；無內文則為空字串。 */
  body: string
  /** 來源 + session 短碼組合字串；無則為空字串。 */
  source: string
  /** 內文是否被精簡（截斷/多行）→ 卡片顯示「更多」入口。 */
  hasMore: boolean
  /** 即時通知（transient notice）：自動消失毫秒數。undefined = 持久訊息（進通知中心那類）。 */
  transient?: { dismissMs: number }
}
