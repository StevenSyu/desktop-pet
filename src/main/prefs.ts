import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Prefs {
  autoWalk: boolean
}

const FILENAME = 'prefs.json'
const DEFAULTS: Prefs = { autoWalk: true }

export function loadPrefs(userDataDir: string): Prefs {
  const path = join(userDataDir, FILENAME)
  if (!existsSync(path)) return { ...DEFAULTS }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    return {
      autoWalk: typeof parsed.autoWalk === 'boolean' ? parsed.autoWalk : DEFAULTS.autoWalk,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function savePrefs(userDataDir: string, prefs: Prefs): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(userDataDir, FILENAME), JSON.stringify(prefs), 'utf8')
}
