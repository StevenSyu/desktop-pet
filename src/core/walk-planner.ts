export type WalkDirection = 'left' | 'right'

export interface Walk {
  direction: WalkDirection
  distance: number
  duration: number
  nextWalkAt: number
}

export interface WorkArea { x: number; y: number; width: number; height: number }

const DISTANCE_MIN = 60
const DISTANCE_MAX = 200
const DURATION_MIN_MS = 1500
const DURATION_MAX_MS = 3000
const INTERVAL_MIN_MS = 30_000
const INTERVAL_MAX_MS = 90_000

export function pickWalk(rng: () => number, now: number): Walk {
  const direction: WalkDirection = rng() < 0.5 ? 'left' : 'right'
  const distance = Math.round(DISTANCE_MIN + rng() * (DISTANCE_MAX - DISTANCE_MIN))
  const duration = Math.round(DURATION_MIN_MS + rng() * (DURATION_MAX_MS - DURATION_MIN_MS))
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
