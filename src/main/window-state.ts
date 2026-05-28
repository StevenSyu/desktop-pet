import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface WindowState {
  displayId: number
  x: number
  y: number
}

const FILENAME = 'window-state.json'

function isValid(value: unknown): value is WindowState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.displayId === 'number' && typeof v.x === 'number' && typeof v.y === 'number'
}

export function loadWindowState(userDataDir: string): WindowState | null {
  const path = join(userDataDir, FILENAME)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return isValid(parsed) ? { displayId: parsed.displayId, x: parsed.x, y: parsed.y } : null
  } catch {
    return null
  }
}

export function saveWindowState(userDataDir: string, state: WindowState): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(userDataDir, FILENAME), JSON.stringify(state), 'utf8')
}
