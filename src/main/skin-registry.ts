import { existsSync, readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { SKINS } from '../core/skins'
import { readWebpSize, type SkinSheetMeta } from '../core/webp-size'
import {
  describeSkin,
  isSafeSkinId,
  isSafeSpritesheetPath,
  type DiscoveredSkin,
} from '../core/skin-scan'

const MAX_USER_SKINS = 100
const HEADER_BYTES = 32

export interface ScanResult {
  skins: DiscoveredSkin[]
  sheetPaths: Map<string, string> // id → canonical 絕對 spritesheet 路徑（僅 valid skin）
}

// 只讀檔頭前 N bytes，避免載入整個 ~2MB webp
function readHeader(path: string): Uint8Array | null {
  try {
    const fd = openSync(path, 'r')
    try {
      const buf = Buffer.alloc(HEADER_BYTES)
      const n = readSync(fd, buf, 0, HEADER_BYTES, 0)
      return new Uint8Array(buf.subarray(0, n))
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
}

function sheetMeta(path: string): SkinSheetMeta | null {
  if (!existsSync(path)) return null
  const header = readHeader(path)
  return header ? readWebpSize(header) : null
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export function scanSkins(userDataDir: string, builtinRoot: string): ScanResult {
  const skins: DiscoveredSkin[] = []
  const sheetPaths = new Map<string, string>()
  const seen = new Set<string>()

  // ===== 內建 =====
  for (const s of SKINS) {
    const dir = join(builtinRoot, 'resources', 'pets', s.id)
    const sheet = join(dir, 'spritesheet.webp')
    const skin = describeSkin(s.id, readJson(join(dir, 'pet.json')), sheetMeta(sheet), 'builtin')
    skins.push(skin)
    seen.add(s.id)
    if (skin.valid) sheetPaths.set(s.id, sheet)
  }

  // ===== 使用者 userData/pets/* =====
  const userRoot = join(userDataDir, 'pets')
  if (!existsSync(userRoot)) return { skins, sheetPaths }

  let entries: string[] = []
  try {
    entries = readdirSync(userRoot).filter((name) => {
      try {
        return statSync(join(userRoot, name)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    entries = []
  }

  for (const id of entries.slice(0, MAX_USER_SKINS)) {
    if (!isSafeSkinId(id) || seen.has(id)) continue // 不安全 id 或與內建撞名（內建優先）→ 略過
    seen.add(id)
    const dir = join(userRoot, id)
    const raw = readJson(join(dir, 'pet.json'))
    const rec = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    const rel = typeof rec.spritesheetPath === 'string' ? rec.spritesheetPath : 'spritesheet.webp'

    if (!isSafeSpritesheetPath(rel)) {
      skins.push({ id, displayName: id, description: '', source: 'user', valid: false, error: 'spritesheet 路徑不安全' })
      continue
    }
    const abs = resolve(dir, rel)
    // 確認 resolved 仍在該 skin 資料夾內
    if (abs !== dir && !abs.startsWith(dir + '/')) {
      skins.push({ id, displayName: id, description: '', source: 'user', valid: false, error: 'spritesheet 路徑不安全' })
      continue
    }
    const skin = describeSkin(id, raw, sheetMeta(abs), 'user')
    skins.push(skin)
    if (skin.valid) sheetPaths.set(id, abs)
  }

  return { skins, sheetPaths }
}
