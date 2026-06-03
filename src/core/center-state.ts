import type { StoredMessage } from './message-store'
import type { NotifyType } from './events'
import { filterByChannel, unreadByChannel, type Channel } from './channel'
import { collectSessions, filterBySession } from './session-filter'

// 通知中心的 list/detail 狀態機：分頁、type/session 篩選、詳情切換、scroll/flash 還原
// 全部收在純 reducer。adapter（renderer/center.ts）只 dispatch 事件、把 centerView 投影成 DOM。

export interface CenterState {
  messages: StoredMessage[]
  channels: Channel[]
  typeFilter: 'all' | NotifyType
  channelTab: string
  sessionFilter: string
  detailId: string | null
  scrollTop: number // 進詳情時記住的列表捲動位置，回列表還原
  flashId: string | null // 回列表時要高亮的訊息（一次性，flashShown 消費）
}

export type CenterEvent =
  | { kind: 'messages'; messages: StoredMessage[] }
  | { kind: 'channels'; channels: Channel[] }
  | { kind: 'pickType'; filter: CenterState['typeFilter'] }
  | { kind: 'pickSession'; session: string }
  | { kind: 'pickTab'; tab: string }
  | { kind: 'openDetail'; id: string; scrollTop: number }
  | { kind: 'backToList' }
  | { kind: 'flashShown' } // 列表已渲染過 flash → 清掉

export function initialCenterState(): CenterState {
  return {
    messages: [],
    channels: [],
    typeFilter: 'all',
    channelTab: 'all',
    sessionFilter: 'all',
    detailId: null,
    scrollTop: 0,
    flashId: null,
  }
}

// 輸入變更後的扶正：分頁指向已停用/刪除頻道 → 退回 all；
// session 在目前頻道內消失 → 退回 all；詳情訊息已被清空/淘汰 → fallback 回列表。
function normalize(s: CenterState): CenterState {
  let next = s
  if (next.channelTab !== 'all' && !next.channels.some((c) => c.enabled && c.id === next.channelTab)) {
    next = { ...next, channelTab: 'all' }
  }
  const sessions = collectSessions(filterByChannel(next.messages, next.channelTab, next.channels))
  if (next.sessionFilter !== 'all' && !sessions.includes(next.sessionFilter)) {
    next = { ...next, sessionFilter: 'all' }
  }
  if (next.detailId && !next.messages.some((m) => m.id === next.detailId)) {
    next = { ...next, detailId: null }
  }
  return next
}

export function centerReduce(s: CenterState, e: CenterEvent): CenterState {
  switch (e.kind) {
    case 'messages':
      return normalize({ ...s, messages: e.messages })
    case 'channels':
      return normalize({ ...s, channels: e.channels })
    case 'pickType':
      return { ...s, typeFilter: e.filter }
    case 'pickSession':
      return { ...s, sessionFilter: e.session }
    case 'pickTab':
      return normalize({ ...s, channelTab: e.tab })
    case 'openDetail':
      return normalize({ ...s, detailId: e.id, scrollTop: e.scrollTop })
    case 'backToList':
      return { ...s, flashId: s.detailId, detailId: null }
    case 'flashShown':
      return s.flashId ? { ...s, flashId: null } : s
  }
}

export interface CenterTabView {
  id: string
  name: string
  unread: number
}

export interface CenterView {
  mode: 'list' | 'detail'
  detail: StoredMessage | null
  tabs: CenterTabView[]
  sessions: string[] // 目前頻道內的非 default sessions（≥2 才該顯示下拉）
  items: StoredMessage[] // 分頁 + session + type 篩選後可見的訊息
  unreadTotal: number
  channelTab: string
  typeFilter: CenterState['typeFilter']
  sessionFilter: string
  scrollTop: number
  flashId: string | null
}

export function centerView(s: CenterState): CenterView {
  const detail = s.detailId ? (s.messages.find((m) => m.id === s.detailId) ?? null) : null
  const counts = unreadByChannel(s.messages, s.channels)
  const tabs: CenterTabView[] = [
    { id: 'all', name: '全部', unread: counts.all ?? 0 },
    ...s.channels.filter((c) => c.enabled).map((c) => ({ id: c.id, name: c.name, unread: counts[c.id] ?? 0 })),
  ]
  const inChannel = filterByChannel(s.messages, s.channelTab, s.channels)
  const byChannel = filterBySession(inChannel, s.sessionFilter)
  const items = s.typeFilter === 'all' ? byChannel : byChannel.filter((m) => m.type === s.typeFilter)
  return {
    mode: detail ? 'detail' : 'list',
    detail,
    tabs,
    sessions: collectSessions(inChannel),
    items,
    unreadTotal: s.messages.filter((m) => !m.read).length,
    channelTab: s.channelTab,
    typeFilter: s.typeFilter,
    sessionFilter: s.sessionFilter,
    scrollTop: s.scrollTop,
    flashId: s.flashId,
  }
}
