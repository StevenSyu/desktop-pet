import type { NotifySource } from './events'

export interface SourceMatch {
  kind?: string
  name?: string
}

export interface Channel {
  id: string
  name: string
  skin: string
  enabled: boolean
  match: SourceMatch
}

/** match 至少一欄；指定的欄位都須與 source 相等。空 matcher 不命中。 */
export function matchesSource(match: SourceMatch, source: NotifySource): boolean {
  if (match.kind == null && match.name == null) return false
  if (match.kind != null && match.kind !== source.kind) return false
  if (match.name != null && match.name !== source.name) return false
  return true
}

/** 回所有「enabled 且命中」的 channel id（不含隱含的 'all'）。可多屬（重疊）。 */
export function matchingChannels(source: NotifySource, channels: Channel[]): string[] {
  return channels.filter((c) => c.enabled && matchesSource(c.match, source)).map((c) => c.id)
}

/**
 * 是否該為此 source 自動建一個停用 channel：
 * (a) 沒有任何「啟用」channel 命中（matchingChannels 為空）且
 * (b) 不存在 match 完全等於 {kind, name} 的既有 channel（含停用，避免重複）。
 */
export function needsAutoChannel(source: NotifySource, channels: Channel[]): boolean {
  if (matchingChannels(source, channels).length > 0) return false
  const sn = source.name ?? undefined
  return !channels.some((c) => c.match.kind === source.kind && (c.match.name ?? undefined) === sn)
}

/** 'all' → 全部；否則回命中該 channel 的訊息（忽略 enabled，供分頁/預覽）。 */
export function filterByChannel<T extends { source: NotifySource }>(
  messages: T[],
  channelId: string,
  channels: Channel[],
): T[] {
  if (channelId === 'all') return messages
  const ch = channels.find((c) => c.id === channelId)
  if (!ch) return []
  return messages.filter((m) => matchesSource(ch.match, m.source))
}

/** { all: 總未讀, [id]: 該 enabled channel 未讀 }。 */
export function unreadByChannel(
  messages: { source: NotifySource; read: boolean }[],
  channels: Channel[],
): Record<string, number> {
  const out: Record<string, number> = { all: messages.filter((m) => !m.read).length }
  for (const c of channels) {
    if (!c.enabled) continue
    out[c.id] = messages.filter((m) => !m.read && matchesSource(c.match, m.source)).length
  }
  return out
}

/** 驗證持久化讀入的 channels：壞的丟棄、match 至少一有效欄。 */
export function sanitizeChannels(raw: unknown): Channel[] {
  if (!Array.isArray(raw)) return []
  const out: Channel[] = []
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue
    const o = r as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : null
    const name = typeof o.name === 'string' ? o.name : null
    const skin = typeof o.skin === 'string' ? o.skin : ''
    const enabled = typeof o.enabled === 'boolean' ? o.enabled : false
    const mraw = (typeof o.match === 'object' && o.match !== null ? o.match : {}) as Record<string, unknown>
    const match: SourceMatch = {}
    if (typeof mraw.kind === 'string' && mraw.kind) match.kind = mraw.kind
    if (typeof mraw.name === 'string' && mraw.name) match.name = mraw.name
    if (!id || !name || (match.kind == null && match.name == null)) continue
    out.push({ id, name, skin, enabled, match })
  }
  return out
}
