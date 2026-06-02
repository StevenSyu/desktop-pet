import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { clampScale } from '../core/pet-scale'

export interface WindowState {
  displayId: number
  x: number
  y: number
  scale: number
}
export type WindowStates = Record<string, WindowState>

const FILENAME = 'window-state.json'

type MigratableWindowState = {
  displayId: number
  x: number
  y: number
  scale?: unknown
}

function isValid(value: unknown): value is MigratableWindowState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.displayId === 'number' && typeof v.x === 'number' && typeof v.y === 'number'
}

/** 舊單一檔 {displayId,x,y} → { all: 它 }；新 keyed map → 過濾有效項；其餘 → {}。 */
export function migrateWindowStates(raw: unknown): WindowStates {
  if (isValid(raw)) return { all: { displayId: raw.displayId, x: raw.x, y: raw.y, scale: clampScale(raw.scale) } }
  if (typeof raw !== 'object' || raw === null) return {}
  const out: WindowStates = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isValid(v)) out[k] = { displayId: v.displayId, x: v.x, y: v.y, scale: clampScale(v.scale) }
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
