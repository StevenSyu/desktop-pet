import { cardPosition, type Rect } from './card-position'

/** pos+size 完整落在任一 workArea 內？ */
export function posInsideAnyWorkArea(
  pos: { x: number; y: number },
  size: { width: number; height: number },
  workAreas: Rect[],
): boolean {
  return workAreas.some(
    (d) =>
      pos.x >= d.x &&
      pos.y >= d.y &&
      pos.x + size.width <= d.x + d.width &&
      pos.y + size.height <= d.y + d.height,
  )
}

/** 通知中心開窗位置：
 * - saved 仍完整落在任一 workArea → 沿用 saved
 * - 否則有寵物 → 開在寵物旁（cardPosition，gap 8）
 * - 否則 undefined（交給視窗預設定位）
 */
export function resolveCenterPos(
  saved: { x: number; y: number } | undefined,
  size: { width: number; height: number },
  workAreas: Rect[],
  pet: { bounds: Rect; workArea: Rect } | undefined,
): { x: number; y: number } | undefined {
  if (saved && posInsideAnyWorkArea(saved, size, workAreas)) return saved
  if (!pet) return undefined
  return cardPosition(pet.bounds, size, pet.workArea, 8)
}
