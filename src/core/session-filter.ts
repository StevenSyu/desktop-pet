/** session 顯示/篩選的純函式（通知中心「按 session 分開看」）。source 身分維持專案粒度，session 僅活在顯示層。 */

interface HasSession {
  sessionId: string
}

/** session 短碼 `#前6碼`；default / 空 → 空字串（與通知中心列、即時卡片同規則）。 */
export function sessionShort(sessionId: string): string {
  return sessionId && sessionId !== 'default' ? `#${sessionId.slice(0, 6)}` : ''
}

/** 蒐集訊息中出現的 distinct sessionId（保序、排除 default）。 */
export function collectSessions<T extends HasSession>(messages: T[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of messages) {
    if (m.sessionId && m.sessionId !== 'default' && !seen.has(m.sessionId)) {
      seen.add(m.sessionId)
      out.push(m.sessionId)
    }
  }
  return out
}

/** 'all' → 全部；否則只留該 sessionId。 */
export function filterBySession<T extends HasSession>(messages: T[], sessionFilter: string): T[] {
  if (sessionFilter === 'all') return messages
  return messages.filter((m) => m.sessionId === sessionFilter)
}
