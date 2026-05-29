import { describe, it, expect } from 'vitest'
import { WalkSession } from '../../src/core/walk-session'

const WORK_AREA = { x: 0, y: 0, width: 1440, height: 900 }
const PET = 134 // 192 * 0.7

function input(over: Partial<Parameters<WalkSession['start']>[0]> = {}) {
  return {
    startX: 700,
    requestedDirection: 'right' as const,
    distance: 100,
    duration: 1000,
    workArea: WORK_AREA,
    petWidth: PET,
    ...over,
  }
}

describe('WalkSession.start', () => {
  it('有空間 → ok、不翻向、變 active', () => {
    const s = new WalkSession()
    const r = s.start(input(), 0)
    expect(r).toEqual({ ok: true })
    expect(s.active).toBe(true)
  })

  it('該方向到底但對向有空間 → 翻向、回 flippedTo', () => {
    const s = new WalkSession()
    // startX 貼右界（1440-134=1306），往右 available=0 → 翻左
    const r = s.start(input({ startX: 1306, requestedDirection: 'right' }), 0)
    expect(r.ok).toBe(true)
    expect(r.flippedTo).toBe('left')
    expect(s.active).toBe(true)
  })

  it('兩向都沒空間（工作區比寵物還窄）→ ok:false 且不啟動', () => {
    const s = new WalkSession()
    const narrow = { x: 0, y: 0, width: 100, height: 900 } // < petWidth
    const r = s.start(input({ startX: 0, workArea: narrow }), 0)
    expect(r.ok).toBe(false)
    expect(s.active).toBe(false)
  })
})

describe('WalkSession.step', () => {
  it('未啟動 → null', () => {
    expect(new WalkSession().step(0)).toBeNull()
  })

  it('起點時 t=0 → x=startX、未完成', () => {
    const s = new WalkSession()
    s.start(input({ startX: 700, distance: 100, duration: 1000 }), 0)
    expect(s.step(0)).toEqual({ x: 700, done: false })
  })

  it('中點 t=0.5 → x 在起點與終點中間', () => {
    const s = new WalkSession()
    s.start(input({ startX: 700, requestedDirection: 'right', distance: 100, duration: 1000 }), 0)
    expect(s.step(500)).toEqual({ x: 750, done: false })
  })

  it('到時間 t>=1 → x=終點、done=true', () => {
    const s = new WalkSession()
    s.start(input({ startX: 700, requestedDirection: 'right', distance: 100, duration: 1000 }), 0)
    expect(s.step(1000)).toEqual({ x: 800, done: true })
  })

  it('超過時間也夾在終點（不過衝）', () => {
    const s = new WalkSession()
    s.start(input({ startX: 700, requestedDirection: 'right', distance: 100, duration: 1000 }), 0)
    expect(s.step(5000)).toEqual({ x: 800, done: true })
  })

  it('往左 → x 遞減', () => {
    const s = new WalkSession()
    s.start(input({ startX: 700, requestedDirection: 'left', distance: 100, duration: 1000 }), 0)
    expect(s.step(500)).toEqual({ x: 650, done: false })
    expect(s.step(1000)).toEqual({ x: 600, done: true })
  })

  it('翻向後依新方向推進（貼右界 → 往左）', () => {
    const s = new WalkSession()
    s.start(input({ startX: 1306, requestedDirection: 'right', distance: 100, duration: 1000 }), 0)
    // 翻成 left、available=可走的左側距離；中點 x 應 < 1306
    const mid = s.step(500)!
    expect(mid.x).toBeLessThan(1306)
  })
})

describe('WalkSession.cancel / restart', () => {
  it('cancel → active false、step 回 null', () => {
    const s = new WalkSession()
    s.start(input(), 0)
    s.cancel()
    expect(s.active).toBe(false)
    expect(s.step(100)).toBeNull()
  })

  it('重新 start 會覆蓋前一次（新起點/時間）', () => {
    const s = new WalkSession()
    s.start(input({ startX: 700, distance: 100, duration: 1000 }), 0)
    s.start(input({ startX: 300, requestedDirection: 'right', distance: 100, duration: 1000 }), 2000)
    expect(s.step(2000)).toEqual({ x: 300, done: false }) // 以新起點 300、新 startedAt 2000 計
  })

  it('duration=0 → 立即完成', () => {
    const s = new WalkSession()
    s.start(input({ startX: 700, distance: 100, duration: 0 }), 0)
    expect(s.step(0)).toEqual({ x: 800, done: true })
  })
})
