import { describe, it, expect } from 'vitest'
import { centerReduce, centerView, initialCenterState, type CenterState } from '../../src/core/center-state'
import type { StoredMessage } from '../../src/core/message-store'
import type { Channel } from '../../src/core/channel'

const msg = (id: string, over: Partial<StoredMessage> = {}): StoredMessage => ({
  id,
  source: { kind: 'claude-code', name: 'proj' },
  sessionId: 'default',
  type: 'done',
  title: '',
  body: '',
  priority: 0,
  timestamp: 0,
  ttlMs: 0,
  actions: [],
  read: false,
  receivedAt: 0,
  ...over,
})

const ch = (id: string, enabled = true): Channel => ({
  id,
  name: id,
  skin: 'may',
  enabled,
  showPet: true,
  members: [{ kind: 'claude-code' }],
})

function state(over: Partial<CenterState>): CenterState {
  return { ...initialCenterState(), ...over }
}

describe('centerReduce: 扶正（normalize）', () => {
  it('分頁指向已停用/刪除頻道 → 退回 all', () => {
    const s = state({ channels: [ch('a')], channelTab: 'a' })
    expect(centerReduce(s, { kind: 'channels', channels: [ch('a', false)] }).channelTab).toBe('all')
    expect(centerReduce(s, { kind: 'channels', channels: [] }).channelTab).toBe('all')
  })
  it('session 在目前頻道消失 → 退回 all', () => {
    const s = state({ messages: [msg('m1', { sessionId: 's1' })], sessionFilter: 's1' })
    expect(centerReduce(s, { kind: 'messages', messages: [msg('m2')] }).sessionFilter).toBe('all')
  })
  it('詳情訊息被清空 → fallback 回列表', () => {
    const s = state({ messages: [msg('m1')], detailId: 'm1' })
    const next = centerReduce(s, { kind: 'messages', messages: [] })
    expect(next.detailId).toBeNull()
    expect(centerView(next).mode).toBe('list')
  })
})

describe('centerReduce: 詳情切換', () => {
  it('openDetail 記 scroll;backToList 設 flash + 回列表', () => {
    let s = state({ messages: [msg('m1')] })
    s = centerReduce(s, { kind: 'openDetail', id: 'm1', scrollTop: 120 })
    expect(s.detailId).toBe('m1')
    expect(s.scrollTop).toBe(120)
    s = centerReduce(s, { kind: 'backToList' })
    expect(s.detailId).toBeNull()
    expect(s.flashId).toBe('m1')
    expect(s.scrollTop).toBe(120) // 回列表還原捲動
  })
  it('flash 一次性:flashShown 消費', () => {
    const s = state({ flashId: 'm1' })
    expect(centerReduce(s, { kind: 'flashShown' }).flashId).toBeNull()
  })
})

describe('centerView: 投影', () => {
  it('items = 分頁 + session + type 三重篩選', () => {
    const messages = [
      msg('m1', { type: 'done', sessionId: 's1' }),
      msg('m2', { type: 'error', sessionId: 's1' }),
      msg('m3', { type: 'done', sessionId: 's2' }),
      msg('m4', { type: 'done', source: { kind: 'other' } }),
    ]
    const s = state({ messages, channels: [ch('a')], channelTab: 'a', sessionFilter: 's1', typeFilter: 'done' })
    expect(centerView(s).items.map((m) => m.id)).toEqual(['m1'])
  })
  it('tabs 帶未讀數;停用頻道不出現', () => {
    const s = state({
      messages: [msg('m1'), msg('m2', { read: true })],
      channels: [ch('a'), ch('b', false)],
    })
    expect(centerView(s).tabs).toEqual([
      { id: 'all', name: '全部', unread: 1 },
      { id: 'a', name: 'a', unread: 1 },
    ])
  })
  it('mode 由 detailId 是否存在於 messages 決定', () => {
    const s = state({ messages: [msg('m1')], detailId: 'm1' })
    const v = centerView(s)
    expect(v.mode).toBe('detail')
    expect(v.detail?.id).toBe('m1')
  })
})
