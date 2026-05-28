export type WalkDirection = 'left' | 'right'

export interface Walk {
  direction: WalkDirection
  distance: number
  duration: number
  nextWalkAt: number
}

export interface WorkArea { x: number; y: number; width: number; height: number }

// 使用者可調：走動間隔 + 走動秒數；走動距離由秒數固定速率換算，不開放。
export interface WalkBounds {
  intervalMinMs: number
  intervalMaxMs: number
  durationMinMs: number
  durationMaxMs: number
}

export const DEFAULT_WALK_BOUNDS: WalkBounds = {
  intervalMinMs: 30_000,
  intervalMaxMs: 90_000,
  durationMinMs: 1500,
  durationMaxMs: 3000,
}

// 走動速率（px/ms）：原 spec 中段（130px / 2250ms ≈ 0.058）取整，duration 越長走得越遠。
export const WALK_SPEED_PX_PER_MS = 0.08

export function pickWalk(
  rng: () => number,
  now: number,
  bounds: WalkBounds = DEFAULT_WALK_BOUNDS,
): Walk {
  const direction: WalkDirection = rng() < 0.5 ? 'left' : 'right'
  const duration = Math.round(
    bounds.durationMinMs + rng() * (bounds.durationMaxMs - bounds.durationMinMs),
  )
  const distance = Math.max(1, Math.round(duration * WALK_SPEED_PX_PER_MS))
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

export function sanitizeWalkBounds(b: Partial<WalkBounds>): WalkBounds {
  const d = DEFAULT_WALK_BOUNDS
  const v = (x: unknown, fallback: number): number =>
    typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : fallback
  let intervalMinMs = v(b.intervalMinMs, d.intervalMinMs)
  let intervalMaxMs = v(b.intervalMaxMs, d.intervalMaxMs)
  if (intervalMinMs > intervalMaxMs) [intervalMinMs, intervalMaxMs] = [intervalMaxMs, intervalMinMs]
  let durationMinMs = v(b.durationMinMs, d.durationMinMs)
  let durationMaxMs = v(b.durationMaxMs, d.durationMaxMs)
  if (durationMinMs > durationMaxMs) [durationMinMs, durationMaxMs] = [durationMaxMs, durationMinMs]
  return { intervalMinMs, intervalMaxMs, durationMinMs, durationMaxMs }
}
