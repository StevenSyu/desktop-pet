import { describe, it, expect } from 'vitest'
import { desiredPetIds, diffFleet } from '../../src/core/pet-fleet'
import type { Channel } from '../../src/core/channel'

const ch = (id: string, enabled = true, showPet = true): Channel => ({
  id,
  name: id,
  skin: 'may',
  enabled,
  showPet,
  members: [{ name: `${id}-src` }],
})

describe('desiredPetIds', () => {
  it('allEnabled + 啟用頻道 → all 在前、頻道照順序', () => {
    expect(desiredPetIds([ch('a'), ch('b')], true)).toEqual(['all', 'a', 'b'])
  })
  it('排除停用與 showPet=false 的頻道', () => {
    expect(desiredPetIds([ch('a', false), ch('b', true, false), ch('c')], true)).toEqual(['all', 'c'])
  })
  it('allEnabled=false → 只剩啟用頻道', () => {
    expect(desiredPetIds([ch('a')], false)).toEqual(['a'])
  })
  it('全空 → 強制留 all（≥1 防鎖死）', () => {
    expect(desiredPetIds([], false)).toEqual(['all'])
    expect(desiredPetIds([ch('a', false)], false)).toEqual(['all'])
  })
})

describe('diffFleet', () => {
  it('無差異 → 空 diff', () => {
    expect(diffFleet(['all', 'a'], ['all', 'a'])).toEqual({ close: [], create: [] })
  })
  it('多的關、缺的開，index 取 desired 內位置', () => {
    expect(diffFleet(['all', 'x'], ['all', 'a', 'b'])).toEqual({
      close: ['x'],
      create: [
        { id: 'a', index: 1 },
        { id: 'b', index: 2 },
      ],
    })
  })
  it('從零長出全部', () => {
    expect(diffFleet([], ['all'])).toEqual({ close: [], create: [{ id: 'all', index: 0 }] })
  })
  it('目標為空 → 全關', () => {
    expect(diffFleet(['all', 'a'], [])).toEqual({ close: ['all', 'a'], create: [] })
  })
})
