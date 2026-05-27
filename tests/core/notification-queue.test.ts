import { describe, it, expect } from 'vitest'
import { NotificationQueue } from '../../src/core/notification-queue'
import { normalizePayload } from '../../src/core/events'

function makeEvent(over: { id: string; timestamp: number; ttlMs?: number }) {
  return normalizePayload(
    { id: over.id, type: 'info', timestamp: over.timestamp, ttlMs: over.ttlMs ?? 5000 },
    { now: () => over.timestamp, uuid: () => over.id },
  )
}

describe('NotificationQueue', () => {
  it('keeps active events and drops expired ones by ttl', () => {
    let t = 0
    const q = new NotificationQueue({ now: () => t })
    q.push(makeEvent({ id: 'a', timestamp: 0, ttlMs: 5000 }))

    t = 4999
    expect(q.active().map((e) => e.id)).toEqual(['a'])

    t = 5000
    expect(q.active()).toEqual([]) // 到期淡出
  })

  it('dedupes by id (update in place, no duplicate)', () => {
    let t = 0
    const q = new NotificationQueue({ now: () => t })
    q.push(makeEvent({ id: 'a', timestamp: 0 }))
    q.push(makeEvent({ id: 'a', timestamp: 0 })) // 同 id 再送
    expect(q.active()).toHaveLength(1)
  })

  it('latest() returns the most recently pushed active event', () => {
    let t = 0
    const q = new NotificationQueue({ now: () => t })
    q.push(makeEvent({ id: 'a', timestamp: 0 }))
    q.push(makeEvent({ id: 'b', timestamp: 0 }))
    expect(q.latest()?.id).toBe('b')
  })

  it('latest() returns undefined when nothing active', () => {
    const q = new NotificationQueue({ now: () => 0 })
    expect(q.latest()).toBeUndefined()
  })
})
