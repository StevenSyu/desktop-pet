import type { Channel } from './channel'

// 寵物艦隊的純決策：哪些寵物該存在、現況與目標的差集。
// 視窗生命週期副作用（create/close BrowserWindow）留在 main adapter。

/** 應存在的寵物集合：allEnabled?'all' + 啟用且顯示寵物的 channel；空則強制留 'all'（≥1 防鎖死）。 */
export function desiredPetIds(channels: Channel[], allEnabled: boolean): string[] {
  const ids = [...(allEnabled ? ['all'] : []), ...channels.filter((c) => c.enabled && c.showPet).map((c) => c.id)]
  return ids.length > 0 ? ids : ['all']
}

export interface FleetDiff {
  close: string[]
  create: { id: string; index: number }[]
}

/** 現有 vs 應存在的差集。index 為該 id 在 desired 中的位置（供 stackPosition 疊放）。 */
export function diffFleet(currentIds: string[], desiredIds: string[]): FleetDiff {
  const want = new Set(desiredIds)
  const have = new Set(currentIds)
  return {
    close: currentIds.filter((id) => !want.has(id)),
    create: desiredIds.map((id, index) => ({ id, index })).filter(({ id }) => !have.has(id)),
  }
}
