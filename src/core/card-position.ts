export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * 依寵物視窗 bounds 算卡片視窗左上座標。
 * - 右對齊寵物（卡片右緣對齊寵物右緣），水平夾進 workArea。
 * - 預設浮在寵物上方；上方空間不足（超出 workArea 頂）則翻到下方。
 */
export function cardPosition(
  pet: Rect,
  card: { width: number; height: number },
  workArea: Rect,
  gap: number,
): { x: number; y: number } {
  const rawX = pet.x + pet.width - card.width
  const x = clamp(rawX, workArea.x, workArea.x + workArea.width - card.width)

  const aboveY = pet.y - card.height - gap
  const y = aboveY >= workArea.y ? aboveY : pet.y + pet.height + gap

  return { x, y }
}
