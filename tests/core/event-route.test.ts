import { describe, it, expect } from 'vitest'
import { routeEvent } from '../../src/core/event-route'
import type { Channel } from '../../src/core/channel'

function ch(id: string, kind: string, enabled = true): Channel {
  return { id, name: id, skin: 'may', enabled, showPet: true, pomodoroEnabled: false, members: [{ kind }] }
}

const base = { dnd: false, soundEnabled: true, allEnabled: true, channels: [ch('ch-1', 'codex')] }

describe('routeEvent', () => {
  it('dnd 吞掉全部：不響音、無目標', () => {
    const r = routeEvent({ ...base, dnd: true }, { kind: 'codex' })
    expect(r).toEqual({ sound: false, targets: [] })
  })

  it('soundEnabled 開 → 響音一次（sound flag）', () => {
    expect(routeEvent(base, { kind: 'codex' }).sound).toBe(true)
  })

  it('soundEnabled 關 → 不響音，但目標照常', () => {
    const r = routeEvent({ ...base, soundEnabled: false }, { kind: 'codex' })
    expect(r.sound).toBe(false)
    expect(r.targets).toContain('ch-1')
  })

  it('allEnabled 開 → 目標含 all', () => {
    expect(routeEvent(base, { kind: 'codex' }).targets).toContain('all')
  })

  it('allEnabled 關 → 目標不含 all', () => {
    expect(routeEvent({ ...base, allEnabled: false }, { kind: 'codex' }).targets).not.toContain('all')
  })

  it('命中啟用頻道進目標；停用頻道排除', () => {
    const state = { ...base, channels: [ch('ch-1', 'codex'), ch('ch-2', 'codex', false), ch('ch-3', 'claude')] }
    const r = routeEvent(state, { kind: 'codex' })
    expect(r.targets).toEqual(['all', 'ch-1'])
  })
})
