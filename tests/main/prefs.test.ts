import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPrefs, savePrefs } from '../../src/main/prefs'
import { DEFAULT_WALK_BOUNDS } from '../../src/core/walk-planner'

const dirs: string[] = []
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'deskpet-prefs-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('loadPrefs', () => {
  it('檔案不存在 → 預設（autoWalk=true、walk=DEFAULT_WALK_BOUNDS）', () => {
    expect(loadPrefs(tempDir())).toEqual({ autoWalk: true, walk: DEFAULT_WALK_BOUNDS })
  })
  it('檔案損壞 → 預設', () => {
    const d = tempDir()
    writeFileSync(join(d, 'prefs.json'), 'not json')
    expect(loadPrefs(d)).toEqual({ autoWalk: true, walk: DEFAULT_WALK_BOUNDS })
  })
  it('autoWalk 型別錯 → 該欄位回預設、walk 仍 sanitize', () => {
    const d = tempDir()
    writeFileSync(join(d, 'prefs.json'), JSON.stringify({ autoWalk: 'no', walk: { intervalMinMs: 5000 } }))
    const p = loadPrefs(d)
    expect(p.autoWalk).toBe(true)
    expect(p.walk.intervalMinMs).toBe(5000)
  })
  it('合法 + 部分 walk → 缺項回預設', () => {
    const d = tempDir()
    writeFileSync(
      join(d, 'prefs.json'),
      JSON.stringify({ autoWalk: false, walk: { distanceMinPx: 30, distanceMaxPx: 80 } }),
    )
    const p = loadPrefs(d)
    expect(p.autoWalk).toBe(false)
    expect(p.walk.distanceMinPx).toBe(30)
    expect(p.walk.distanceMaxPx).toBe(80)
    expect(p.walk.intervalMinMs).toBe(DEFAULT_WALK_BOUNDS.intervalMinMs)
  })
})

describe('savePrefs', () => {
  it('寫入後可讀回相同值', () => {
    const d = tempDir()
    const prefs = { autoWalk: false, walk: { ...DEFAULT_WALK_BOUNDS, intervalMinMs: 8000 } }
    savePrefs(d, prefs)
    expect(existsSync(join(d, 'prefs.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(d, 'prefs.json'), 'utf8'))).toEqual(prefs)
  })
})
