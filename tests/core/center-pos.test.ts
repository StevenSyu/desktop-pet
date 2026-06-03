import { describe, it, expect } from 'vitest'
import { posInsideAnyWorkArea, resolveCenterPos } from '../../src/core/center-pos'
import { cardPosition, type Rect } from '../../src/core/card-position'

const CENTER_W = 360
const CENTER_H = 480
const size = { width: CENTER_W, height: CENTER_H }

// 兩個並排螢幕的 workArea
const waLeft: Rect = { x: 0, y: 0, width: 1440, height: 900 }
const waRight: Rect = { x: 1440, y: 0, width: 1920, height: 1080 }
const workAreas: Rect[] = [waLeft, waRight]

describe('resolveCenterPos', () => {
  it('saved 完整落在兩螢幕之一 → 原樣沿用', () => {
    const saved = { x: 1500, y: 100 } // 1500+360=1860 ≤ 3360；100+480=580 ≤ 1080，落在右螢幕
    expect(resolveCenterPos(saved, size, workAreas, undefined)).toEqual(saved)
  })

  it('saved 橫跨螢幕邊界（x+width 超出）→ 退回寵物定位', () => {
    const saved = { x: 1200, y: 100 } // 1200+360=1560 > 1440（左螢幕右緣），且左緣 1200 < 1440 不在右螢幕
    const pet = { bounds: { x: 1136, y: 560, width: 135, height: 146 }, workArea: waLeft }
    expect(resolveCenterPos(saved, size, workAreas, pet)).toEqual(
      cardPosition(pet.bounds, size, waLeft, 8),
    )
  })

  it('saved 對應的螢幕已不存在（workAreas 不含它）→ 退回寵物定位', () => {
    const saved = { x: 1500, y: 100 } // 只在右螢幕內成立
    const onlyLeft: Rect[] = [waLeft] // 右螢幕已拔除
    const pet = { bounds: { x: 1136, y: 560, width: 135, height: 146 }, workArea: waLeft }
    expect(resolveCenterPos(saved, size, onlyLeft, pet)).toEqual(
      cardPosition(pet.bounds, size, waLeft, 8),
    )
  })

  it('無 saved、有寵物 → 等同 cardPosition（gap 8）', () => {
    const pet = { bounds: { x: 1136, y: 560, width: 135, height: 146 }, workArea: waLeft }
    expect(resolveCenterPos(undefined, size, workAreas, pet)).toEqual(
      cardPosition(pet.bounds, size, waLeft, 8),
    )
  })

  it('無 saved、無寵物 → undefined', () => {
    expect(resolveCenterPos(undefined, size, workAreas, undefined)).toBeUndefined()
  })
})

describe('posInsideAnyWorkArea', () => {
  it('剛好貼齊 workArea 邊界且恰好塞得下 → true', () => {
    // 左下角貼 workArea 左上角，右下角恰好貼右下角
    const pos = { x: waLeft.x, y: waLeft.height - CENTER_H } // x=0, y=420
    expect(posInsideAnyWorkArea(pos, size, [waLeft])).toBe(true)
  })
})
