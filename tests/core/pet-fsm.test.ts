import { describe, it, expect } from 'vitest'
import { PetController } from '../../src/core/pet-fsm'
import { normalizePayload, type NotifyType } from '../../src/core/events'

function ev(type: NotifyType, atMs = 0) {
  return normalizePayload({ type, timestamp: atMs }, { now: () => atMs, uuid: () => `${type}-${atMs}` })
}

describe('PetController', () => {
  it('starts idle', () => {
    const pet = new PetController()
    expect(pet.advance(0)).toEqual({ mode: 'idle', animation: 'idle' })
  })

  it('plays a one-shot reaction then returns to idle after its duration', () => {
    const pet = new PetController()
    pet.onEvent(ev('done', 0), 0) // jumping: 5 frames @ 5fps = 1000ms
    expect(pet.advance(100)).toEqual({ mode: 'reaction', animation: 'jumping' })
    expect(pet.advance(900)).toEqual({ mode: 'reaction', animation: 'jumping' })
    expect(pet.advance(1000)).toEqual({ mode: 'idle', animation: 'idle' })
  })

  it('info events do not change the pet (card-only)', () => {
    const pet = new PetController()
    pet.onEvent(ev('info', 0), 0)
    expect(pet.advance(0)).toEqual({ mode: 'idle', animation: 'idle' })
  })

  it('a higher-priority event interrupts an in-flight reaction', () => {
    const pet = new PetController()
    pet.onEvent(ev('done', 0), 0) // jumping
    pet.onEvent(ev('error', 100), 100) // error > done → interrupt to failed
    expect(pet.advance(120)).toEqual({ mode: 'reaction', animation: 'failed' })
  })

  it('a lower-or-equal-priority event does NOT interrupt an in-flight reaction', () => {
    const pet = new PetController()
    pet.onEvent(ev('error', 0), 0) // failed: 8 frames @ 5fps = 1600ms
    pet.onEvent(ev('done', 100), 100) // done < error → ignored
    expect(pet.advance(200)).toEqual({ mode: 'reaction', animation: 'failed' })
  })

  it('after a reaction finishes, a lower-priority event can play', () => {
    const pet = new PetController()
    pet.onEvent(ev('error', 0), 0) // failed ends at 1600ms
    expect(pet.advance(1600)).toEqual({ mode: 'idle', animation: 'idle' })
    pet.onEvent(ev('done', 1600), 1600)
    expect(pet.advance(1700)).toEqual({ mode: 'reaction', animation: 'jumping' })
  })

  it('a looped reaction (working→waiting) persists until replaced', () => {
    const pet = new PetController()
    pet.onEvent(ev('working', 0), 0) // waiting is loop:true
    expect(pet.advance(10_000)).toEqual({ mode: 'reaction', animation: 'waiting' })
    pet.onEvent(ev('error', 10_000), 10_000) // higher priority replaces
    expect(pet.advance(10_010)).toEqual({ mode: 'reaction', animation: 'failed' })
  })
})
