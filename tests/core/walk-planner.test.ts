import { describe, it, expect } from 'vitest'
import {
  pickWalk,
  clampWalkToWorkArea,
  sanitizeWalkBounds,
  DEFAULT_WALK_BOUNDS,
  WALK_SPEED_PX_PER_MS,
  type WalkBounds,
} from '../../src/core/walk-planner'

function seededRng(seq: number[]): () => number {
  let i = 0
  return () => seq[i++ % seq.length]
}

describe('pickWalk', () => {
  it('rng=0 → direction=left、duration/interval 取下界、distance=duration*speed', () => {
    const rng = seededRng([0, 0, 0])
    const w = pickWalk(rng, 10_000)
    expect(w.direction).toBe('left')
    expect(w.duration).toBe(1500)
    expect(w.distance).toBe(Math.round(1500 * WALK_SPEED_PX_PER_MS))
    expect(w.nextWalkAt).toBe(10_000 + 30_000)
  })

  it('rng=0.999 → direction=right、duration/interval 接近上界', () => {
    const rng = seededRng([0.999, 0.999, 0.999])
    const w = pickWalk(rng, 0)
    expect(w.direction).toBe('right')
    expect(w.duration).toBeGreaterThanOrEqual(2997)
    expect(w.duration).toBeLessThanOrEqual(3000)
    expect(w.distance).toBe(Math.max(1, Math.round(w.duration * WALK_SPEED_PX_PER_MS)))
    expect(w.nextWalkAt).toBeGreaterThanOrEqual(89_900)
    expect(w.nextWalkAt).toBeLessThanOrEqual(90_000)
  })

  it('distance 永遠 >= 1（即使 duration=0）', () => {
    const w = pickWalk(seededRng([0, 0, 0]), 0, {
      intervalMinMs: 0,
      intervalMaxMs: 0,
      durationMinMs: 0,
      durationMaxMs: 0,
    })
    expect(w.distance).toBeGreaterThanOrEqual(1)
  })

  it('用自訂 bounds 完全覆寫預設範圍', () => {
    const bounds: WalkBounds = {
      intervalMinMs: 5_000,
      intervalMaxMs: 6_000,
      durationMinMs: 500,
      durationMaxMs: 600,
    }
    const w = pickWalk(seededRng([0, 0, 0]), 0, bounds)
    expect(w.duration).toBe(500)
    expect(w.nextWalkAt).toBe(5_000)
  })
})

describe('sanitizeWalkBounds', () => {
  it('空物件 → 全用預設', () => {
    expect(sanitizeWalkBounds({})).toEqual(DEFAULT_WALK_BOUNDS)
  })
  it('字串/負數 → 對應欄位回預設', () => {
    expect(sanitizeWalkBounds({ intervalMinMs: -1, durationMaxMs: 'x' as unknown as number })).toEqual(
      DEFAULT_WALK_BOUNDS,
    )
  })
  it('min > max 自動互換', () => {
    const out = sanitizeWalkBounds({ intervalMinMs: 90_000, intervalMaxMs: 30_000 })
    expect(out.intervalMinMs).toBe(30_000)
    expect(out.intervalMaxMs).toBe(90_000)
  })
})

describe('clampWalkToWorkArea', () => {
  const workArea = { x: 0, y: 0, width: 1440, height: 900 }
  const petWidth = 134 // 192 * 0.7

  it('完全在工作區內 → 不變', () => {
    expect(clampWalkToWorkArea(500, 'right', 100, workArea, petWidth)).toBe(100)
    expect(clampWalkToWorkArea(500, 'left', 100, workArea, petWidth)).toBe(100)
  })

  it('向右會出界 → 截到剛好不出界', () => {
    expect(clampWalkToWorkArea(1300, 'right', 100, workArea, petWidth)).toBe(6)
  })

  it('向左會出界 → 截到剛好不出界', () => {
    expect(clampWalkToWorkArea(10, 'left', 100, workArea, petWidth)).toBe(10)
  })

  it('已經貼在/超過邊界 → 回 0', () => {
    expect(clampWalkToWorkArea(1306, 'right', 100, workArea, petWidth)).toBe(0)
    expect(clampWalkToWorkArea(0, 'left', 100, workArea, petWidth)).toBe(0)
    expect(clampWalkToWorkArea(-5, 'left', 100, workArea, petWidth)).toBe(0)
  })
})
