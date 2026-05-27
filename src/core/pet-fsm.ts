import type { AppEvent } from './events'
import { SPRITE_FORMAT, animationForType, type AnimationName } from './sprite-format'

export type PetMode = 'idle' | 'reaction'

export interface PetView {
  mode: PetMode
  animation: AnimationName
}

const IDLE_VIEW: PetView = { mode: 'idle', animation: 'idle' }

// 非循環反應播完一輪後，多定格停留這麼久再回 idle（依使用者回饋：停約 3 秒）
const HOLD_AFTER_REACTION_MS = 3000

function durationMs(animation: AnimationName): number {
  const spec = SPRITE_FORMAT.animations[animation]
  return (spec.frames / spec.fps) * 1000
}

export class PetController {
  private mode: PetMode = 'idle'
  private animation: AnimationName = 'idle'
  private currentPriority = -1
  private reactionEndsAt = 0

  /**
   * 餵入事件。只有比目前 reaction 更高優先級、或目前已回 idle 時才會改變動畫。
   * `info`（對應 idle 動畫）視為純卡片事件，不改變寵物。
   */
  onEvent(event: AppEvent, now: number): void {
    const animation = animationForType(event.type)
    if (animation === 'idle') return // info：卡片照顯示，寵物不動

    const inFlight = this.mode === 'reaction' && now < this.reactionEndsAt
    if (inFlight && event.priority <= this.currentPriority) return

    const spec = SPRITE_FORMAT.animations[animation]
    this.mode = 'reaction'
    this.animation = animation
    this.currentPriority = event.priority
    this.reactionEndsAt = spec.loop
      ? Number.POSITIVE_INFINITY
      : now + durationMs(animation) + HOLD_AFTER_REACTION_MS
  }

  /** 推進到時間 now，回傳當下應顯示的視圖。非 loop 動畫播畢自動回 idle。 */
  advance(now: number): PetView {
    if (this.mode === 'reaction' && now >= this.reactionEndsAt) {
      this.mode = 'idle'
      this.animation = 'idle'
      this.currentPriority = -1
      this.reactionEndsAt = 0
    }
    return this.mode === 'idle' ? { ...IDLE_VIEW } : { mode: this.mode, animation: this.animation }
  }
}
