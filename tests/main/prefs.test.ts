import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPrefs, savePrefs } from '../../src/main/prefs'

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
  it('檔案不存在 → 預設（autoWalk=true）', () => {
    expect(loadPrefs(tempDir())).toEqual({ autoWalk: true })
  })
  it('檔案損壞 → 預設', () => {
    const d = tempDir()
    writeFileSync(join(d, 'prefs.json'), 'not json')
    expect(loadPrefs(d)).toEqual({ autoWalk: true })
  })
  it('欄位型別錯 → 對應欄位回預設', () => {
    const d = tempDir()
    writeFileSync(join(d, 'prefs.json'), JSON.stringify({ autoWalk: 'no' }))
    expect(loadPrefs(d)).toEqual({ autoWalk: true })
  })
  it('合法檔 → 回該值', () => {
    const d = tempDir()
    writeFileSync(join(d, 'prefs.json'), JSON.stringify({ autoWalk: false }))
    expect(loadPrefs(d)).toEqual({ autoWalk: false })
  })
})

describe('savePrefs', () => {
  it('寫入後可讀回相同值', () => {
    const d = tempDir()
    savePrefs(d, { autoWalk: false })
    expect(existsSync(join(d, 'prefs.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(d, 'prefs.json'), 'utf8'))).toEqual({ autoWalk: false })
  })
})
