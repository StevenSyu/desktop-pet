import { cardPosition, type Rect } from './card-position'

export interface CardSpec {
  width: number
  height: number
  shadowPad: number
  gap: number
}

// 卡片視窗幾何常數（視窗尺寸與定位共用；platform-neutral 故置於 core）
export const CARD_W = 264
export const CARD_H = 148
export const CARD_GAP = 8
export const CARD_SHADOW_PAD = 14 // 含透明邊距給 CSS 陰影；定位以視窗 bounds 計
export const CARD_SPEC: CardSpec = { width: CARD_W, height: CARD_H, shadowPad: CARD_SHADOW_PAD, gap: CARD_GAP }

/** 卡片視窗實際 bounds：
 * - dragOffset 非 null（寵物拖動同步中）→ 直接 pet 左上 + offset
 * - 否則以「可見卡」（扣陰影 padding）跑 cardPosition 翻轉定位，再外擴 shadowPad
 * 座標皆 Math.round 取整。
 */
export function cardWindowBounds(
  petBounds: Rect,
  workArea: Rect,
  spec: CardSpec,
  dragOffset: { x: number; y: number } | null,
): Rect {
  if (dragOffset) {
    return {
      x: Math.round(petBounds.x + dragOffset.x),
      y: Math.round(petBounds.y + dragOffset.y),
      width: spec.width,
      height: spec.height,
    }
  }

  const visibleCard = {
    width: spec.width - spec.shadowPad * 2,
    height: spec.height - spec.shadowPad * 2,
  }
  const pos = cardPosition(petBounds, visibleCard, workArea, spec.gap)
  return {
    x: Math.round(pos.x - spec.shadowPad),
    y: Math.round(pos.y - spec.shadowPad),
    width: spec.width,
    height: spec.height,
  }
}
