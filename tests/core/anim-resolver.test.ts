// tests/core/anim-resolver.test.ts
import { describe, it, expect } from 'vitest'
import { resolveAnimation, type AnimationContext } from '../../src/core/anim-resolver'

function ctx(overrides: Partial<AnimationContext> = {}): AnimationContext {
  return {
    fsmAnimation: 'idle',
    dragMoved: false,
    dragDirection: null,
    userAnim: null,
    walking: false,
    walkDirection: null,
    ...overrides,
  }
}

describe('resolveAnimation 優先級', () => {
  it('全部 idle → 回 idle', () => {
    expect(resolveAnimation(ctx())).toBe('idle')
  })

  it('FSM reaction 最高優先', () => {
    expect(
      resolveAnimation(
        ctx({
          fsmAnimation: 'jumping',
          dragMoved: true,
          dragDirection: 'right',
          userAnim: 'waving',
          walking: true,
          walkDirection: 'left',
        }),
      ),
    ).toBe('jumping')
  })

  it('drag 蓋過 user/walking/idle', () => {
    expect(
      resolveAnimation(
        ctx({
          dragMoved: true,
          dragDirection: 'right',
          userAnim: 'waving',
          walking: true,
          walkDirection: 'left',
        }),
      ),
    ).toBe('running-right')
  })

  it('drag 中無方向 → jumping', () => {
    expect(resolveAnimation(ctx({ dragMoved: true, dragDirection: null }))).toBe('jumping')
  })

  it('drag 中往左 → running-left', () => {
    expect(resolveAnimation(ctx({ dragMoved: true, dragDirection: 'left' }))).toBe('running-left')
  })

  it('userAnim 蓋過 walking/idle', () => {
    expect(
      resolveAnimation(ctx({ userAnim: 'waving', walking: true, walkDirection: 'right' })),
    ).toBe('waving')
  })

  it('walking 但無方向 → idle（保護性）', () => {
    expect(resolveAnimation(ctx({ walking: true, walkDirection: null }))).toBe('idle')
  })

  it('walking + direction → running-{dir}', () => {
    expect(resolveAnimation(ctx({ walking: true, walkDirection: 'right' }))).toBe('running-right')
  })
})
