import type { NotifySource } from './events'

export interface SourceMatch { kind?: string; name?: string }
export interface Channel { id: string; name: string; skin: string; enabled: boolean; showPet: boolean; pomodoroEnabled: boolean; members: SourceMatch[] }

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
    const showPet = typeof o.showPet === 'boolean' ? o.showPet : true // 向後相容：舊檔無 showPet → 顯示
    const pomodoroEnabled = typeof o.pomodoroEnabled === 'boolean' ? o.pomodoroEnabled : false // 向後相容：舊檔無此欄 → 關閉
    const members = Array.isArray(o.members) ? sanitizeSources(o.members) : []
    if (!id || !name || members.length === 0) continue
    out.push({ id, name, skin, enabled, showPet, pomodoroEnabled, members })
  }
  return out
}

/** 實際顯示的寵物數：allEnabled 的「全部」+ 「啟用且寵物顯示」的頻道（enabled && showPet）。
 *  用於「至少保留一隻顯示在外」防呆。停用頻道連帶關寵物，故只算 enabled && showPet。 */
export function activePetCount(channels: Channel[], allEnabled: boolean): number {
  return (allEnabled ? 1 : 0) + channels.filter((c) => c.enabled && c.showPet).length
}

// ──────────────── 頻道目錄：來源池 / 成員編輯 / 自動偵測決策（純函式） ────────────────

/** 來源唯一鍵（kind+name 串接），池與成員去重用。整類項（無 name）鍵尾為空。 */
export const sourceKey = (s: SourceMatch): string => `${s.kind ?? ''} ${s.name ?? ''}`

/** 來源加入頻道成員的結果：
 * - 已存在（同 sourceKey）→ null（呼叫端不動作）
 * - 整類項（無 name）→ 先吸收同 kind 精確成員（已被整類涵蓋、留著冗餘）再加入
 * - 精確項 → 直接加入
 */
export function absorbMember(members: SourceMatch[], toAdd: SourceMatch): SourceMatch[] | null {
  if (members.some((m) => sourceKey(m) === sourceKey(toAdd))) return null
  const kept = toAdd.name == null ? members.filter((m) => m.kind !== toAdd.kind) : members
  return [...kept, { ...toAdd }]
}

/** 已知來源池（成員編輯左欄）：
 * - 排除已被頻道成員涵蓋的來源（精確命中或被整類涵蓋）
 * - 依 kind 分組排序；同 kind 內整類項排最前（group header）、精確項依名稱
 */
export function sourcePool(known: SourceMatch[], ch: Channel): SourceMatch[] {
  return known
    .filter((s) => !ch.members.some((m) => matchesSource(m, { kind: s.kind ?? '', name: s.name })))
    .sort((a, b) => {
      const ka = a.kind ?? ''
      const kb = b.kind ?? ''
      if (ka !== kb) return ka.localeCompare(kb)
      if ((a.name == null) !== (b.name == null)) return a.name == null ? -1 : 1
      return (a.name ?? '').localeCompare(b.name ?? '')
    })
}

/** 頻道目錄狀態：一筆來源事件決策的輸入/輸出單位。 */
export interface ChannelState {
  channels: Channel[]
  knownSources: SourceMatch[]
  allEnabled: boolean
}
export interface SourceEventOpts {
  defaultSkin: string
  nextId: () => string
  maxKnown: number
  maxAuto: number
}
export interface SourceEventResult {
  state: ChannelState
  knownChanged: boolean
  channelsChanged: boolean
  petsChanged: boolean
}

/** 一筆來源事件對頻道目錄的全部影響（純決策；persist/broadcast/reconcile 由呼叫端依 flags 執行）：
 * 1. 已知來源池補登：精確項（kind+name）+ 該 kind 整類項（各自去重、上限 maxKnown）
 * 2. 自動建頻道：只建「啟用」的精確 source 頻道 → 新來源即跳一隻專屬寵物；
 *    kind 整類不自動建頻道（否則新 kind+新來源一次冒兩頻道兩寵物），由使用者從來源池拖出
 * 3. 死角兜底：當下無任何「顯示中」寵物能接到此來源（allEnabled 關 + 無命中的顯示頻道）
 *    → 啟用第一個命中的頻道（有 name 的來源已由 2 涵蓋，此處主要處理無 name 來源）
 */
export function applySourceEvent(state: ChannelState, source: NotifySource, opts: SourceEventOpts): SourceEventResult {
  let { channels, knownSources } = state
  const { allEnabled } = state
  const addKnown = (sm: SourceMatch): boolean => {
    const k = sourceKey(sm)
    if (knownSources.length >= opts.maxKnown || knownSources.some((s) => sourceKey(s) === k)) return false
    knownSources = [...knownSources, sm]
    return true
  }
  const namedSource = source.name ? { kind: source.kind, name: source.name } : null
  const addedNamedSource = namedSource ? addKnown(namedSource) : false
  let knownChanged = source.name ? addedNamedSource : addKnown({ kind: source.kind })
  if (source.name && addKnown({ kind: source.kind })) knownChanged = true

  let channelsChanged = false
  let petsChanged = false
  const hasMember = (pred: (m: SourceMatch) => boolean): boolean => channels.some((c) => c.members.some(pred))
  if (source.name && addedNamedSource && channels.length < opts.maxAuto && !hasMember((m) => m.kind === source.kind && m.name === source.name)) {
    channels = [...channels, { id: opts.nextId(), name: source.name, skin: opts.defaultSkin, enabled: true, showPet: true, pomodoroEnabled: false, members: [{ kind: source.kind, name: source.name }] }]
    channelsChanged = true
    petsChanged = true
  }

  const covered = allEnabled || channels.some((c) => c.enabled && c.showPet && channelMatches(c, source))
  if (!covered) {
    const target = channels.find((c) => channelMatches(c, source))
    if (target && !(target.enabled && target.showPet)) {
      channels = channels.map((c) => (c.id === target.id ? { ...c, enabled: true, showPet: true } : c))
      channelsChanged = true
      petsChanged = true
    }
  }
  return { state: { channels, knownSources, allEnabled }, knownChanged, channelsChanged, petsChanged }
}

/** 啟動 self-heal：補齊既有來源各 kind 缺的整類項（早於整類邏輯記錄的舊來源不會有）。無變 → null。 */
export function healKnownKinds(known: SourceMatch[], maxKnown: number): SourceMatch[] | null {
  const kinds = new Set(known.map((s) => s.kind).filter((k): k is string => !!k))
  let out = known
  for (const kind of kinds) {
    if (out.length >= maxKnown) break
    if (!out.some((s) => s.kind === kind && s.name == null)) out = [...out, { kind }]
  }
  return out === known ? null : out
}

/** 啟動 self-heal：指向不存在造型的頻道回正成 fallback。無變 → null。 */
export function healSkins(channels: Channel[], valid: Set<string>, fallback: string): Channel[] | null {
  let changed = false
  const out = channels.map((c) => {
    if (c.skin && !valid.has(c.skin)) {
      changed = true
      return { ...c, skin: fallback }
    }
    return c
  })
  return changed ? out : null
}
