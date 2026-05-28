import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadWindowState, saveWindowState, type WindowState } from '../../src/main/window-state'

const dirs: string[] = []
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'deskpet-winstate-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('loadWindowState', () => {
  it('檔案不存在 → null', () => {
    expect(loadWindowState(tempDir())).toBeNull()
  })
  it('檔案損壞 → null', () => {
    const d = tempDir()
    writeFileSync(join(d, 'window-state.json'), 'not json')
    expect(loadWindowState(d)).toBeNull()
  })
  it('欄位缺漏 → null', () => {
    const d = tempDir()
    writeFileSync(join(d, 'window-state.json'), JSON.stringify({ x: 1 }))
    expect(loadWindowState(d)).toBeNull()
  })
  it('正確檔 → 回 state 物件', () => {
    const d = tempDir()
    const state: WindowState = { displayId: 2, x: 100, y: 200 }
    writeFileSync(join(d, 'window-state.json'), JSON.stringify(state))
    expect(loadWindowState(d)).toEqual(state)
  })
})

describe('saveWindowState', () => {
  it('寫合法 JSON', () => {
    const d = tempDir()
    saveWindowState(d, { displayId: 1, x: 50, y: 60 })
    const path = join(d, 'window-state.json')
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ displayId: 1, x: 50, y: 60 })
  })
  it('目錄不存在會自動建立', () => {
    const d = join(tempDir(), 'nested')
    saveWindowState(d, { displayId: 1, x: 0, y: 0 })
    expect(existsSync(join(d, 'window-state.json'))).toBe(true)
  })
})
