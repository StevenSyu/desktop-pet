// tests/core/click-dispatcher.test.ts
import { describe, it, expect } from 'vitest'
import { classifyClick, DEFAULT_DOUBLE_CLICK_MS } from '../../src/core/click-dispatcher'

describe('classifyClick', () => {
  it('沒有前次 click → 視為 single', () => {
    expect(classifyClick(null, 1000)).toBe('single')
  })

  it('與前次 click 間隔 < threshold → double', () => {
    expect(classifyClick(1000, 1200)).toBe('double') // 200ms < 300
  })

  it('與前次 click 間隔 = threshold → double（邊界含）', () => {
    expect(classifyClick(1000, 1300)).toBe('double') // 300ms == 300
  })

  it('與前次 click 間隔 > threshold → single', () => {
    expect(classifyClick(1000, 1350)).toBe('single') // 350ms > 300
  })

  it('自訂 threshold', () => {
    expect(classifyClick(1000, 1100, 50)).toBe('single') // 100ms > 50
    expect(classifyClick(1000, 1040, 50)).toBe('double') // 40ms < 50
  })

  it('DEFAULT_DOUBLE_CLICK_MS = 300', () => {
    expect(DEFAULT_DOUBLE_CLICK_MS).toBe(300)
  })
})
