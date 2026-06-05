import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPrefs, savePrefs } from '../../src/main/prefs'
import { DEFAULT_WALK_BOUNDS } from '../../src/core/walk-planner'
import { DEFAULT_SKIN_ID } from '../../src/core/skins'
import { DEFAULT_POMODORO_PREFS } from '../../src/core/pomodoro-timer'

const dirs: string[] = []
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'deskpet-prefs-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const FULL_DEFAULTS = {
  autoWalk: true,
  walk: DEFAULT_WALK_BOUNDS,
  skin: DEFAULT_SKIN_ID,
  channelLabelMode: 'hidden',
  dnd: false,
  allEnabled: true,
  channels: [],
  knownSources: [],
  pomodoro: { ...DEFAULT_POMODORO_PREFS },
  soundEnabled: true,
}

describe('loadPrefs', () => {
  it('檔案不存在 → 全預設（autoWalk + walk + skin）', () => {
    expect(loadPrefs(tempDir())).toEqual(FULL_DEFAULTS)
  })
  it('檔案損壞 → 全預設', () => {
    const d = tempDir()
    writeFileSync(join(d, 'prefs.json'), 'not json')
    expect(loadPrefs(d)).toEqual(FULL_DEFAULTS)
  })
  it('autoWalk 型別錯 → 該欄位回預設、walk 仍 sanitize、skin 回預設', () => {
    const d = tempDir()
    writeFileSync(
      join(d, 'prefs.json'),
      JSON.stringify({ autoWalk: 'no', walk: { durationMinMs: 800 } }),
    )
    const p = loadPrefs(d)
    expect(p.autoWalk).toBe(true)
    expect(p.walk.durationMinMs).toBe(800)
    expect(p.skin).toBe(DEFAULT_SKIN_ID)
  })
  it('舊版 distance 欄位被忽略，interval/duration 仍生效', () => {
    const d = tempDir()
    writeFileSync(
      join(d, 'prefs.json'),
      JSON.stringify({
        autoWalk: false,
        walk: {
          intervalMinMs: 5_000,
          intervalMaxMs: 6_000,
          distanceMinPx: 10,
          distanceMaxPx: 50,
          durationMinMs: 1000,
          durationMaxMs: 4000,
        },
      }),
    )
    const p = loadPrefs(d)
    expect(p.autoWalk).toBe(false)
    expect(p.walk).toEqual({
      intervalMinMs: 5_000,
      intervalMaxMs: 6_000,
      durationMinMs: 1000,
      durationMaxMs: 4000,
    })
  })
  it('skin: 有效 id → 回該值', () => {
    const d = tempDir()
    writeFileSync(join(d, 'prefs.json'), JSON.stringify({ skin: 'maruko' }))
    expect(loadPrefs(d).skin).toBe('maruko')
  })
  it('skin: 未知 id / 非字串 → 回預設', () => {
    const d = tempDir()
    writeFileSync(join(d, 'prefs.json'), JSON.stringify({ skin: 'unknown-pet' }))
    expect(loadPrefs(d).skin).toBe(DEFAULT_SKIN_ID)
    writeFileSync(join(d, 'prefs.json'), JSON.stringify({ skin: 123 }))
    expect(loadPrefs(d).skin).toBe(DEFAULT_SKIN_ID)
  })
  it('dnd: 預設 false', () => {
    expect(loadPrefs(tempDir()).dnd).toBe(false)
  })
  it('dnd: true 正確讀回', () => {
    const d = tempDir()
    writeFileSync(join(d, 'prefs.json'), JSON.stringify({ dnd: true }))
    expect(loadPrefs(d).dnd).toBe(true)
  })
  it('dnd: 非 boolean → false', () => {
    const d = tempDir()
    writeFileSync(join(d, 'prefs.json'), JSON.stringify({ dnd: 'yes' }))
    expect(loadPrefs(d).dnd).toBe(false)
  })
  it('soundEnabled: 預設 true；缺欄/非 boolean → true；明確 false 保留', () => {
    expect(loadPrefs(tempDir()).soundEnabled).toBe(true)
    const d = tempDir()
    writeFileSync(join(d, 'prefs.json'), JSON.stringify({ soundEnabled: 'no' }))
    expect(loadPrefs(d).soundEnabled).toBe(true)
    writeFileSync(join(d, 'prefs.json'), JSON.stringify({ soundEnabled: false }))
    expect(loadPrefs(d).soundEnabled).toBe(false)
  })
})

describe('savePrefs', () => {
  it('寫入後可讀回相同值（包含 skin）', () => {
    const d = tempDir()
    const prefs = {
      autoWalk: false,
      walk: { intervalMinMs: 10_000, intervalMaxMs: 30_000, durationMinMs: 1000, durationMaxMs: 4000 },
      skin: 'oil-king-penguin',
      channelLabelMode: 'hidden',
      dnd: true,
      allEnabled: true,
      channels: [],
      knownSources: [],
      pomodoro: { enabled: true, workMs: 1_500_000, breakMs: 300_000, afterBreak: 'loop', showOnAll: true },
      soundEnabled: false,
    }
    savePrefs(d, prefs)
    expect(existsSync(join(d, 'prefs.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(d, 'prefs.json'), 'utf8'))).toEqual(prefs)
  })

  it('loadPrefs：pomodoro 邊界值 sanitize（NaN/負數/超大/非法 afterBreak）', () => {
    const d = tempDir()
    // 寫入含非法 pomodoro 的 prefs.json
    writeFileSync(
      join(d, 'prefs.json'),
      JSON.stringify({
        autoWalk: true,
        walk: { intervalMinMs: 5_000, intervalMaxMs: 10_000, durationMinMs: 1000, durationMaxMs: 4000 },
        skin: 'default',
        channelLabelMode: 'hidden',
        dnd: false,
        allEnabled: true,
        channels: [],
        knownSources: [],
        pomodoro: {
          enabled: 'yes', // 非 boolean → false
          workMs: -5, // 負數 → clamp 到 60_000
          breakMs: 999_999_999_999, // 超大 → clamp 到 10_800_000 (180 分鐘)
          afterBreak: 'banana', // 非法值 → 'loop'
          showOnAll: undefined, // 缺欄 → fallback DEFAULT_POMODORO_PREFS.showOnAll (true)
        },
      }),
    )
    const p = loadPrefs(d)
    expect(p.pomodoro.enabled).toBe(false)
    expect(p.pomodoro.workMs).toBe(60_000)
    expect(p.pomodoro.breakMs).toBe(10_800_000)
    expect(p.pomodoro.afterBreak).toBe('loop')
    expect(p.pomodoro.showOnAll).toBe(true)
  })
})
