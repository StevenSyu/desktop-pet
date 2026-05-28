import { describe, it, expect } from 'vitest'
import { relativeTime, timeGroup } from '../../src/core/time-format'

describe('relativeTime', () => {
  it('一分鐘內 → 剛剛', () => {
    expect(relativeTime(1000, 1000 + 30_000)).toBe('剛剛')
  })
  it('數分鐘 → N 分鐘前', () => {
    expect(relativeTime(0, 5 * 60_000)).toBe('5 分鐘前')
  })
  it('超過一小時 → HH:mm 格式', () => {
    const ts = new Date(2026, 4, 28, 9, 5).getTime()
    const now = new Date(2026, 4, 28, 14, 0).getTime()
    expect(relativeTime(ts, now)).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('timeGroup', () => {
  it('一分鐘內 → now', () => {
    expect(timeGroup(1000, 1000 + 20_000)).toBe('now')
  })
  it('同日較早 → today', () => {
    const ts = new Date(2026, 4, 28, 9, 0).getTime()
    const now = new Date(2026, 4, 28, 14, 0).getTime()
    expect(timeGroup(ts, now)).toBe('today')
  })
  it('不同日 → earlier', () => {
    const ts = new Date(2026, 4, 27, 23, 0).getTime()
    const now = new Date(2026, 4, 28, 1, 0).getTime()
    expect(timeGroup(ts, now)).toBe('earlier')
  })
})
