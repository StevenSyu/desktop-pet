import { describe, it, expect } from 'vitest'
import {
  SPRITE_FORMAT,
  frameRect,
  validateSheetDimensions,
  animationForType,
} from '../../src/core/sprite-format'

describe('SPRITE_FORMAT', () => {
  it('has canonical sheet + frame geometry', () => {
    expect(SPRITE_FORMAT.sheetWidth).toBe(1536)
    expect(SPRITE_FORMAT.sheetHeight).toBe(1872)
    expect(SPRITE_FORMAT.cols).toBe(8)
    expect(SPRITE_FORMAT.rows).toBe(9)
    expect(SPRITE_FORMAT.frameWidth).toBe(192)
    expect(SPRITE_FORMAT.frameHeight).toBe(208)
  })

  it('defines 9 animations on rows 0..8 with the documented frame counts', () => {
    const a = SPRITE_FORMAT.animations
    expect(a.idle).toMatchObject({ row: 0, frames: 6 })
    expect(a['running-right']).toMatchObject({ row: 1, frames: 8 })
    expect(a['running-left']).toMatchObject({ row: 2, frames: 8 })
    expect(a.waving).toMatchObject({ row: 3, frames: 4 })
    expect(a.jumping).toMatchObject({ row: 4, frames: 5 })
    expect(a.failed).toMatchObject({ row: 5, frames: 8 })
    expect(a.waiting).toMatchObject({ row: 6, frames: 6 })
    expect(a.running).toMatchObject({ row: 7, frames: 6 })
    expect(a.review).toMatchObject({ row: 8, frames: 7 })

    const rows = Object.values(a).map((x) => x.row).sort((p, q) => p - q)
    expect(rows).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })
})

describe('frameRect', () => {
  it('computes pixel rect for a (row, col)', () => {
    expect(frameRect(0, 0)).toEqual({ x: 0, y: 0, w: 192, h: 208 })
    expect(frameRect(2, 3)).toEqual({ x: 3 * 192, y: 2 * 208, w: 192, h: 208 })
  })
})

describe('validateSheetDimensions', () => {
  it('accepts exact canonical size', () => {
    expect(validateSheetDimensions(1536, 1872)).toBe(true)
  })
  it('rejects anything else', () => {
    expect(validateSheetDimensions(1536, 1871)).toBe(false)
    expect(validateSheetDimensions(800, 600)).toBe(false)
  })
})

describe('animationForType', () => {
  it('maps event types to animations', () => {
    expect(animationForType('done')).toBe('jumping')
    expect(animationForType('attention')).toBe('waving')
    expect(animationForType('error')).toBe('failed')
    expect(animationForType('review')).toBe('review')
    expect(animationForType('working')).toBe('waiting')
    expect(animationForType('info')).toBe('idle')
  })
})
