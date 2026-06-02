export const MIN_SCALE = 0.6
export const MAX_SCALE = 1.35

export function clampScale(raw: unknown): number {
  if (typeof raw !== 'number' || Number.isNaN(raw)) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw))
}

export function scaleFromDrag(startScale: number, dx: number, dy: number, baseW: number, baseH: number): number {
  const delta = (dx / baseW + dy / baseH) / 2
  return clampScale(startScale + delta)
}
