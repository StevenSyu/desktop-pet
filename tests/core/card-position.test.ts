import { describe, it, expect } from 'vitest'
import { cardPosition, type Rect } from '../../src/core/card-position'

const wa: Rect = { x: 0, y: 0, width: 1440, height: 900 }
const card = { width: 264, height: 112 }
const gap = 8

describe('cardPosition', () => {
  it('上方有空間 → 浮上方、右對齊寵物', () => {
    const pet: Rect = { x: 1136, y: 560, width: 135, height: 146 }
    // x = 1136 + 135 - 264 = 1007；y = 560 - 112 - 8 = 440
    expect(cardPosition(pet, card, wa, gap)).toEqual({ x: 1007, y: 440 })
  })

  it('寵物貼頂、上方不足 → 翻到下方', () => {
    const pet: Rect = { x: 1136, y: 0, width: 135, height: 146 }
    // y(上) = 0 - 112 - 8 = -120 < workArea.y(0) → 下方 = 0 + 146 + 8 = 154
    expect(cardPosition(pet, card, wa, gap)).toEqual({ x: 1007, y: 154 })
  })

  it('寵物貼左邊 → 卡片左緣夾回 workArea.x', () => {
    const pet: Rect = { x: 0, y: 560, width: 135, height: 146 }
    // x = 0 + 135 - 264 = -129 → 夾到 0
    expect(cardPosition(pet, card, wa, gap)).toEqual({ x: 0, y: 440 })
  })

  it('負原點外接螢幕（左側）座標正確', () => {
    const waNeg: Rect = { x: -1920, y: 0, width: 1920, height: 1080 }
    const pet: Rect = { x: -800, y: 560, width: 135, height: 146 }
    // x = -800 + 135 - 264 = -929（在 [-1920, -264] 內）；y = 560 - 112 - 8 = 440
    expect(cardPosition(pet, card, waNeg, gap)).toEqual({ x: -929, y: 440 })
  })

  it('寵物貼右邊 → 卡片右緣不超出 workArea', () => {
    const pet: Rect = { x: 1305, y: 560, width: 135, height: 146 } // 1305+135=1440 貼右
    // x = 1305 + 135 - 264 = 1176；上限 = 1440 - 264 = 1176 → 1176
    expect(cardPosition(pet, card, wa, gap)).toEqual({ x: 1176, y: 440 })
  })

  it('翻到下方會超出底部 → y 夾回工作區', () => {
    const shortWa: Rect = { x: 0, y: 0, width: 1440, height: 400 }
    const tall = { width: 264, height: 380 }
    const pet: Rect = { x: 1136, y: 0, width: 135, height: 146 }
    // x = 1136+135-264 = 1007（夾入 [0,1176] 仍 1007）
    // y：上方 = 0-380-8 < 0 → 下方 = 0+146+8 = 154；夾上限 = 400-380 = 20 → 20
    expect(cardPosition(pet, tall, shortWa, 8)).toEqual({ x: 1007, y: 20 })
  })
})
