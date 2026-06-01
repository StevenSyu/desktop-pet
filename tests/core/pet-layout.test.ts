import { describe, it, expect } from 'vitest'
import { stackPosition, type Rect } from '../../src/core/pet-layout'

const wa: Rect = { x: 0, y: 0, width: 1440, height: 900 }
const size = { width: 135, height: 146 }
const margin = 24
const gap = 12

describe('stackPosition', () => {
  it('index 0 → 右下角（= defaultPosition）', () => {
    // x = 1440-135-24 = 1281；y = 900-146-24 = 730
    expect(stackPosition(0, size, wa, margin, gap)).toEqual({ x: 1281, y: 730 })
  })
  it('index 1/2 → 向左各退 (寬+gap)=147', () => {
    expect(stackPosition(1, size, wa, margin, gap)).toEqual({ x: 1134, y: 730 })
    expect(stackPosition(2, size, wa, margin, gap)).toEqual({ x: 987, y: 730 })
  })
  it('太多 → x 夾在 workArea.x（不為負）', () => {
    // index 大到 x<0 → 夾到 workArea.x
    expect(stackPosition(50, size, wa, margin, gap).x).toBe(0)
  })
  it('負原點外接螢幕', () => {
    const waNeg: Rect = { x: -1920, y: 0, width: 1920, height: 1080 }
    // index0: x = -1920+1920-135-24 = -159；y = 0+1080-146-24 = 910
    expect(stackPosition(0, size, waNeg, margin, gap)).toEqual({ x: -159, y: 910 })
  })
})
