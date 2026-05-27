export type NotifyType = 'done' | 'attention' | 'error' | 'review' | 'working' | 'info'

const KNOWN_TYPES: NotifyType[] = ['done', 'attention', 'error', 'review', 'working', 'info']

export interface NotifySource {
  kind: string
  name?: string
}

/** 外部 POST /notify 的原始 payload（欄位多為選填）。 */
export interface NotifyPayload {
  id?: string
  source?: NotifySource | string
  sessionId?: string
  type?: string
  title?: string
  body?: string
  priority?: number | null
  timestamp?: number | null
  ttlMs?: number | null
  actions?: unknown[]
}

/** 正規化後的內部事件（所有欄位齊備）。 */
export interface AppEvent {
  id: string
  source: NotifySource
  sessionId: string
  type: NotifyType
  title: string
  body: string
  priority: number
  timestamp: number
  ttlMs: number
  actions: unknown[]
}

const PRIORITY: Record<NotifyType, number> = {
  error: 5,
  attention: 4,
  done: 3,
  review: 2,
  working: 1,
  info: 0,
}

export function typeToPriority(type: NotifyType): number {
  return PRIORITY[type]
}

export interface NormalizeDeps {
  now?: () => number
  uuid?: () => string
}

const DEFAULT_TTL_MS = 5000

// 中立的去重 id 產生器：不需密碼學強度，僅需在本行程內唯一。
// 不依賴 node:crypto 或 globalThis.crypto，使 core 保持平台中立。
let idCounter = 0
function fallbackId(): string {
  idCounter += 1
  return `${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function normalizePayload(raw: NotifyPayload, deps: NormalizeDeps = {}): AppEvent {
  const now = deps.now ?? (() => Date.now())
  const uuid = deps.uuid ?? fallbackId

  const type: NotifyType = KNOWN_TYPES.includes(raw.type as NotifyType)
    ? (raw.type as NotifyType)
    : 'info'

  const source: NotifySource =
    typeof raw.source === 'string'
      ? { kind: raw.source }
      : raw.source ?? { kind: 'unknown' }

  return {
    id: raw.id ?? uuid(),
    source,
    sessionId: raw.sessionId ?? 'default',
    type,
    title: raw.title ?? '',
    body: raw.body ?? '',
    priority: raw.priority ?? typeToPriority(type),
    timestamp: raw.timestamp ?? now(),
    ttlMs: raw.ttlMs ?? DEFAULT_TTL_MS,
    actions: raw.actions ?? [],
  }
}
