import { describe, it, expect } from 'vitest'
import { normalizePayload, typeToPriority } from '../../src/core/events'

describe('typeToPriority', () => {
  it('error > attention > done > review > working > info', () => {
    expect(typeToPriority('error')).toBeGreaterThan(typeToPriority('attention'))
    expect(typeToPriority('attention')).toBeGreaterThan(typeToPriority('done'))
    expect(typeToPriority('done')).toBeGreaterThan(typeToPriority('review'))
    expect(typeToPriority('review')).toBeGreaterThan(typeToPriority('working'))
    expect(typeToPriority('working')).toBeGreaterThan(typeToPriority('info'))
  })
})

describe('normalizePayload', () => {
  const deps = { now: () => 1000, uuid: () => 'fixed-id' }

  it('fills defaults for a minimal payload', () => {
    const e = normalizePayload({ type: 'done' }, deps)
    expect(e).toEqual({
      id: 'fixed-id',
      source: { kind: 'unknown' },
      sessionId: 'default',
      type: 'done',
      title: '',
      body: '',
      priority: typeToPriority('done'),
      timestamp: 1000,
      ttlMs: 5000,
      actions: [],
    })
  })

  it('maps an unknown type to info', () => {
    const e = normalizePayload({ type: 'wat' }, deps)
    expect(e.type).toBe('info')
    expect(e.priority).toBe(typeToPriority('info'))
  })

  it('accepts a string source as { kind }', () => {
    const e = normalizePayload({ type: 'info', source: 'claude-code' }, deps)
    expect(e.source).toEqual({ kind: 'claude-code' })
  })

  it('caps over-long source.kind / source.name to 200 chars', () => {
    const long = 'x'.repeat(500)
    const e = normalizePayload({ type: 'info', source: { kind: long, name: long } }, deps)
    expect(e.source.kind.length).toBe(200)
    expect(e.source.name?.length).toBe(200)
  })

  it('preserves an object source and explicit fields', () => {
    const e = normalizePayload(
      { type: 'attention', source: { kind: 'codex', name: 'my-proj' }, sessionId: 's1', priority: 99, ttlMs: 1234 },
      deps,
    )
    expect(e.source).toEqual({ kind: 'codex', name: 'my-proj' })
    expect(e.sessionId).toBe('s1')
    expect(e.priority).toBe(99)
    expect(e.ttlMs).toBe(1234)
  })
})
