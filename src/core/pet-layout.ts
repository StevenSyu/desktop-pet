export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 寵物堆疊定位：index 0 = workArea 右下角；index 1,2,… 向左各退 (寬+gap)。
 * x 夾進 [workArea.x, 右下角 x]；y 同一底列。
 */
export function stackPosition(
  index: number,
  size: { width: number; height: number },
  workArea: Rect,
  margin: number,
  gap: number,
): { x: number; y: number } {
  const baseX = workArea.x + workArea.width - size.width - margin
  const y = workArea.y + workArea.height - size.height - margin
  const x = Math.max(workArea.x, baseX - index * (size.width + gap))
  return { x, y }
}
