import { describe, it, expect } from 'vitest'
import { cardWindowBounds, type CardSpec } from '../../src/core/card-layout'
import type { Rect } from '../../src/core/card-position'

const wa: Rect = { x: 0, y: 0, width: 1440, height: 900 }
const spec: CardSpec = { width: 264, height: 148, shadowPad: 14, gap: 8 }
// 可見卡 = { width: 264 - 28 = 236, height: 148 - 28 = 120 }

describe('cardWindowBounds', () => {
  it('dragOffset 非 null → pet 左上 + offset，座標取整', () => {
    const pet: Rect = { x: 100.4, y: 200.6, width: 135, height: 146 }
    const drag = { x: 10.3, y: -5.1 }
    // x = round(100.4 + 10.3) = round(110.7) = 111
    // y = round(200.6 - 5.1) = round(195.5) = 196
    expect(cardWindowBounds(pet, wa, spec, drag)).toEqual({
      x: 111,
      y: 196,
      width: 264,
      height: 148,
    })
  })

  it('無拖動、上方有空間 → 浮上方、右對齊（再外擴 shadowPad）', () => {
    const pet: Rect = { x: 1136, y: 560, width: 135, height: 146 }
    // 可見卡 pos.x = clamp(1136 + 135 - 236, 0, 1440 - 236) = clamp(1035, 0, 1204) = 1035
    // 可見卡 pos.y(上) = 560 - 120 - 8 = 432（>= 0）→ 432
    // bounds.x = round(1035 - 14) = 1021；bounds.y = round(432 - 14) = 418
    expect(cardWindowBounds(pet, wa, spec, null)).toEqual({
      x: 1021,
      y: 418,
      width: 264,
      height: 148,
    })
  })

  it('無拖動、寵物貼頂上方不足 → 翻到下方', () => {
    const pet: Rect = { x: 1136, y: 0, width: 135, height: 146 }
    // 可見卡 pos.y(上) = 0 - 120 - 8 = -128 < 0 → 下方 = 0 + 146 + 8 = 154
    // 可見卡 pos.x = clamp(1035, 0, 1204) = 1035
    // bounds.x = 1035 - 14 = 1021；bounds.y = 154 - 14 = 140
    expect(cardWindowBounds(pet, wa, spec, null)).toEqual({
      x: 1021,
      y: 140,
      width: 264,
      height: 148,
    })
  })

  it('無拖動、寵物貼左邊 → 可見卡左緣夾回 workArea.x 後外擴', () => {
    const pet: Rect = { x: 0, y: 560, width: 135, height: 146 }
    // 可見卡 pos.x = clamp(0 + 135 - 236, 0, 1204) = clamp(-101, ...) = 0
    // 可見卡 pos.y = 560 - 120 - 8 = 432
    // bounds.x = round(0 - 14) = -14；bounds.y = 432 - 14 = 418
    expect(cardWindowBounds(pet, wa, spec, null)).toEqual({
      x: -14,
      y: 418,
      width: 264,
      height: 148,
    })
  })

  it('回傳的 width/height 永遠是 spec.width/spec.height', () => {
    const pet: Rect = { x: 700, y: 400, width: 135, height: 146 }
    const dragged = cardWindowBounds(pet, wa, spec, { x: 1, y: 1 })
    const positioned = cardWindowBounds(pet, wa, spec, null)
    expect(dragged.width).toBe(spec.width)
    expect(dragged.height).toBe(spec.height)
    expect(positioned.width).toBe(spec.width)
    expect(positioned.height).toBe(spec.height)
  })
})
