import { validatePet } from './pet-validation'
import type { SkinSheetMeta } from './webp-size'

export type SkinSource = 'builtin' | 'user'

export interface DiscoveredSkin {
  id: string
  displayName: string
  description: string
  source: SkinSource
  valid: boolean
  error?: string // 分類原因（中文、不含本機路徑 / stack）
}

export function isSafeSkinId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9_-]+$/.test(id)
}

export function isSafeSpritesheetPath(p: unknown): boolean {
  if (typeof p !== 'string' || p.length === 0) return false
  if (p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)) return false // 絕對路徑
  return !p.split(/[\\/]/).includes('..')
}

/**
 * 組成一筆 DiscoveredSkin。id 由呼叫端（資料夾名 / 內建 id）權威指定；
 * 有效性與顯示欄位由 pet.json（rawJson）+ sheet 尺寸決定。
 * 錯誤原因沿用 validatePet 的分類訊息（不含路徑）。
 */
export function describeSkin(
  id: string,
  rawJson: unknown,
  sheet: SkinSheetMeta | null,
  source: SkinSource,
): DiscoveredSkin {
  const rec = typeof rawJson === 'object' && rawJson !== null ? (rawJson as Record<string, unknown>) : {}
  const displayName = typeof rec.displayName === 'string' ? rec.displayName : id
  const description = typeof rec.description === 'string' ? rec.description : ''

  if (sheet === null) {
    return { id, displayName, description, source, valid: false, error: '找不到或無法讀取 spritesheet' }
  }
  const res = validatePet(rawJson, sheet)
  if (!res.ok) {
    return { id, displayName, description, source, valid: false, error: res.errors.join('、') }
  }
  return { id, displayName: res.pet.displayName, description: res.pet.description, source, valid: true }
}
