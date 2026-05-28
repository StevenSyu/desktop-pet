export function relativeTime(ts: number, now: number): string {
  const diff = now - ts
  if (diff < 60_000) return '剛剛'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export type TimeGroup = 'now' | 'today' | 'earlier'

export function timeGroup(ts: number, now: number): TimeGroup {
  if (now - ts < 60_000) return 'now'
  const a = new Date(ts)
  const b = new Date(now)
  const sameDay =
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  return sameDay ? 'today' : 'earlier'
}
