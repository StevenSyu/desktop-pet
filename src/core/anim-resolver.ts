export interface AnimationContext {
  fsmAnimation: string
  dragMoved: boolean
  dragDirection: 'left' | 'right' | null
  userAnim: string | null
  walking: boolean
  walkDirection: 'left' | 'right' | null
}

/**
 * 決定當前 sprite。優先級由高到低：
 *   1. FSM reaction（非 idle）
 *   2. drag override
 *   3. userAnim（hover / click 反應）
 *   4. walking
 *   5. idle
 */
export function resolveAnimation(ctx: AnimationContext): string {
  if (ctx.fsmAnimation !== 'idle') return ctx.fsmAnimation
  if (ctx.dragMoved) return ctx.dragDirection ? `running-${ctx.dragDirection}` : 'jumping'
  if (ctx.userAnim) return ctx.userAnim
  if (ctx.walking && ctx.walkDirection) return `running-${ctx.walkDirection}`
  return 'idle'
}
