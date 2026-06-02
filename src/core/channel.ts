import type { NotifySource } from './events'

export interface SourceMatch { kind?: string; name?: string }
export interface Channel { id: string; name: string; skin: string; enabled: boolean; members: SourceMatch[] }

export function matchesSource(match: SourceMatch, source: NotifySource): boolean {
  if (match.kind == null && match.name == null) return false
  if (match.kind != null && match.kind !== source.kind) return false
  if (match.name != null && match.name !== source.name) return false
  return true
}
export function channelMatches(channel: Channel, source: NotifySource): boolean {
  return channel.members.some((m) => matchesSource(m, source))
}
export function matchingChannels(source: NotifySource, channels: Channel[]): string[] {
  return channels.filter((c) => c.enabled && channelMatches(c, source)).map((c) => c.id)
}
/** 沒有任何既有 channel（含停用）的 members 命中此 source → 需自動建。 */
export function needsAutoChannel(source: NotifySource, channels: Channel[]): boolean {
  return !channels.some((c) => channelMatches(c, source))
}
export function filterByChannel<T extends { source: NotifySource }>(messages: T[], channelId: string, channels: Channel[]): T[] {
  if (channelId === 'all') return messages
  const ch = channels.find((c) => c.id === channelId)
  if (!ch) return []
  return messages.filter((m) => channelMatches(ch, m.source))
}
export function unreadByChannel(messages: { source: NotifySource; read: boolean }[], channels: Channel[]): Record<string, number> {
  const out: Record<string, number> = { all: messages.filter((m) => !m.read).length }
  for (const c of channels) {
    if (!c.enabled) continue
    out[c.id] = messages.filter((m) => !m.read && channelMatches(c, m.source)).length
  }
  return out
}
function sanitizeMatch(raw: unknown): SourceMatch | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const m: SourceMatch = {}
  if (typeof o.kind === 'string' && o.kind) m.kind = o.kind
  if (typeof o.name === 'string' && o.name) m.name = o.name
  return m.kind == null && m.name == null ? null : m
}
/** 已知來源池驗證：array of SourceMatch（至少一有效欄）。 */
export function sanitizeSources(raw: unknown): SourceMatch[] {
  if (!Array.isArray(raw)) return []
  const out: SourceMatch[] = []
  for (const r of raw) { const m = sanitizeMatch(r); if (m) out.push(m) }
  return out
}
/** channels 驗證：壞欄位丟棄、members 為非空 SourceMatch[]。 */
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
    const members = Array.isArray(o.members) ? sanitizeSources(o.members) : []
    if (!id || !name || members.length === 0) continue
    out.push({ id, name, skin, enabled, members })
  }
  return out
}

/** 目前會顯示的寵物數：allEnabled 的「全部」+ 啟用中的頻道。用於「至少保留一隻」防呆。 */
export function activePetCount(channels: Channel[], allEnabled: boolean): number {
  return (allEnabled ? 1 : 0) + channels.filter((c) => c.enabled).length
}
