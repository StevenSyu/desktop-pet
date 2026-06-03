import { describe, it, expect } from 'vitest'
import { initialWalkEngineState, walkEngineReduce, type WalkEngineState } from '../../src/core/walk-engine'
import { DEFAULT_WALK_BOUNDS, type WalkBounds } from '../../src/core/walk-planner'

// rng=0 → direction 'left'、duration=durationMin、interval=intervalMin（pickWalk 可預測）
const rng0 = () => 0
const ctx = (now: number) => ({ now, rng: rng0 })

const BOUNDS: WalkBounds = { intervalMinMs: 1000, intervalMaxMs: 2000, durationMinMs: 100, durationMaxMs: 200 }

function readyState(now: number): WalkEngineState {
  // nextWalkAt 已到期、idle、可走
  return { autoWalkEnabled: true, walking: false, direction: null, nextWalkAt: now, bounds: BOUNDS }
}

const idleTick = { kind: 'tick', animation: 'idle', hidden: false, hasCard: false } as const

describe('walkEngineReduce: tick 觸發', () => {
  it('條件齊備 → start 指令 + walking/direction/nextWalkAt 更新', () => {
    const r = walkEngineReduce(readyState(5000), idleTick, ctx(5000))
    expect(r.commands).toEqual([{ type: 'start', direction: 'left', distance: 8, duration: 100 }])
    expect(r.state.walking).toBe(true)
    expect(r.state.direction).toBe('left')
    expect(r.state.nextWalkAt).toBe(6000) // now + intervalMin
  })
  it('未到時間 / 非 idle / 隱藏 / 有卡片 / 已在走 → 不動', () => {
    const s = readyState(5000)
    const cases = [
      { state: { ...s, nextWalkAt: 9999 }, event: idleTick },
      { state: s, event: { ...idleTick, animation: 'happy' } },
      { state: s, event: { ...idleTick, hidden: true } },
      { state: s, event: { ...idleTick, hasCard: true } },
      { state: { ...s, walking: true }, event: idleTick },
      { state: { ...s, autoWalkEnabled: false }, event: idleTick },
    ]
    for (const c of cases) {
      const r = walkEngineReduce(c.state, c.event, ctx(5000))
      expect(r.commands).toEqual([])
      expect(r.state.walking).toBe(c.state.walking)
    }
  })
})

describe('walkEngineReduce: 取消語意', () => {
  const walkingState: WalkEngineState = { ...readyState(0), walking: true, direction: 'right', nextWalkAt: 9999 }

  it('interrupt（hover/通知）走動中 → cancel 但 walking 不就地清（等 walkEnded）', () => {
    const r = walkEngineReduce(walkingState, { kind: 'interrupt' }, ctx(100))
    expect(r.commands).toEqual([{ type: 'cancel' }])
    expect(r.state.walking).toBe(true)
  })
  it('interrupt 未走動 → no-op', () => {
    const r = walkEngineReduce(readyState(0), { kind: 'interrupt' }, ctx(100))
    expect(r.commands).toEqual([])
  })
  it('hidden 走動中 → cancel；visible → 重排 nextWalkAt', () => {
    expect(walkEngineReduce(walkingState, { kind: 'hidden' }, ctx(100)).commands).toEqual([{ type: 'cancel' }])
    const r = walkEngineReduce(readyState(0), { kind: 'visible' }, ctx(500))
    expect(r.state.nextWalkAt).toBe(1500) // now + intervalMin
  })
  it('walkEnded → walking/direction 清空 + 重排', () => {
    const r = walkEngineReduce(walkingState, { kind: 'walkEnded' }, ctx(200))
    expect(r.state.walking).toBe(false)
    expect(r.state.direction).toBeNull()
    expect(r.state.nextWalkAt).toBe(1200)
  })
})

describe('walkEngineReduce: 設定變更', () => {
  it('prefs → 套 bounds + autoWalk + 重排', () => {
    const r = walkEngineReduce(readyState(0), { kind: 'prefs', autoWalk: false, bounds: DEFAULT_WALK_BOUNDS }, ctx(100))
    expect(r.state.autoWalkEnabled).toBe(false)
    expect(r.state.bounds).toEqual(DEFAULT_WALK_BOUNDS)
    expect(r.state.nextWalkAt).toBe(100 + DEFAULT_WALK_BOUNDS.intervalMinMs)
  })
  it('autoWalk 關閉且走動中 → cancel；開啟 → 重排', () => {
    const walking: WalkEngineState = { ...readyState(0), walking: true, nextWalkAt: 42 }
    const off = walkEngineReduce(walking, { kind: 'autoWalk', enabled: false }, ctx(100))
    expect(off.commands).toEqual([{ type: 'cancel' }])
    expect(off.state.nextWalkAt).toBe(42) // 關閉不重排（沿用原行為）
    const on = walkEngineReduce(readyState(0), { kind: 'autoWalk', enabled: true }, ctx(100))
    expect(on.state.nextWalkAt).toBe(1100)
  })
  it('direction：走動中才同步', () => {
    const walking: WalkEngineState = { ...readyState(0), walking: true, direction: 'left' }
    expect(walkEngineReduce(walking, { kind: 'direction', direction: 'right' }, ctx(0)).state.direction).toBe('right')
    expect(walkEngineReduce(readyState(0), { kind: 'direction', direction: 'right' }, ctx(0)).state.direction).toBeNull()
  })
})

describe('initialWalkEngineState', () => {
  it('預設 bounds + nextWalkAt 已排程', () => {
    const s = initialWalkEngineState(rng0, 1000)
    expect(s.bounds).toEqual(DEFAULT_WALK_BOUNDS)
    expect(s.nextWalkAt).toBe(1000 + DEFAULT_WALK_BOUNDS.intervalMinMs)
    expect(s.walking).toBe(false)
  })
})
