import { describe, it, expect } from 'vitest'
import {
  matchesSource,
  matchingChannels,
  needsAutoChannel,
  filterByChannel,
  unreadByChannel,
  sanitizeChannels,
  type Channel,
} from '../../src/core/channel'

const ch = (id: string, match: Channel['match'], enabled = true): Channel => ({
  id, name: id, skin: 'may', enabled, match,
})
const msg = (kind: string, name: string | undefined, read: boolean) => ({
  source: { kind, name }, read,
})

describe('matchesSource', () => {
  it('kind 命中', () => expect(matchesSource({ kind: 'claude-code' }, { kind: 'claude-code', name: 'x' })).toBe(true))
  it('name 命中', () => expect(matchesSource({ name: 'desktop-notify' }, { kind: 'claude-code', name: 'desktop-notify' })).toBe(true))
  it('兩者皆要、其一不符 → false', () => expect(matchesSource({ kind: 'claude-code', name: 'a' }, { kind: 'claude-code', name: 'b' })).toBe(false))
  it('空 matcher → false', () => expect(matchesSource({}, { kind: 'x', name: 'y' })).toBe(false))
  it('match.name 指定但 source.name 缺 → false', () => expect(matchesSource({ name: 'a' }, { kind: 'x' })).toBe(false))
})

describe('matchingChannels（只回 enabled、可多屬）', () => {
  const channels = [
    ch('c1', { kind: 'claude-code' }),
    ch('c2', { name: 'desktop-notify' }),
    ch('c3', { kind: 'attendance' }, false), // 停用
  ]
  it('重疊 → 回多個', () => {
    expect(matchingChannels({ kind: 'claude-code', name: 'desktop-notify' }, channels).sort()).toEqual(['c1', 'c2'])
  })
  it('停用不回', () => {
    expect(matchingChannels({ kind: 'attendance', name: '打卡' }, channels)).toEqual([])
  })
  it('無命中 → 空', () => {
    expect(matchingChannels({ kind: 'curl', name: 'z' }, channels)).toEqual([])
  })
})

describe('filterByChannel', () => {
  const channels = [ch('c1', { kind: 'claude-code' })]
  const msgs = [msg('claude-code', 'a', false), msg('attendance', '打卡', true)]
  it("'all' → 全部", () => expect(filterByChannel(msgs, 'all', channels)).toHaveLength(2))
  it('group → 命中者', () => expect(filterByChannel(msgs, 'c1', channels)).toHaveLength(1))
  it('找不到 channel → 空', () => expect(filterByChannel(msgs, 'nope', channels)).toEqual([]))
})

describe('unreadByChannel', () => {
  it('all 總未讀 + 各 enabled group 未讀', () => {
    const channels = [ch('c1', { kind: 'claude-code' }), ch('c2', { kind: 'attendance' }, false)]
    const msgs = [msg('claude-code', 'a', false), msg('claude-code', 'b', true), msg('attendance', 'x', false)]
    expect(unreadByChannel(msgs, channels)).toEqual({ all: 2, c1: 1 }) // c2 停用不列
  })
})

describe('needsAutoChannel（自動建去重）', () => {
  it('停用的廣域 kind channel 不算捕捉 → 仍需為各 source 建', () => {
    const channels = [ch('broad', { kind: 'claude-code' }, false)]
    expect(needsAutoChannel({ kind: 'claude-code', name: 'projX' }, channels)).toBe(true)
  })
  it('啟用的廣域 kind channel 已捕捉 → 不需建', () => {
    const channels = [ch('broad', { kind: 'claude-code' }, true)]
    expect(needsAutoChannel({ kind: 'claude-code', name: 'projX' }, channels)).toBe(false)
  })
  it('已有完全相同 {kind,name} → 不需建（去重）', () => {
    const channels = [ch('x', { kind: 'claude-code', name: 'projX' }, false)]
    expect(needsAutoChannel({ kind: 'claude-code', name: 'projX' }, channels)).toBe(false)
  })
  it('source 無 name：以 {kind} 去重', () => {
    expect(needsAutoChannel({ kind: 'attendance' }, [ch('a', { kind: 'attendance' }, false)])).toBe(false)
    expect(needsAutoChannel({ kind: 'attendance' }, [])).toBe(true)
  })
})

describe('sanitizeChannels', () => {
  it('丟棄壞欄位 / match 至少一欄；非字串 skin → 空字串', () => {
    const raw = [
      { id: 'c1', name: 'A', skin: 'may', enabled: true, match: { kind: 'claude-code' } },
      { id: 'c2', name: 'B', match: {} }, // match 空 → 丟
      { name: 'no-id', match: { kind: 'x' } }, // 無 id → 丟
      { id: 'c3', name: 'C', skin: 123, enabled: 'yes', match: { name: 'p' } }, // skin 非字串→''、enabled 非 bool→false
      'garbage',
    ]
    expect(sanitizeChannels(raw)).toEqual([
      { id: 'c1', name: 'A', skin: 'may', enabled: true, match: { kind: 'claude-code' } },
      { id: 'c3', name: 'C', skin: '', enabled: false, match: { name: 'p' } },
    ])
  })
  it('非陣列 → []', () => expect(sanitizeChannels(null)).toEqual([]))
})
