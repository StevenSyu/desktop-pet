import { describe, it, expect } from 'vitest'
import { shouldWalkNow, type WalkGateState } from '../../src/core/walk-decider'

function base(overrides) {
  return {
    autoWalkEnabled: true,
    walking: false,
    animation: 'idle',
    hidden: false,
    now: 1000,
    nextWalkAt: 1000,
    ...overrides,
  }
}

describe('shouldWalkNow', () => {
  it('all conditions met boundary => true', () => { expect(shouldWalkNow(base())).toBe(true) })
  it('now > nextWalkAt => true', () => { expect(shouldWalkNow(base({ now: 2000, nextWalkAt: 1000 }))).toBe(true) })
  it('now < nextWalkAt => false', () => { expect(shouldWalkNow(base({ now: 999, nextWalkAt: 1000 }))).toBe(false) })
  it('autoWalkEnabled=false => false', () => { expect(shouldWalkNow(base({ autoWalkEnabled: false }))).toBe(false) })
  it('walking => false', () => { expect(shouldWalkNow(base({ walking: true }))).toBe(false) })
  it('animation not idle => false', () => { expect(shouldWalkNow(base({ animation: 'jumping' }))).toBe(false) })
  it('document hidden => false', () => { expect(shouldWalkNow(base({ hidden: true }))).toBe(false) })
})
