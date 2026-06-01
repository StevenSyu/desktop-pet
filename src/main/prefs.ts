import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_WALK_BOUNDS,
  sanitizeWalkBounds,
  type WalkBounds,
} from '../core/walk-planner'
import { DEFAULT_SKIN_ID, isValidSkinId } from '../core/skins'
import { sanitizeChannels, type Channel } from '../core/channel'

export interface Prefs {
  autoWalk: boolean
  walk: WalkBounds
  skin: string
  dnd: boolean
  channels: Channel[]
}

const FILENAME = 'prefs.json'
const DEFAULTS: Prefs = {
  autoWalk: true,
  walk: { ...DEFAULT_WALK_BOUNDS },
  skin: DEFAULT_SKIN_ID,
  dnd: false,
  channels: [],
}

export function loadPrefs(userDataDir: string): Prefs {
  const path = join(userDataDir, FILENAME)
  if (!existsSync(path)) {
    return { autoWalk: DEFAULTS.autoWalk, walk: { ...DEFAULTS.walk }, skin: DEFAULTS.skin, dnd: DEFAULTS.dnd, channels: [] }
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const walkRaw = (parsed.walk ?? {}) as Record<string, unknown>
    return {
      autoWalk: typeof parsed.autoWalk === 'boolean' ? parsed.autoWalk : DEFAULTS.autoWalk,
      walk: sanitizeWalkBounds(walkRaw as Partial<WalkBounds>),
      skin: isValidSkinId(parsed.skin) ? (parsed.skin as string) : DEFAULTS.skin,
      dnd: typeof parsed.dnd === 'boolean' ? parsed.dnd : DEFAULTS.dnd,
      channels: sanitizeChannels(parsed.channels),
    }
  } catch {
    return { autoWalk: DEFAULTS.autoWalk, walk: { ...DEFAULTS.walk }, skin: DEFAULTS.skin, dnd: DEFAULTS.dnd, channels: [] }
  }
}

export function savePrefs(userDataDir: string, prefs: Prefs): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(userDataDir, FILENAME), JSON.stringify(prefs), 'utf8')
}

/** 讀最新 prefs、只覆蓋 partial 指定的欄位、寫回，回傳合併後結果。所有 prefs 寫入都走這裡。 */
export function updatePrefs(userDataDir: string, partial: Partial<Prefs>): Prefs {
  const next = { ...loadPrefs(userDataDir), ...partial }
  savePrefs(userDataDir, next)
  return next
}
