import { cardPosition, type Rect } from './card-position'

export interface CardSpec {
  width: number
  height: number
  shadowPad: number
  gap: number
}

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
