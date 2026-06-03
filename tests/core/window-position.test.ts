import { describe, it, expect } from 'vitest'
import {
  defaultPosition,
  clampToValidPosition,
  isWithinAnyDisplay,
  type DisplayInfo,
  type WindowState,
} from '../../src/core/window-position'

const primary: DisplayInfo = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } }
const second: DisplayInfo = { id: 2, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } }
const winSize = { width: 280, height: 300 }
const margin = 24

describe('defaultPosition', () => {
  it('右下角，含邊距', () => {
    expect(defaultPosition(primary, winSize, margin)).toEqual({
      x: 0 + 1440 - 280 - 24, // 1136
      y: 0 + 900 - 300 - 24,  // 576
    })
  })
  it('考慮非零原點（外接螢幕）', () => {
    expect(defaultPosition(second, winSize, margin)).toEqual({
      x: 1440 + 1920 - 280 - 24,
      y: 0 + 1080 - 300 - 24,
    })
  })
})

describe('clampToValidPosition', () => {
  it('saved=null → 預設右下角', () => {
    expect(clampToValidPosition(null, [primary], primary, winSize, margin)).toEqual(
      defaultPosition(primary, winSize, margin),
    )
  })
  it('saved displayId 不存在 → 預設', () => {
    const saved: WindowState = { displayId: 999, x: 100, y: 100 }
    expect(clampToValidPosition(saved, [primary, second], primary, winSize, margin)).toEqual(
      defaultPosition(primary, winSize, margin),
    )
  })
  it('saved 在有效 display 且座標在工作區內 → 原值', () => {
    const saved: WindowState = { displayId: 2, x: 1500, y: 100 }
    expect(clampToValidPosition(saved, [primary, second], primary, winSize, margin)).toEqual({
      x: 1500,
      y: 100,
    })
  })
  it('座標導致視窗超出工作區 → 預設', () => {
    const saved: WindowState = { displayId: 1, x: 1300, y: 700 } // 右下會超
    expect(clampToValidPosition(saved, [primary], primary, winSize, margin)).toEqual(
      defaultPosition(primary, winSize, margin),
    )
  })
  it('座標恰好等於工作區邊緣 → 仍有效', () => {
    const saved: WindowState = { displayId: 1, x: 1440 - 280, y: 900 - 300 }
    expect(clampToValidPosition(saved, [primary], primary, winSize, margin)).toEqual({
      x: 1440 - 280,
      y: 900 - 300,
    })
  })
})

describe('isWithinAnyDisplay', () => {
  const wa1 = { x: 0, y: 0, width: 1440, height: 900 }
  const wa2 = { x: 1440, y: 0, width: 1920, height: 1080 }

  it('完整落在某一工作區內 → true', () => {
    expect(isWithinAnyDisplay({ x: 100, y: 100, width: 135, height: 146 }, [wa1, wa2])).toBe(true)
    expect(isWithinAnyDisplay({ x: 1500, y: 0, width: 135, height: 146 }, [wa1, wa2])).toBe(true)
  })
  it('貼齊邊緣 → true;超出 1px → false', () => {
    expect(isWithinAnyDisplay({ x: 1440 - 135, y: 900 - 146, width: 135, height: 146 }, [wa1])).toBe(true)
    expect(isWithinAnyDisplay({ x: 1440 - 134, y: 0, width: 135, height: 146 }, [wa1])).toBe(false)
  })
  it('跨兩個工作區（任一皆不完整包含）→ false', () => {
    expect(isWithinAnyDisplay({ x: 1400, y: 0, width: 135, height: 146 }, [wa1, wa2])).toBe(false)
  })
  it('無工作區 → false', () => {
    expect(isWithinAnyDisplay({ x: 0, y: 0, width: 1, height: 1 }, [])).toBe(false)
  })
})
