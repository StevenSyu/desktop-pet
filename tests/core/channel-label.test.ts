import { describe, it, expect } from 'vitest'
import { sanitizeLabelMode, shouldShowLabel } from '../../src/core/channel-label'

describe('sanitizeLabelMode', () => {
  it('合法值原樣', () => {
    expect(sanitizeLabelMode('hidden')).toBe('hidden')
    expect(sanitizeLabelMode('hover')).toBe('hover')
    expect(sanitizeLabelMode('always')).toBe('always')
  })
  it('非法值 → hidden', () => {
    expect(sanitizeLabelMode('x')).toBe('hidden')
    expect(sanitizeLabelMode(undefined)).toBe('hidden')
    expect(sanitizeLabelMode(123)).toBe('hidden')
  })
})

describe('shouldShowLabel', () => {
  it('hidden 永不顯示', () => {
    expect(shouldShowLabel('hidden', true)).toBe(false)
    expect(shouldShowLabel('hidden', false)).toBe(false)
  })
  it('always 永遠顯示', () => {
    expect(shouldShowLabel('always', false)).toBe(true)
    expect(shouldShowLabel('always', true)).toBe(true)
  })
  it('hover 只在 hovering 時顯示', () => {
    expect(shouldShowLabel('hover', true)).toBe(true)
    expect(shouldShowLabel('hover', false)).toBe(false)
  })
})
