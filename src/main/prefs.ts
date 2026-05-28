import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_WALK_BOUNDS,
  sanitizeWalkBounds,
  type WalkBounds,
} from '../core/walk-planner'

export interface Prefs {
  autoWalk: boolean
  walk: WalkBounds
}

const FILENAME = 'prefs.json'
const DEFAULTS: Prefs = { autoWalk: true, walk: { ...DEFAULT_WALK_BOUNDS } }

export function loadPrefs(userDataDir: string): Prefs {
  const path = join(userDataDir, FILENAME)
  if (!existsSync(path)) return { autoWalk: DEFAULTS.autoWalk, walk: { ...DEFAULTS.walk } }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const walkRaw = (parsed.walk ?? {}) as Record<string, unknown>
    return {
      autoWalk: typeof parsed.autoWalk === 'boolean' ? parsed.autoWalk : DEFAULTS.autoWalk,
      walk: sanitizeWalkBounds(walkRaw as Partial<WalkBounds>),
    }
  } catch {
    return { autoWalk: DEFAULTS.autoWalk, walk: { ...DEFAULTS.walk } }
  }
}

export function savePrefs(userDataDir: string, prefs: Prefs): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(userDataDir, FILENAME), JSON.stringify(prefs), 'utf8')
}
