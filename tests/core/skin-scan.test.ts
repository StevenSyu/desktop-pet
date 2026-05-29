import { describe, it, expect } from 'vitest'
import { describeSkin, isSafeSkinId, isSafeSpritesheetPath } from '../../src/core/skin-scan'

const SHEET = { width: 1536, height: 1872 }

describe('isSafeSkinId', () => {
  it('合法 id', () => {
    expect(isSafeSkinId('oil-king-penguin')).toBe(true)
    expect(isSafeSkinId('may_2')).toBe(true)
  })
  it('不合法', () => {
    expect(isSafeSkinId('../etc')).toBe(false)
    expect(isSafeSkinId('a/b')).toBe(false)
    expect(isSafeSkinId('A B')).toBe(false)
    expect(isSafeSkinId(123)).toBe(false)
    expect(isSafeSkinId('')).toBe(false)
  })
})

describe('isSafeSpritesheetPath', () => {
  it('合法相對路徑', () => {
    expect(isSafeSpritesheetPath('spritesheet.webp')).toBe(true)
    expect(isSafeSpritesheetPath('img/sheet.webp')).toBe(true)
  })
  it('絕對 / 含 .. → 不安全', () => {
    expect(isSafeSpritesheetPath('/etc/passwd')).toBe(false)
    expect(isSafeSpritesheetPath('../secret.webp')).toBe(false)
    expect(isSafeSpritesheetPath('a/../../b')).toBe(false)
    expect(isSafeSpritesheetPath('C:\\x.webp')).toBe(false)
    expect(isSafeSpritesheetPath('')).toBe(false)
    expect(isSafeSpritesheetPath(42)).toBe(false)
  })
})

describe('describeSkin', () => {
  const raw = { id: 'foo', displayName: '富豪', description: '一隻測試貓', spritesheetPath: 'spritesheet.webp' }

  it('合法 → valid，帶 source 與顯示欄位', () => {
    expect(describeSkin('foo', raw, SHEET, 'user')).toEqual({
      id: 'foo', displayName: '富豪', description: '一隻測試貓', source: 'user', valid: true,
    })
  })

  it('sheet=null（讀不到圖）→ invalid 帶原因', () => {
    const r = describeSkin('foo', raw, null, 'user')
    expect(r.valid).toBe(false)
    expect(r.error).toContain('spritesheet')
    expect(r.id).toBe('foo')
  })

  it('尺寸不符 → invalid 帶尺寸原因、不洩漏路徑', () => {
    const r = describeSkin('foo', raw, { width: 1024, height: 768 }, 'user')
    expect(r.valid).toBe(false)
    expect(r.error).toContain('1536')
    expect(r.error).not.toContain('/')
  })

  it('缺欄位（非物件 json）→ invalid，id 用傳入的資料夾名', () => {
    const r = describeSkin('robot', null, SHEET, 'user')
    expect(r.valid).toBe(false)
    expect(r.id).toBe('robot')
  })

  it('builtin source 標示', () => {
    expect(describeSkin('may', raw, SHEET, 'builtin').source).toBe('builtin')
  })
})
