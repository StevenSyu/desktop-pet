import { describe, it, expect } from 'vitest'
import { sessionShort, collectSessions, filterBySession } from '../../src/core/session-filter'

const msg = (sessionId: string) => ({ sessionId }) as { sessionId: string }

describe('sessionShort', () => {
  it('一般 session → #前6碼', () => expect(sessionShort('abc123def456')).toBe('#abc123'))
  it('default / 空 → 空字串', () => {
    expect(sessionShort('default')).toBe('')
    expect(sessionShort('')).toBe('')
  })
})

describe('collectSessions', () => {
  it('蒐集去重、保序、排除 default', () => {
    const msgs = [msg('s1'), msg('default'), msg('s2'), msg('s1'), msg('s2')]
    expect(collectSessions(msgs as any)).toEqual(['s1', 's2'])
  })
  it('全 default / 空 → []', () => {
    expect(collectSessions([msg('default'), msg('default')] as any)).toEqual([])
    expect(collectSessions([])).toEqual([])
  })
})

describe('filterBySession', () => {
  const msgs = [msg('s1'), msg('s2'), msg('default')] as any
  it("'all' → 全部", () => expect(filterBySession(msgs, 'all')).toHaveLength(3))
  it('指定 session → 只該 session', () => {
    expect(filterBySession(msgs, 's1')).toHaveLength(1)
    expect(filterBySession(msgs, 's1')[0].sessionId).toBe('s1')
  })
})
