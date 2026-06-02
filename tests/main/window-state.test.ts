import { describe, it, expect } from 'vitest'
import { migrateWindowStates } from '../../src/main/window-state'

describe('migrateWindowStates', () => {
  it('舊單一檔 → { all: 該物件 }（向後相容）', () => {
    expect(migrateWindowStates({ displayId: 1, x: 10, y: 20 })).toEqual({ all: { displayId: 1, x: 10, y: 20, scale: 1 } })
  })
  it('新 keyed map → 過濾有效項', () => {
    const raw = { all: { displayId: 1, x: 1, y: 2 }, cA: { displayId: 1, x: 3, y: 4 }, bad: { x: 1 } }
    expect(migrateWindowStates(raw)).toEqual({ all: { displayId: 1, x: 1, y: 2, scale: 1 }, cA: { displayId: 1, x: 3, y: 4, scale: 1 } })
  })
  it('含 scale round-trip + 舊檔無 scale → 1', () => {
    expect(migrateWindowStates({ cA: { displayId: 1, x: 10, y: 20, scale: 1.5 } }).cA.scale).toBe(1.5)
    expect(migrateWindowStates({ cA: { displayId: 1, x: 10, y: 20 } }).cA.scale).toBe(1)
  })
  it('非物件 → {}', () => expect(migrateWindowStates(null)).toEqual({}))
})
