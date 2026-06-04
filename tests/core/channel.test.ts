import { describe, it, expect } from 'vitest'
import {
  matchesSource,
  channelMatches,
  matchingChannels,
  filterByChannel,
  unreadByChannel,
  sanitizeChannels,
  sanitizeSources,
  activePetCount,
  type Channel,
  type SourceMatch,
} from '../../src/core/channel'

const ch = (id: string, members: SourceMatch[], enabled = true, showPet = true): Channel => ({
  id,
  name: id,
  skin: 'may',
  enabled,
  showPet,
  pomodoroEnabled: false,
  members,
})
const msg = (kind: string, name: string | undefined, read: boolean) => ({
  source: { kind, name },
  read,
})

describe('matchesSource', () => {
  it('kind 精確比對', () => {
    expect(matchesSource({ kind: 'claude-code' }, { kind: 'claude-code', name: 'x' })).toBe(true)
    expect(matchesSource({ kind: 'claude-code' }, { kind: 'attendance', name: 'x' })).toBe(false)
  })
  it('name 精確比對', () => {
    expect(matchesSource({ name: 'desktop-notify' }, { kind: 'claude-code', name: 'desktop-notify' })).toBe(true)
    expect(matchesSource({ name: 'desktop-notify' }, { kind: 'claude-code', name: 'other' })).toBe(false)
  })
  it('null 欄位萬用，指定欄位仍需相等', () => {
    expect(matchesSource({ kind: 'claude-code' }, { kind: 'claude-code', name: 'desktop-notify' })).toBe(true)
    expect(matchesSource({ name: 'desktop-notify' }, { kind: 'other', name: 'desktop-notify' })).toBe(true)
    expect(matchesSource({ kind: 'claude-code', name: 'desktop-notify' }, { kind: 'claude-code', name: 'other' })).toBe(false)
  })
  it('兩欄皆 null 回 false', () => {
    expect(matchesSource({}, { kind: 'x', name: 'y' })).toBe(false)
  })
})

describe('channelMatches', () => {
  it('多 member OR 邏輯', () => {
    const channel = ch('c1', [{ kind: 'claude-code', name: 'desktop-notify' }, { kind: 'attendance' }])
    expect(channelMatches(channel, { kind: 'claude-code', name: 'desktop-notify' })).toBe(true)
    expect(channelMatches(channel, { kind: 'attendance', name: '打卡' })).toBe(true)
    expect(channelMatches(channel, { kind: 'curl', name: 'desktop-notify' })).toBe(false)
  })
})

describe('matchingChannels', () => {
  const channels = [
    ch('c1', [{ kind: 'claude-code' }]),
    ch('c2', [{ name: 'desktop-notify' }]),
    ch('c3', [{ kind: 'claude-code', name: 'desktop-notify' }], false),
  ]
  it('啟用過濾、多 channel 可同時命中', () => {
    expect(matchingChannels({ kind: 'claude-code', name: 'desktop-notify' }, channels).sort()).toEqual(['c1', 'c2'])
  })
})

describe('filterByChannel', () => {
  const channels = [ch('c1', [{ kind: 'claude-code' }]), ch('c2', [{ kind: 'attendance' }])]
  const msgs = [msg('claude-code', 'a', false), msg('attendance', '打卡', true)]
  it("'all' 全回", () => {
    expect(filterByChannel(msgs, 'all', channels)).toEqual(msgs)
  })
  it('命中/未命中', () => {
    expect(filterByChannel(msgs, 'c1', channels)).toEqual([msgs[0]])
    expect(filterByChannel(msgs, 'c2', channels)).toEqual([msgs[1]])
  })
  it('channelId 不存在回 []', () => {
    expect(filterByChannel(msgs, 'nope', channels)).toEqual([])
  })
})

