import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_WALK_BOUNDS,
  sanitizeWalkBounds,
  type WalkBounds,
} from '../core/walk-planner'
import { DEFAULT_SKIN_ID, isValidSkinId } from '../core/skins'
import { type SourceMatch, sanitizeSources, sanitizeChannels, type Channel } from '../core/channel'
import { sanitizeLabelMode, type ChannelLabelMode } from '../core/channel-label'
import { DEFAULT_POMODORO_PREFS, type PomodoroPrefs } from '../core/pomodoro-timer'

export interface Prefs {
  autoWalk: boolean
  walk: WalkBounds
  skin: string
  channelLabelMode: ChannelLabelMode
  dnd: boolean
  allEnabled: boolean
  channels: Channel[]
  knownSources: SourceMatch[]
  pomodoro: PomodoroPrefs
  soundEnabled: boolean
}

const FILENAME = 'prefs.json'
const DEFAULTS: Prefs = {
  autoWalk: true,
  walk: { ...DEFAULT_WALK_BOUNDS },
  skin: DEFAULT_SKIN_ID,
  channelLabelMode: 'hidden',
  dnd: false,
  allEnabled: true,
  channels: [],
  knownSources: [],
  pomodoro: { ...DEFAULT_POMODORO_PREFS },
  soundEnabled: true,
}

export function sanitizePomodoro(raw: unknown): PomodoroPrefs {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const clampMin = (v: unknown, fallback: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback
    return Math.min(180 * 60_000, Math.max(60_000, n)) // 1–180 分鐘
  }
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_POMODORO_PREFS.enabled,
    workMs: clampMin(o.workMs, DEFAULT_POMODORO_PREFS.workMs),
    breakMs: clampMin(o.breakMs, DEFAULT_POMODORO_PREFS.breakMs),
    afterBreak: o.afterBreak === 'pause' ? 'pause' : 'loop',
    showOnAll: typeof o.showOnAll === 'boolean' ? o.showOnAll : DEFAULT_POMODORO_PREFS.showOnAll,
  }
}

export function loadPrefs(userDataDir: string): Prefs {
  const path = join(userDataDir, FILENAME)
  if (!existsSync(path)) {
    return { autoWalk: DEFAULTS.autoWalk, walk: { ...DEFAULTS.walk }, skin: DEFAULTS.skin, channelLabelMode: 'hidden', dnd: DEFAULTS.dnd, allEnabled: true, channels: [], knownSources: [], pomodoro: { ...DEFAULTS.pomodoro }, soundEnabled: DEFAULTS.soundEnabled }
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const walkRaw = (parsed.walk ?? {}) as Record<string, unknown>
    return {
      autoWalk: typeof parsed.autoWalk === 'boolean' ? parsed.autoWalk : DEFAULTS.autoWalk,
      walk: sanitizeWalkBounds(walkRaw as Partial<WalkBounds>),
      skin: isValidSkinId(parsed.skin) ? (parsed.skin as string) : DEFAULTS.skin,
      channelLabelMode: sanitizeLabelMode(parsed.channelLabelMode),
      dnd: typeof parsed.dnd === 'boolean' ? parsed.dnd : DEFAULTS.dnd,
      allEnabled: typeof parsed.allEnabled === 'boolean' ? parsed.allEnabled : true,
      channels: sanitizeChannels(parsed.channels),
      knownSources: sanitizeSources(parsed.knownSources),
      pomodoro: sanitizePomodoro(parsed.pomodoro),
      soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : DEFAULTS.soundEnabled,
    }
  } catch {
    return { autoWalk: DEFAULTS.autoWalk, walk: { ...DEFAULTS.walk }, skin: DEFAULTS.skin, channelLabelMode: 'hidden', dnd: DEFAULTS.dnd, allEnabled: true, channels: [], knownSources: [], pomodoro: { ...DEFAULTS.pomodoro }, soundEnabled: DEFAULTS.soundEnabled }
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
