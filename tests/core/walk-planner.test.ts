import { describe, it, expect } from 'vitest'
import { pickWalk, clampWalkToWorkArea } from '../../src/core/walk-planner'

function seededRng(seq: number[]): () => number {
  let i = 0
  return () => seq[i++ % seq.length]
}

describe('pickWalk', () => {
  it('依注入 rng 決定方向／距離／duration／nextWalkAt 範圍', () => {
    // 三次 rng：direction(0=left)、distance(0→min)、duration(0→min)、interval(0→min)
    const rng = seededRng([0, 0, 0, 0])
    const w = pickWalk(rng, 10_000)
    expect(w.direction).toBe('left')
    expect(w.distance).toBe(60)
    expect(w.duration).toBe(1500)
    expect(w.nextWalkAt).toBe(10_000 + 30_000)
  })

  it('rng=0.999 → 方向 right、距離/時長/間隔接近上界', () => {
    const rng = seededRng([0.999, 0.999, 0.999, 0.999])
    const w = pickWalk(rng, 0)
    expect(w.direction).toBe('right')
    expect(w.distance).toBeGreaterThanOrEqual(199)
    expect(w.distance).toBeLessThanOrEqual(200)
    expect(w.duration).toBeGreaterThanOrEqual(2997)
    expect(w.duration).toBeLessThanOrEqual(3000)
    expect(w.nextWalkAt).toBeGreaterThanOrEqual(89_900)
    expect(w.nextWalkAt).toBeLessThanOrEqual(90_000)
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
    // startX=1300, petWidth=134, right edge = 1440 → 可走 6px
    expect(clampWalkToWorkArea(1300, 'right', 100, workArea, petWidth)).toBe(6)
  })

  it('向左會出界 → 截到剛好不出界', () => {
    // startX=10 → 可走 10px
    expect(clampWalkToWorkArea(10, 'left', 100, workArea, petWidth)).toBe(10)
  })

  it('已經貼在/超過邊界 → 回 0', () => {
    expect(clampWalkToWorkArea(1306, 'right', 100, workArea, petWidth)).toBe(0)
    expect(clampWalkToWorkArea(0, 'left', 100, workArea, petWidth)).toBe(0)
    expect(clampWalkToWorkArea(-5, 'left', 100, workArea, petWidth)).toBe(0)
  })
})
