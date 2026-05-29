import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_WALK_BOUNDS,
  sanitizeWalkBounds,
  type WalkBounds,
} from '../core/walk-planner'
import { DEFAULT_SKIN_ID, isValidSkinId } from '../core/skins'

export interface Prefs {
  autoWalk: boolean
  walk: WalkBounds
  skin: string
  dnd: boolean
}

const FILENAME = 'prefs.json'
const DEFAULTS: Prefs = {
  autoWalk: true,
  walk: { ...DEFAULT_WALK_BOUNDS },
  skin: DEFAULT_SKIN_ID,
  dnd: false,
}

export function loadPrefs(userDataDir: string): Prefs {
  const path = join(userDataDir, FILENAME)
  if (!existsSync(path)) {
    return { autoWalk: DEFAULTS.autoWalk, walk: { ...DEFAULTS.walk }, skin: DEFAULTS.skin, dnd: DEFAULTS.dnd }
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const walkRaw = (parsed.walk ?? {}) as Record<string, unknown>
    return {
      autoWalk: typeof parsed.autoWalk === 'boolean' ? parsed.autoWalk : DEFAULTS.autoWalk,
      walk: sanitizeWalkBounds(walkRaw as Partial<WalkBounds>),
      skin: isValidSkinId(parsed.skin) ? (parsed.skin as string) : DEFAULTS.skin,
      dnd: typeof parsed.dnd === 'boolean' ? parsed.dnd : DEFAULTS.dnd,
    }
  } catch {
    return { autoWalk: DEFAULTS.autoWalk, walk: { ...DEFAULTS.walk }, skin: DEFAULTS.skin, dnd: DEFAULTS.dnd }
  }
}

export function savePrefs(userDataDir: string, prefs: Prefs): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(userDataDir, FILENAME), JSON.stringify(prefs), 'utf8')
}
