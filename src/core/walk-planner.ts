export type WalkDirection = 'left' | 'right'

export interface Walk {
  direction: WalkDirection
  distance: number
  duration: number
  nextWalkAt: number
}

export interface WorkArea { x: number; y: number; width: number; height: number }

export interface WalkBounds {
  intervalMinMs: number
  intervalMaxMs: number
  distanceMinPx: number
  distanceMaxPx: number
  durationMinMs: number
  durationMaxMs: number
}

export const DEFAULT_WALK_BOUNDS: WalkBounds = {
  intervalMinMs: 30_000,
  intervalMaxMs: 90_000,
  distanceMinPx: 60,
  distanceMaxPx: 200,
  durationMinMs: 1500,
  durationMaxMs: 3000,
}

export function pickWalk(
  rng: () => number,
  now: number,
  bounds: WalkBounds = DEFAULT_WALK_BOUNDS,
): Walk {
  const direction: WalkDirection = rng() < 0.5 ? 'left' : 'right'
  const distance = Math.round(
    bounds.distanceMinPx + rng() * (bounds.distanceMaxPx - bounds.distanceMinPx),
  )
  const duration = Math.round(
    bounds.durationMinMs + rng() * (bounds.durationMaxMs - bounds.durationMinMs),
  )
  const interval = Math.round(
    bounds.intervalMinMs + rng() * (bounds.intervalMaxMs - bounds.intervalMinMs),
  )
  return { direction, distance, duration, nextWalkAt: now + interval }
}

export function clampWalkToWorkArea(
  startX: number,
  direction: WalkDirection,
  distance: number,
  workArea: WorkArea,
  petWidth: number,
): number {
  if (direction === 'right') {
    const maxX = workArea.x + workArea.width - petWidth
    const available = Math.max(0, maxX - startX)
    return Math.min(distance, available)
  } else {
    const minX = workArea.x
    const available = Math.max(0, startX - minX)
    return Math.min(distance, available)
  }
}

// 夾住範圍與彼此互換（min 必 <= max；所有值都 >= 0）。
export function sanitizeWalkBounds(b: Partial<WalkBounds>): WalkBounds {
  const d = DEFAULT_WALK_BOUNDS
  const v = (x: unknown, fallback: number): number =>
    typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : fallback
  let intervalMinMs = v(b.intervalMinMs, d.intervalMinMs)
  let intervalMaxMs = v(b.intervalMaxMs, d.intervalMaxMs)
  if (intervalMinMs > intervalMaxMs) [intervalMinMs, intervalMaxMs] = [intervalMaxMs, intervalMinMs]
  let distanceMinPx = v(b.distanceMinPx, d.distanceMinPx)
  let distanceMaxPx = v(b.distanceMaxPx, d.distanceMaxPx)
  if (distanceMinPx > distanceMaxPx) [distanceMinPx, distanceMaxPx] = [distanceMaxPx, distanceMinPx]
  let durationMinMs = v(b.durationMinMs, d.durationMinMs)
  let durationMaxMs = v(b.durationMaxMs, d.durationMaxMs)
  if (durationMinMs > durationMaxMs) [durationMinMs, durationMaxMs] = [durationMaxMs, durationMinMs]
  return { intervalMinMs, intervalMaxMs, distanceMinPx, distanceMaxPx, durationMinMs, durationMaxMs }
}
