import { describe, it, expect } from 'vitest'
import { MessageStore } from '../../src/core/message-store'
import { normalizePayload, type NotifyType } from '../../src/core/events'

function ev(type: NotifyType, id: string) {
  return normalizePayload({ id, type }, { now: () => 0, uuid: () => id })
}

describe('MessageStore', () => {
  it('push 標記未讀並設 receivedAt=now()', () => {
    let t = 1000
    const s = new MessageStore({ now: () => t })
    const m = s.push(ev('done', 'a'))
    expect(m.read).toBe(false)
    expect(m.receivedAt).toBe(1000)
    expect(s.unreadCount()).toBe(1)
  })

  it('list 由新到舊', () => {
    const s = new MessageStore({ now: () => 0 })
    s.push(ev('done', 'a'))
    s.push(ev('error', 'b'))
    expect(s.list().map((m) => m.id)).toEqual(['b', 'a'])
  })

  it('list 可依 type 過濾', () => {
    const s = new MessageStore({ now: () => 0 })
    s.push(ev('done', 'a'))
    s.push(ev('error', 'b'))
    s.push(ev('done', 'c'))
    expect(s.list({ type: 'done' }).map((m) => m.id)).toEqual(['c', 'a'])
  })

  it('markRead 與 markAllRead', () => {
    const s = new MessageStore({ now: () => 0 })
    s.push(ev('done', 'a'))
    s.push(ev('error', 'b'))
    s.markRead('a')
    expect(s.unreadCount()).toBe(1)
    s.markAllRead()
    expect(s.unreadCount()).toBe(0)
  })

  it('超過容量丟最舊', () => {
    const s = new MessageStore({ now: () => 0, capacity: 2 })
    s.push(ev('done', 'a'))
    s.push(ev('done', 'b'))
    s.push(ev('done', 'c'))
    expect(s.list().map((m) => m.id)).toEqual(['c', 'b'])
  })

  it('markRead 對不存在 id 不報錯', () => {
    const s = new MessageStore({ now: () => 0 })
    expect(() => s.markRead('nope')).not.toThrow()
  })
})

describe('MessageStore removeByIds', () => {
  it('只刪指定 ids，其他保留；不存在的 id 被忽略', () => {
    const s = new MessageStore({ now: () => 0 })
    s.push(ev('done', 'a'))
    s.push(ev('error', 'b'))
    s.push(ev('done', 'c'))
    s.removeByIds(['a', 'c', 'nope'])
    expect(s.list().map((m) => m.id)).toEqual(['b'])
  })

  it('空陣列為 no-op', () => {
    const s = new MessageStore({ now: () => 0 })
    s.push(ev('done', 'a'))
    s.push(ev('error', 'b'))
    s.removeByIds([])
    expect(s.list().map((m) => m.id)).toEqual(['b', 'a'])
  })
})
