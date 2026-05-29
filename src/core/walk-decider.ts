export interface WalkGateState {
  autoWalkEnabled: boolean
  walking: boolean
  animation: string
  hidden: boolean
  now: number
  nextWalkAt: number
}

export function shouldWalkNow(s: WalkGateState): boolean {
  return (
    s.autoWalkEnabled &&
    !s.walking &&
    s.animation === 'idle' &&
    !s.hidden &&
    s.now >= s.nextWalkAt
  )
}
