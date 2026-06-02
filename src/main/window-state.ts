import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface WindowState {
  displayId: number
  x: number
  y: number
}
export type WindowStates = Record<string, WindowState>

const FILENAME = 'window-state.json'

function isValid(value: unknown): value is WindowState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.displayId === 'number' && typeof v.x === 'number' && typeof v.y === 'number'
}

/** 舊單一檔 {displayId,x,y} → { all: 它 }；新 keyed map → 過濾有效項；其餘 → {}。 */
export function migrateWindowStates(raw: unknown): WindowStates {
  if (isValid(raw)) return { all: { displayId: raw.displayId, x: raw.x, y: raw.y } }
  if (typeof raw !== 'object' || raw === null) return {}
  const out: WindowStates = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isValid(v)) out[k] = { displayId: v.displayId, x: v.x, y: v.y }
  }
  return out
}

export function loadWindowStates(userDataDir: string): WindowStates {
  const path = join(userDataDir, FILENAME)
  if (!existsSync(path)) return {}
  try {
    return migrateWindowStates(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return {}
  }
}

export function saveWindowState(userDataDir: string, channelId: string, state: WindowState): void {
  mkdirSync(userDataDir, { recursive: true })
  const all = loadWindowStates(userDataDir)
  all[channelId] = state
  writeFileSync(join(userDataDir, FILENAME), JSON.stringify(all), 'utf8')
}
