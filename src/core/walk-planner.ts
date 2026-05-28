export type WalkDirection = 'left' | 'right'

export interface Walk {
  direction: WalkDirection
  distance: number
  duration: number
  nextWalkAt: number
}

export interface WorkArea { x: number; y: number; width: number; height: number }

// 走動秒數是使用者唯一可調的參數；距離以固定速率（px/秒）從 duration 換算。
export interface WalkBounds {
  durationMinMs: number
  durationMaxMs: number
}

export const DEFAULT_WALK_BOUNDS: WalkBounds = {
  durationMinMs: 1500,
  durationMaxMs: 3000,
}

// 走動間隔不開放使用者調整：固定 spec 預設範圍。
const INTERVAL_MIN_MS = 30_000
const INTERVAL_MAX_MS = 90_000

// 走動速率（px/ms）：以原 spec 中段（distance 130px / duration 2250ms ≈ 0.058）為基準
// 取整數方便心算；duration 越長走得越遠。
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
  const interval = Math.round(INTERVAL_MIN_MS + rng() * (INTERVAL_MAX_MS - INTERVAL_MIN_MS))
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

// 夾住 duration 範圍與彼此互換（min 必 <= max；所有值都 >= 0）。
export function sanitizeWalkBounds(b: Partial<WalkBounds>): WalkBounds {
  const d = DEFAULT_WALK_BOUNDS
  const v = (x: unknown, fallback: number): number =>
    typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : fallback
  let durationMinMs = v(b.durationMinMs, d.durationMinMs)
  let durationMaxMs = v(b.durationMaxMs, d.durationMaxMs)
  if (durationMinMs > durationMaxMs) [durationMinMs, durationMaxMs] = [durationMaxMs, durationMinMs]
  return { durationMinMs, durationMaxMs }
}