describe('unreadByChannel', () => {
  it("'all' 計未讀、各 channel 未讀計數", () => {
    const channels = [
      ch('c1', [{ kind: 'claude-code' }]),
      ch('c2', [{ name: 'desktop-notify' }]),
      ch('c3', [{ kind: 'attendance' }], false),
    ]
    const msgs = [
      msg('claude-code', 'desktop-notify', false),
      msg('claude-code', 'other', true),
      msg('attendance', '打卡', false),
    ]
    expect(unreadByChannel(msgs, channels)).toEqual({ all: 2, c1: 1, c2: 1 })
  })
})

describe('sanitizeChannels', () => {
  it('members 空丟棄、非字串 skin 變空字串、正常建立', () => {
    const raw = [
      { id: 'c1', name: 'A', skin: 'may', enabled: true, members: [{ kind: 'claude-code' }] },
      { id: 'c2', name: 'B', skin: 'may', enabled: true, members: [] },
      { id: 'c3', name: 'C', skin: 123, enabled: 'yes', members: [{ name: 'desktop-notify' }] },
      { id: 'c4', name: 'D', skin: 'may', enabled: true, members: [{ kind: '', name: '' }] },
      'garbage',
    ]
    expect(sanitizeChannels(raw)).toEqual([
      { id: 'c1', name: 'A', skin: 'may', enabled: true, showPet: true, pomodoroEnabled: false, members: [{ kind: 'claude-code' }] },
      { id: 'c3', name: 'C', skin: '', enabled: false, showPet: true, pomodoroEnabled: false, members: [{ name: 'desktop-notify' }] },
    ])
  })
  it('保留 showPet、舊檔無 showPet → true', () => {
    expect(sanitizeChannels([{ id: 'a', name: 'a', skin: '', enabled: true, showPet: false, members: [{ kind: 'k' }] }])[0].showPet).toBe(false)
    expect(sanitizeChannels([{ id: 'b', name: 'b', skin: '', enabled: true, members: [{ kind: 'k' }] }])[0].showPet).toBe(true)
  })
  it('sanitizeChannels：pomodoroEnabled 預設 false、保留明確 true', () => {
    const raw = [
      { id: 'c1', name: 'A', skin: '', enabled: true, showPet: true, members: [{ kind: 'x' }] },
      { id: 'c2', name: 'B', skin: '', enabled: true, showPet: true, pomodoroEnabled: true, members: [{ kind: 'y' }] },
    ]
    const out = sanitizeChannels(raw)
    expect(out[0].pomodoroEnabled).toBe(false)
    expect(out[1].pomodoroEnabled).toBe(true)
  })
})

describe('sanitizeSources', () => {
  it('非陣列回 []', () => {
    expect(sanitizeSources(null)).toEqual([])
  })
  it('壞項跳過、兩欄皆空跳過', () => {
    expect(sanitizeSources([
      { kind: 'claude-code' },
      { name: 'desktop-notify' },
      { kind: '', name: '' },
      null,
      'bad',
    ])).toEqual([{ kind: 'claude-code' }, { name: 'desktop-notify' }])
  })
})

describe('activePetCount', () => {
  const ch = (enabled: boolean, showPet = true): Channel => ({ id: 'x', name: 'x', skin: '', enabled, showPet, pomodoroEnabled: false, members: [{ kind: 'k' }] })
  it('= allEnabled 的 1 + 啟用且顯示寵物的頻道數', () => {
    expect(activePetCount([ch(true), ch(false)], true)).toBe(2) // all + 1 啟用顯示
    expect(activePetCount([ch(true), ch(true)], false)).toBe(2) // 0 + 2 啟用顯示
    expect(activePetCount([], true)).toBe(1) // 只有 all
    expect(activePetCount([ch(false)], false)).toBe(0) // 都沒開 → 0
    expect(activePetCount([ch(true, false)], false)).toBe(0) // 啟用但寵物隱藏 → 不算
    expect(activePetCount([ch(true, true), ch(true, false)], false)).toBe(1) // 一顯示一隱藏
  })
})
