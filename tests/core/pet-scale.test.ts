import { describe, it, expect } from 'vitest'
import { clampScale, scaleFromDrag, MIN_SCALE, MAX_SCALE } from '../../src/core/pet-scale'

describe('clampScale', () => {
  it('非數字 → 1', () => { expect(clampScale(undefined)).toBe(1); expect(clampScale('x')).toBe(1); expect(clampScale(NaN)).toBe(1) })
  it('界內原樣', () => expect(clampScale(1.5)).toBe(1.5))
  it('超界 clamp', () => { expect(clampScale(5)).toBe(MAX_SCALE); expect(clampScale(0.1)).toBe(MIN_SCALE) })
})

describe('scaleFromDrag', () => {
  it('往右下拖 → 放大', () => expect(scaleFromDrag(1, 135, 146, 135, 146)).toBeCloseTo(2))
  it('往左上拖 → 縮小', () => expect(scaleFromDrag(1, -54, -58.4, 135, 146)).toBeCloseTo(0.6, 1))
  it('clamp 上界', () => expect(scaleFromDrag(1.8, 270, 292, 135, 146)).toBe(MAX_SCALE))
})
