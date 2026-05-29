import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readWebpSize } from '../../src/core/webp-size'

describe('readWebpSize', () => {
  it('真實內建 spritesheet（VP8L）→ 1536×1872', () => {
    const bytes = readFileSync(join(__dirname, '../../resources/pets/may/spritesheet.webp')).subarray(0, 32)
    expect(readWebpSize(new Uint8Array(bytes))).toEqual({ width: 1536, height: 1872 })
  })

  it('VP8L 合成 header → 正確寬高', () => {
    const b = new Uint8Array(25)
    b.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
    b.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
    b.set([0x56, 0x50, 0x38, 0x4c], 12) // VP8L
    b[20] = 0x2f
    b.set([0xff, 0xc5, 0xd3, 0x11], 21)
    expect(readWebpSize(b)).toEqual({ width: 1536, height: 1872 })
  })

  it('VP8 (lossy) header → 正確寬高', () => {
    const b = new Uint8Array(30)
    b.set([0x52, 0x49, 0x46, 0x46], 0)
    b.set([0x57, 0x45, 0x42, 0x50], 8)
    b.set([0x56, 0x50, 0x38, 0x20], 12) // 'VP8 '
    b.set([0x9d, 0x01, 0x2a], 23) // start code
    b[26] = 100 & 0xff; b[27] = (100 >> 8) & 0x3f
    b[28] = 200 & 0xff; b[29] = (200 >> 8) & 0x3f
    expect(readWebpSize(b)).toEqual({ width: 100, height: 200 })
  })

  it('VP8X (extended) header → 正確寬高（值 +1、24-bit LE）', () => {
    const b = new Uint8Array(30)
    b.set([0x52, 0x49, 0x46, 0x46], 0)
    b.set([0x57, 0x45, 0x42, 0x50], 8)
    b.set([0x56, 0x50, 0x38, 0x58], 12) // 'VP8X'
    const w = 1535, h = 1871
    b[24] = w & 0xff; b[25] = (w >> 8) & 0xff; b[26] = (w >> 16) & 0xff
    b[27] = h & 0xff; b[28] = (h >> 8) & 0xff; b[29] = (h >> 16) & 0xff
    expect(readWebpSize(b)).toEqual({ width: 1536, height: 1872 })
  })

  it('非 WebP → null', () => {
    expect(readWebpSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
  })
  it('太短 → null', () => {
    expect(readWebpSize(new Uint8Array(8))).toBeNull()
  })
})
