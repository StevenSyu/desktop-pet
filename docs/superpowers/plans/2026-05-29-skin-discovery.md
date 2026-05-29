# 造型掃描與選擇 UI（Spec ⑥）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 掃描 `userData/pets/` 動態造型、用仿通知中心的選擇視窗呈現 pet.json 資訊並可選；內建與發現造型統一走 `pet://` protocol 載圖。

**Architecture:** 核心純函式（`webp-size` 解析 WebP 尺寸、`skin-scan` 驗證/防護）+ main IO（`skin-registry` 掃描、`pet-protocol` 服務 spritesheet）+ typed IPC（get-skins / select-skin）+ 仿 center 的 `skin-window`。renderer 寵物改走 `pet://` 並移除 static import。

**Tech Stack:** TypeScript, Vitest, Electron `protocol.handle` / `net.fetch`, electron-vite, 既有 IPC contract。

**分支：** 純函式 `webp-size`、`skin-scan` 可在獨立 worktree 併行（disjoint 新檔）；其餘整合在 `feat/skin-discovery` 序列做。

---

## File Structure

**新增**
- `src/core/webp-size.ts` — `readWebpSize(bytes)` 解析 VP8/VP8L/VP8X 尺寸（純）
- `src/core/skin-scan.ts` — `describeSkin` / `isSafeSkinId` / `isSafeSpritesheetPath`（純）
- `src/main/skin-registry.ts` — `scanSkins` 掃描 + id→path map（IO）
- `src/main/pet-protocol.ts` — `pet://` scheme 註冊 + handler
- `src/main/skin-window.ts` — `createSkinWindow`
- `src/renderer/skins.html` / `skins.ts` / `skins.css` — 選擇 UI
- 測試：`tests/core/webp-size.test.ts`、`tests/core/skin-scan.test.ts`

**修改**
- `src/ipc/contract.ts`、`src/preload/index.ts`、`src/preload/api.d.ts`
- `src/main/index.ts`、`src/main/window.ts`、`src/main/prefs.ts`、`src/core/skins.ts`
- `src/renderer/main.ts`、`src/renderer/index.html`、`electron.vite.config.ts`

---

### Task 0：開分支 + worktree

- [ ] **Step 1：主分支 feat + 兩個純函式 worktree**

```bash
cd /Users/stevenSyu/Work/desktop-notify
git checkout -b feat/skin-discovery
git worktree add -b feat/webp-size ../desktop-pet-webp main
git worktree add -b feat/skin-scan ../desktop-pet-skinscan main
ln -s /Users/stevenSyu/Work/desktop-notify/node_modules ../desktop-pet-webp/node_modules
ln -s /Users/stevenSyu/Work/desktop-notify/node_modules ../desktop-pet-skinscan/node_modules
git worktree list
```

Expected：三個 worktree 列出。

---

### Task 1：`webp-size.ts`（純函式 TDD，worktree `feat/webp-size`，可派 Codex）

**Files:**
- Create: `src/core/webp-size.ts`
- Create: `tests/core/webp-size.test.ts`

- [ ] **Step 1：寫失敗測試**

```ts
// tests/core/webp-size.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readWebpSize } from '../../src/core/webp-size'

describe('readWebpSize', () => {
  it('真實內建 spritesheet（VP8L）→ 1536×1872', () => {
    const bytes = readFileSync(join(__dirname, '../../resources/pets/may/spritesheet.webp')).subarray(0, 32)
    expect(readWebpSize(new Uint8Array(bytes))).toEqual({ width: 1536, height: 1872 })
  })

  it('VP8L 合成 header → 正確寬高', () => {
    // RIFF????WEBPVP8L????[0x2f][w-1,h-1 packed]
    // width=1536(0x5ff), height=1872(0x74f): b0=0xff b1=0xc5 b2=0xd3 b3=0x11
    const b = new Uint8Array(25)
    b.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
    b.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
    b.set([0x56, 0x50, 0x38, 0x4c], 12) // VP8L
    b[20] = 0x2f
    b.set([0xff, 0xc5, 0xd3, 0x11], 21)
    expect(readWebpSize(b)).toEqual({ width: 1536, height: 1872 })
  })

  it('VP8 (lossy) header → 正確寬高', () => {
    // width=100, height=200 at LE 14-bit
    const b = new Uint8Array(30)
    b.set([0x52, 0x49, 0x46, 0x46], 0)
    b.set([0x57, 0x45, 0x42, 0x50], 8)
    b.set([0x56, 0x50, 0x38, 0x20], 12) // 'VP8 '
    b.set([0x9d, 0x01, 0x2a], 23) // start code
    b[26] = 100 & 0xff; b[27] = (100 >> 8) & 0x3f
    b[28] = 200 & 0xff; b[29] = (200 >> 8) & 0x3f
    expect(readWebpSize(b)).toEqual({ width: 100, height: 200 })
  })

  it('VP8X (extended) header → 正確寬高（值 +1、24-bit LE）', () => {
    const b = new Uint8Array(30)
    b.set([0x52, 0x49, 0x46, 0x46], 0)
    b.set([0x57, 0x45, 0x42, 0x50], 8)
    b.set([0x56, 0x50, 0x38, 0x58], 12) // 'VP8X'
    // canvas width=1536 → stored 1535; height=1872 → 1871
    const w = 1535, h = 1871
    b[24] = w & 0xff; b[25] = (w >> 8) & 0xff; b[26] = (w >> 16) & 0xff
    b[27] = h & 0xff; b[28] = (h >> 8) & 0xff; b[29] = (h >> 16) & 0xff
    expect(readWebpSize(b)).toEqual({ width: 1536, height: 1872 })
  })

  it('非 WebP → null', () => {
    expect(readWebpSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
  })
  it('太短 → null', () => {
    expect(readWebpSize(new Uint8Array(8))).toBeNull()
  })
})
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd ../desktop-pet-webp && npx vitest run tests/core/webp-size.test.ts --configLoader runner`
Expected：FAIL（module 不存在）。

- [ ] **Step 3：實作 `src/core/webp-size.ts`**

```ts
export interface SkinSheetMeta {
  width: number
  height: number
}

function fourCC(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])
}

/**
 * 解析 WebP 容器尺寸（VP8 / VP8L / VP8X）。只需檔頭前 ~30 bytes。
 * 非合法 WebP / bytes 不足 → null。
 */
export function readWebpSize(bytes: Uint8Array): SkinSheetMeta | null {
  if (bytes.length < 16) return null
  if (fourCC(bytes, 0) !== 'RIFF') return null
  if (fourCC(bytes, 8) !== 'WEBP') return null

  const cc = fourCC(bytes, 12)

  if (cc === 'VP8 ') {
    // lossy keyframe：start code 0x9d 0x01 0x2a 在 offset 23；寬高各 14-bit LE 在 26/28
    if (bytes.length < 30) return null
    const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff
    const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff
    return { width, height }
  }

  if (cc === 'VP8L') {
    // lossless：offset 20 signature 0x2f；接著 14-bit (w-1)、14-bit (h-1)
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null
    const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24]
    const width = (((b1 & 0x3f) << 8) | b0) + 1
    const height = ((((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) & 0x3fff) + 1
    return { width, height }
  }

  if (cc === 'VP8X') {
    // extended：canvas 寬高各 24-bit LE，值 +1，在 offset 24 / 27
    if (bytes.length < 30) return null
    const width = ((bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) & 0xffffff) + 1
    const height = ((bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) & 0xffffff) + 1
    return { width, height }
  }

  return null
}
```

- [ ] **Step 4：跑測試確認通過**

Run: `cd ../desktop-pet-webp && npx vitest run tests/core/webp-size.test.ts --configLoader runner`
Expected：6 passed。

- [ ] **Step 5：Commit**

```bash
cd ../desktop-pet-webp
git add src/core/webp-size.ts tests/core/webp-size.test.ts
git commit -m "feat(core): readWebpSize 解析 WebP VP8/VP8L/VP8X 尺寸 + 6 測試"
```

---

### Task 2：`skin-scan.ts`（純函式 TDD，worktree `feat/skin-scan`，可派 Codex）

**Files:**
- Create: `src/core/skin-scan.ts`
- Create: `tests/core/skin-scan.test.ts`

- [ ] **Step 1：寫失敗測試**

```ts
// tests/core/skin-scan.test.ts
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
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd ../desktop-pet-skinscan && npx vitest run tests/core/skin-scan.test.ts --configLoader runner`
Expected：FAIL。

- [ ] **Step 3：實作 `src/core/skin-scan.ts`**

```ts
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
```

- [ ] **Step 4：跑測試確認通過**

Run: `cd ../desktop-pet-skinscan && npx vitest run tests/core/skin-scan.test.ts --configLoader runner`
Expected：全 passed。

- [ ] **Step 5：Commit**

```bash
cd ../desktop-pet-skinscan
git add src/core/skin-scan.ts tests/core/skin-scan.test.ts
git commit -m "feat(core): skin-scan describeSkin + isSafeSkinId/isSafeSpritesheetPath + 測試"
```

---

### Task 3：合併純函式回 feat/skin-discovery

- [ ] **Step 1：把兩個 worktree 分支併回主 feat 分支**

```bash
cd /Users/stevenSyu/Work/desktop-notify   # 在 feat/skin-discovery 上
git merge --no-edit feat/webp-size
git merge --no-edit feat/skin-scan
npm test -- tests/core/webp-size.test.ts tests/core/skin-scan.test.ts 2>&1 | tail -3
```

Expected：兩檔測試通過、乾淨合併（disjoint 新檔）。

- [ ] **Step 2：清掉兩個純函式 worktree**

```bash
git worktree remove ../desktop-pet-webp --force
git worktree remove ../desktop-pet-skinscan --force
git branch -d feat/webp-size feat/skin-scan
```

---

### Task 4：`skin-registry.ts`（IO 掃描）

**Files:**
- Create: `src/main/skin-registry.ts`

- [ ] **Step 1：實作**

```ts
import { existsSync, readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { SKINS } from '../core/skins'
import { readWebpSize } from '../core/webp-size'
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

function sheetMeta(path: string): { width: number; height: number } | null {
  if (!existsSync(path)) return null
  const header = readHeader(path)
  return header ? readWebpSize(header) : null
}

export function scanSkins(userDataDir: string, builtinRoot: string): ScanResult {
  const skins: DiscoveredSkin[] = []
  const sheetPaths = new Map<string, string>()
  const seen = new Set<string>()

  // 內建
  for (const s of SKINS) {
    const sheet = join(builtinRoot, 'resources', 'pets', s.id, 'spritesheet.webp')
    let raw: unknown = null
    try {
      raw = JSON.parse(readFileSync(join(builtinRoot, 'resources', 'pets', s.id, 'pet.json'), 'utf8'))
    } catch {
      raw = null
    }
    const skin = describeSkin(s.id, raw, sheetMeta(sheet), 'builtin')
    skins.push(skin)
    seen.add(s.id)
    if (skin.valid) sheetPaths.set(s.id, sheet)
  }

  // 使用者 userData/pets/*
  const userRoot = join(userDataDir, 'pets')
  if (existsSync(userRoot)) {
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
      let raw: unknown = null
      try {
        raw = JSON.parse(readFileSync(join(dir, 'pet.json'), 'utf8'))
      } catch {
        raw = null
      }
      const rel =
        typeof (raw as Record<string, unknown>)?.spritesheetPath === 'string'
          ? ((raw as Record<string, unknown>).spritesheetPath as string)
          : 'spritesheet.webp'
      let sheet: { width: number; height: number } | null = null
      let resolved: string | null = null
      if (isSafeSpritesheetPath(rel)) {
        const abs = resolve(dir, rel)
        if (abs === dir || abs.startsWith(dir + '/')) {
          resolved = abs
          sheet = sheetMeta(abs)
        }
      }
      const skin = isSafeSpritesheetPath(rel)
        ? describeSkin(id, raw, sheet, 'user')
        : { id, displayName: id, description: '', source: 'user' as const, valid: false, error: 'spritesheet 路徑不安全' }
      skins.push(skin)
      if (skin.valid && resolved) sheetPaths.set(id, resolved)
    }
  }

  return { skins, sheetPaths }
}
```

- [ ] **Step 2：typecheck**

```bash
npm run typecheck
```

Expected：通過。

- [ ] **Step 3：Commit**

```bash
git add src/main/skin-registry.ts
git commit -m "feat(main): skin-registry scanSkins（內建+userData/pets，只讀檔頭、路徑防護、id 防撞）"
```

---

### Task 5：`pet-protocol.ts` + index.ts 註冊

**Files:**
- Create: `src/main/pet-protocol.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1：`src/main/pet-protocol.ts`**

```ts
import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { isSafeSkinId } from '../core/skin-scan'

// app ready 前呼叫一次
export function registerPetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'pet', privileges: { standard: true, secure: true } },
  ])
}

// app.whenReady() 最前段呼叫；getPath 回傳 id 對應的 spritesheet 絕對路徑（無則 null）
export function registerPetProtocol(getPath: (id: string) => string | undefined): void {
  protocol.handle('pet', (req) => {
    const url = new URL(req.url) // pet://<id>/sheet
    const id = url.hostname
    if (!isSafeSkinId(id) || url.pathname !== '/sheet') {
      return new Response(null, { status: 400 })
    }
    const path = getPath(id)
    if (!path) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(path).toString(), { headers: { 'Content-Type': 'image/webp' } })
  })
}
```

- [ ] **Step 2：index.ts top-level 註冊 scheme + whenReady 註冊 handler + open-skins**

`src/main/index.ts` import 區加：

```ts
import { createSkinWindow } from './skin-window'
import { registerPetScheme, registerPetProtocol } from './pet-protocol'
import { getSkinSheetPath } from './window'
```

在所有 import 之後、`app.whenReady()` 之前（module top-level）加：

```ts
registerPetScheme()
```

在 `app.whenReady().then(async () => {` 區塊內、`petWindow = createPetWindow()` 之前加：

```ts
  registerPetProtocol(getSkinSheetPath)
```

在既有 `bus.on('open-settings', ...)` 之後加：

```ts
  let skinWindow: BrowserWindow | null = null
  bus.on('open-skins', () => {
    if (skinWindow && !skinWindow.isDestroyed()) {
      skinWindow.focus()
      return
    }
    skinWindow = createSkinWindow()
    skinWindow.on('closed', () => {
      skinWindow = null
    })
  })
```

（`getSkinSheetPath` 由 Task 6 在 window.ts 匯出：回傳當前 scan 後的 id→path。）

- [ ] **Step 3：typecheck + build（待 Task 6 提供 getSkinSheetPath 後才會綠；本步先確認其餘無誤，允許 getSkinSheetPath 未定義的 import 錯）**

說明：此 Task 與 Task 6 互相依賴，實作時連同 Task 6 一起完成再 typecheck。先做 Step 1/2，Task 6 完成後一起驗證 + commit。

---

### Task 6：window.ts skin handlers + 選單 + prefs 放寬

**Files:**
- Modify: `src/main/window.ts`
- Modify: `src/main/prefs.ts`
- Modify: `src/core/skins.ts`

- [ ] **Step 1：prefs.ts skin sanitize 放寬**

`src/main/prefs.ts`：移除對 `isValidSkinId` 的依賴（skin 動態化）。找到：

```ts
import { DEFAULT_SKIN_ID, isValidSkinId } from '../core/skins'
```
改成：
```ts
import { DEFAULT_SKIN_ID } from '../core/skins'
```
找到：
```ts
      skin: isValidSkinId(parsed.skin) ? (parsed.skin as string) : DEFAULTS.skin,
```
改成：
```ts
      skin: typeof parsed.skin === 'string' && parsed.skin.length > 0 ? parsed.skin : DEFAULTS.skin,
```

- [ ] **Step 2：skins.ts — isValidSkinId 不再被 prefs 用，保留供測試/相容；加註解**

`src/core/skins.ts` 的 `isValidSkinId` 保留不動（其他測試可能參照）；在註解標明「造型有效性現由執行期掃描判定，本函式僅檢內建清單」。無程式改動則跳過。

- [ ] **Step 3：window.ts 加 registry 狀態 + getSkinSheetPath + handlers**

`src/main/window.ts` import 區加：

```ts
import { scanSkins } from './skin-registry'
import { DEFAULT_SKIN_ID as DEFAULT_SKIN } from '../core/skins'
```
（注意：檔案頂部已 `import { ..., DEFAULT_SKIN_ID } from '../core/skins'`；沿用既有的 `DEFAULT_SKIN_ID`，不要重複匯入——若已存在就不加這行，直接用既有的。）

在 module top-level（`let petWinRef` 附近）加：

```ts
let skinSheetPaths = new Map<string, string>()
```

匯出給 protocol 用（檔案尾端或 createPetWindow 外）：

```ts
export function getSkinSheetPath(id: string): string | undefined {
  return skinSheetPaths.get(id)
}
```

在 handlers 區塊（與 `handleQuery('get-prefs', ...)` 同處）加：

```ts
    handleQuery('get-skins', () => {
      const { skins, sheetPaths } = scanSkins(app.getPath('userData'), app.getAppPath())
      skinSheetPaths = sheetPaths
      const requestedId = prefs.skin
      const effectiveId = sheetPaths.has(requestedId) ? requestedId : DEFAULT_SKIN_ID
      return { skins, requestedId, effectiveId }
    })
    handleQuery('select-skin', (id) => {
      const { sheetPaths } = scanSkins(app.getPath('userData'), app.getAppPath())
      skinSheetPaths = sheetPaths
      if (!sheetPaths.has(id)) {
        const effectiveId = sheetPaths.has(prefs.skin) ? prefs.skin : DEFAULT_SKIN_ID
        return { ok: false, effectiveId }
      }
      prefs = { ...prefs, skin: id }
      savePrefs(app.getPath('userData'), prefs)
      pushTo(petWinRef, 'set-skin', id)
      return { ok: true, effectiveId: id }
    })
```

- [ ] **Step 4：選單改「更換造型…」開窗**

`src/main/window.ts` 找到既有「更換造型」submenu（`label: '更換造型', submenu: SKINS.map(...)`）整塊，替換成：

```ts
        { label: '更換造型…', click: () => bus.emit('open-skins') },
```

- [ ] **Step 5：did-finish-load 推 effectiveId（而非 prefs.skin）**

`src/main/window.ts` 找到：

```ts
  win.webContents.once('did-finish-load', () => {
    pushTo(win, 'set-skin', prefs.skin)
  })
```
改成（先掃一次決定 effectiveId）：

```ts
  win.webContents.once('did-finish-load', () => {
    const { sheetPaths } = scanSkins(app.getPath('userData'), app.getAppPath())
    skinSheetPaths = sheetPaths
    const effectiveId = sheetPaths.has(prefs.skin) ? prefs.skin : DEFAULT_SKIN_ID
    pushTo(win, 'set-skin', effectiveId)
  })
```

- [ ] **Step 6：typecheck + build（連同 Task 5）**

```bash
npm run typecheck && npm run build
```

Expected：通過。

- [ ] **Step 7：Commit（含 Task 5 的 pet-protocol + index.ts）**

```bash
git add src/main/pet-protocol.ts src/main/index.ts src/main/window.ts src/main/prefs.ts src/core/skins.ts
git commit -m "feat(main): pet:// protocol + get-skins/select-skin handler + 選單改「更換造型…」+ prefs skin 放寬"
```

---

### Task 7：IPC contract + preload

**Files:**
- Modify: `src/ipc/contract.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/api.d.ts`

- [ ] **Step 1：contract.ts 加 import + 兩個 query**

`src/ipc/contract.ts` import 區加：
```ts
import type { DiscoveredSkin } from '../core/skin-scan'
```
`Queries` interface 加：
```ts
  'get-skins': { args: void; result: { skins: DiscoveredSkin[]; requestedId: string; effectiveId: string } }
  'select-skin': { args: string; result: { ok: boolean; effectiveId: string } }
```

- [ ] **Step 2：preload/index.ts 暴露**

`src/preload/index.ts` import 區加：
```ts
import type { DiscoveredSkin } from '../core/skin-scan'
```
在既有 `getPrefs: ...` 之後加：
```ts
  getSkins: () => invokeQuery('get-skins'),
  selectSkin: (id: string) => invokeQuery('select-skin', id),
```

- [ ] **Step 3：api.d.ts 型別**

`src/preload/api.d.ts` import 區加：
```ts
import type { DiscoveredSkin } from '../core/skin-scan'
```
petBridge 介面加：
```ts
      getSkins: () => Promise<{ skins: DiscoveredSkin[]; requestedId: string; effectiveId: string }>
      selectSkin: (id: string) => Promise<{ ok: boolean; effectiveId: string }>
```

- [ ] **Step 4：typecheck**

```bash
npm run typecheck
```

Expected：通過。（注意 api.d.ts 被 web build 編到；`DiscoveredSkin` 來自 `src/core/skin-scan`，該檔僅 import `pet-validation`/`webp-size`（純 core，無 node），web-safe。）

- [ ] **Step 5：Commit**

```bash
git add src/ipc/contract.ts src/preload/index.ts src/preload/api.d.ts
git commit -m "feat(ipc): get-skins / select-skin queries + preload bridge"
```

---

### Task 8：renderer 寵物改 pet:// + CSP

**Files:**
- Modify: `src/renderer/main.ts`
- Modify: `src/renderer/index.html`

- [ ] **Step 1：index.html CSP 加 pet:**

`src/renderer/index.html` 找到：
```html
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'" />
```
改成：
```html
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: pet:; style-src 'self' 'unsafe-inline'" />
```

- [ ] **Step 2：main.ts setSkin 走 pet:// + 移除 static import / SHEET_URL**

`src/renderer/main.ts` 找到並刪除：
```ts
import maySheet from '../../resources/pets/may/spritesheet.webp'
import marukoSheet from '../../resources/pets/maruko/spritesheet.webp'
import penguinSheet from '../../resources/pets/oil-king-penguin/spritesheet.webp'
```
和：
```ts
const SHEET_URL: Record<string, string> = {
  'may': maySheet,
  'maruko': marukoSheet,
  'oil-king-penguin': penguinSheet,
}
```
找到 `setSkin`：
```ts
function setSkin(id: string): void {
  petEl.style.backgroundImage = `url(${SHEET_URL[id] ?? SHEET_URL[DEFAULT_SKIN_ID]})`
}
```
改成：
```ts
function setSkin(id: string): void {
  petEl.style.backgroundImage = `url(pet://${id}/sheet)`
}
```
（`DEFAULT_SKIN_ID` 的 import 若因此變 unused，一併移除；`setSkin(DEFAULT_SKIN_ID)` 初始呼叫保留——main 會在 did-finish-load 推 effectiveId 覆寫。）

- [ ] **Step 3：typecheck + build + smoke**

```bash
npm run typecheck && npm run build
perl -e 'alarm 8; exec @ARGV' ./node_modules/.bin/electron . >/tmp/deskpet-skin8.log 2>&1; echo rc=$?
pkill -f "Electron.app/Contents/MacOS/Electron" 2>/dev/null; :
```

Expected：typecheck/build 通過、rc=142、log 無致命錯誤。

- [ ] **Step 4：Commit**

```bash
git add src/renderer/main.ts src/renderer/index.html
git commit -m "feat(renderer): 寵物 setSkin 走 pet:// protocol、移除 static import、CSP 加 pet:"
```

---

### Task 9：造型選擇視窗（skin-window + skins.html/ts/css + vite 入口）

**Files:**
- Create: `src/main/skin-window.ts`
- Create: `src/renderer/skins.html` / `skins.ts` / `skins.css`
- Modify: `electron.vite.config.ts`

- [ ] **Step 1：electron.vite.config.ts 加 skins 入口**

找到 renderer input：
```ts
        input: {
          index: 'src/renderer/index.html',
          center: 'src/renderer/center.html',
          settings: 'src/renderer/settings.html',
        },
```
加一行：
```ts
          skins: 'src/renderer/skins.html',
```

- [ ] **Step 2：`src/main/skin-window.ts`（比照 settings-window）**

```ts
import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

const W = 380
const H = 500

export function createSkinWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.workArea

  const win = new BrowserWindow({
    width: W,
    height: H,
    x: x + Math.max(0, Math.floor((width - W) / 2)),
    y: y + Math.max(0, Math.floor((height - H) / 2)),
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
    },
  })

  win.setAlwaysOnTop(true, 'floating')

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/skins.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/skins.html'))
  }
  return win
}
```

- [ ] **Step 3：`src/renderer/skins.html`**

```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: pet:; style-src 'self' 'unsafe-inline'" />
    <title>更換造型</title>
    <link rel="stylesheet" href="./skins.css" />
  </head>
  <body>
    <div class="panel">
      <header>
        <div class="title">更換造型 <span id="count"></span></div>
        <div class="actions">
          <button id="refresh" title="重新整理">↻</button>
          <button id="close" aria-label="關閉" title="關閉（Esc）">×</button>
        </div>
      </header>
      <div id="hint" class="hint" hidden></div>
      <div id="list"></div>
    </div>
    <script type="module" src="./skins.ts"></script>
  </body>
</html>
```

- [ ] **Step 4：`src/renderer/skins.ts`**

```ts
/// <reference path="../preload/api.d.ts" />
import type { DiscoveredSkin } from '../core/skin-scan'

const DISPLAY_SCALE = 0.5 // 縮圖比例（sheet frame 192×208 → 96×104）
const FRAME_W = 192
const FRAME_H = 208
const SHEET_W = 1536
const SHEET_H = 1872

const listEl = document.querySelector<HTMLDivElement>('#list')!
const countEl = document.querySelector<HTMLSpanElement>('#count')!
const hintEl = document.querySelector<HTMLDivElement>('#hint')!

function thumbStyle(id: string): string {
  // 用 idle 第一格（左上 192×208）當縮圖
  return [
    `width:${FRAME_W * DISPLAY_SCALE}px`,
    `height:${FRAME_H * DISPLAY_SCALE}px`,
    `background-image:url(pet://${id}/sheet)`,
    `background-size:${SHEET_W * DISPLAY_SCALE}px ${SHEET_H * DISPLAY_SCALE}px`,
    'background-position:0 0',
    'background-repeat:no-repeat',
    'image-rendering:pixelated',
  ].join(';')
}

function buildCard(skin: DiscoveredSkin, effectiveId: string): HTMLDivElement {
  const card = document.createElement('div')
  card.className = 'card' + (skin.valid ? '' : ' invalid') + (skin.id === effectiveId ? ' current' : '')

  const thumb = document.createElement('div')
  thumb.className = 'thumb'
  if (skin.valid) thumb.setAttribute('style', thumbStyle(skin.id))
  else thumb.textContent = '⚠️'
  card.appendChild(thumb)

  const main = document.createElement('div')
  main.className = 'main'
  const name = document.createElement('div')
  name.className = 'name'
  name.textContent = skin.displayName
  if (skin.id === effectiveId) {
    const tag = document.createElement('span')
    tag.className = 'using'
    tag.textContent = ' · 使用中'
    name.appendChild(tag)
  }
  main.appendChild(name)

  const desc = document.createElement('div')
  desc.className = skin.valid ? 'desc' : 'desc err'
  desc.textContent = skin.valid ? skin.description : (skin.error ?? '無效')
  main.appendChild(desc)

  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.textContent = `id: ${skin.id} · ${skin.source === 'builtin' ? '內建' : '來自 pets/'}${skin.valid ? '' : ' · 不可用'}`
  main.appendChild(meta)
  card.appendChild(main)

  if (skin.valid && skin.id !== effectiveId) {
    const btn = document.createElement('button')
    btn.className = 'select'
    btn.textContent = '選擇'
    btn.addEventListener('click', async () => {
      const res = await window.petBridge.selectSkin(skin.id)
      if (res.ok) render()
    })
    card.appendChild(btn)
  }
  return card
}

async function render(): Promise<void> {
  const { skins, requestedId, effectiveId } = await window.petBridge.getSkins()
  const validCount = skins.filter((s) => s.valid).length
  countEl.textContent = `· ${skins.length} 個（${validCount} 可用）`
  if (requestedId !== effectiveId) {
    hintEl.hidden = false
    hintEl.textContent = `上次造型「${requestedId}」已失效，目前顯示「${effectiveId}」`
  } else {
    hintEl.hidden = true
  }
  listEl.replaceChildren(...skins.map((s) => buildCard(s, effectiveId)))
}

document.querySelector('#refresh')!.addEventListener('click', () => render())
document.querySelector('#close')!.addEventListener('click', () => window.close())
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close()
})

render()
```

- [ ] **Step 5：`src/renderer/skins.css`**

```css
html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
body { font-family: ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif; color: #2a2622; }

.panel {
  margin: 8px;
  background: #fffdf8;
  border-radius: 14px;
  box-shadow: 0 14px 36px rgba(46, 33, 18, .24);
  overflow: hidden;
}
header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-bottom: 1px solid rgba(46, 33, 18, .08);
}
.title { font-weight: 800; font-size: 15px; letter-spacing: .04em; }
.title span { font-size: 11px; font-weight: 600; color: #ad9f8c; }
.actions button {
  border: 0; background: transparent; color: #8a8175; cursor: pointer;
  font-size: 15px; padding: 4px 8px; border-radius: 6px;
}
.actions button:hover { background: rgba(0,0,0,.06); color: #2a2622; }

.hint { padding: 8px 14px; font-size: 11.5px; color: #d6453d; background: rgba(214,69,61,.06); }
.hint[hidden] { display: none; }

#list { max-height: 420px; overflow: auto; }

.card {
  display: flex; gap: 11px; align-items: center;
  padding: 11px 14px; border-bottom: 1px solid rgba(46, 33, 18, .05);
}
.card.current { background: color-mix(in srgb, #2e9e6b 9%, transparent); border-left: 3px solid #2e9e6b; }
.card.invalid { opacity: .55; }

.thumb {
  flex: none; border-radius: 8px; background: #e7e2da;
  display: flex; align-items: center; justify-content: center; font-size: 22px;
  width: 96px; height: 104px;
}
.main { flex: 1; min-width: 0; }
.name { font-weight: 700; font-size: 14px; }
.name .using { font-size: 11px; color: #2e9e6b; font-weight: 700; }
.desc { font-size: 11.5px; color: #7a6e60; line-height: 1.4; margin-top: 2px; }
.desc.err { color: #d6453d; }
.meta { font-size: 10px; color: #ad9f8c; margin-top: 3px; }

button.select {
  flex: none; border: 0; background: #2e9e6b; color: #fff;
  font: 700 12px ui-rounded, "SF Pro Rounded", system-ui, sans-serif;
  padding: 6px 12px; border-radius: 7px; cursor: pointer;
}
button.select:hover { background: #257f56; }
```

- [ ] **Step 6：typecheck + build + smoke**

```bash
npm run typecheck && npm run build
perl -e 'alarm 8; exec @ARGV' ./node_modules/.bin/electron . >/tmp/deskpet-skin9.log 2>&1; echo rc=$?
pkill -f "Electron.app/Contents/MacOS/Electron" 2>/dev/null; :
```

Expected：通過。

- [ ] **Step 7：Commit**

```bash
git add src/main/skin-window.ts src/renderer/skins.html src/renderer/skins.ts src/renderer/skins.css electron.vite.config.ts
git commit -m "feat: 造型選擇視窗（skin-window + skins.html/ts/css），縮圖用 pet:// idle 第一格"
```

---

### Task 10：整合驗證 + 整合分支讓使用者測 + 合併

- [ ] **Step 1：全套自動驗證**

```bash
npm test && npm run typecheck && npm run build && npm run e2e
```

Expected：所有測試通過（含 webp-size 6 + skin-scan）；e2e `SMOKE_RESULT: PASS`（pet:// 載圖正常）。

- [ ] **Step 2：建整合分支讓使用者手動測（不動 main、不 push）**

```bash
git checkout -b integration/round4-skins
git merge --no-edit feat/skin-discovery
npm test 2>&1 | grep -E "Test Files|Tests "
```

- [ ] **Step 3：手動驗收（請使用者跑 `npm run dev`）**

1. 右鍵 → 更換造型… → 開選擇視窗，列出內建 3 隻、縮圖正常、「使用中」標在目前造型。
2. 在 `~/Library/Application Support/desktop-notify/pets/foo/` 放一隻合規造型（pet.json + 1536×1872 webp）→ 點 ↻ 重新整理 → 出現「foo」可選 → 選了寵物切換。
3. 放一隻尺寸不對的（如 1024×768）→ 灰掉、標「尺寸不符（需 1536×1872…）」。
4. 缺 pet.json / 壞 JSON / `spritesheetPath:"../x"` → 各自灰掉標分類原因。
5. 內建 3 隻仍可正常切換（走 pet://）。
6. 選使用者造型後重啟 App → 記得；把該資料夾刪掉再開選擇視窗 → 退回 may + header 顯示「已失效」提示。

- [ ] **Step 4：使用者確認後更新 README/CHANGELOG**

`README.md`「加新造型」段落更新為「丟資料夾到 `~/Library/Application Support/desktop-notify/pets/<id>/`（含 pet.json + 1536×1872 spritesheet.webp），右鍵→更換造型→↻ 即可選用；不需改 code 重建」。右鍵選單那行「更換造型」→「更換造型…（掃描 pets/）」。

`CHANGELOG.md` `[Unreleased]` `### Added` 加：
```markdown
- **造型掃描與選擇 UI**（Spec ⑥）：掃描 `~/Library/Application Support/desktop-notify/pets/<id>/`，合規造型（pet.json + 1536×1872 spritesheet）自動出現在「更換造型…」選擇視窗，顯示名稱/描述/來源，可選；無效造型灰掉並標原因。內建與發現造型統一走 `pet://` 自訂 protocol 載圖（自寫 WebP header 尺寸解析、只讀檔頭、路徑穿越防護）。
```
`### Changed` 加：
```markdown
- **造型載入**：renderer 從 build-time static import 改為執行期 `pet://<id>/sheet` protocol，造型不再需要改 code 重建。
```

- [ ] **Step 5：Commit docs + 合併 + push + 清理**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: README/CHANGELOG 反映 Spec ⑥ 造型掃描與選擇 UI"
git checkout main
git merge --ff-only integration/round4-skins
git branch -d feat/skin-discovery integration/round4-skins
git push
git log --oneline -8
```

Expected：合併乾淨、push 成功、CI 後續轉綠。

---

## 風險與回退

- **`app.getAppPath()` 路徑**：dev / `npm run build`+`start`（未打包）下為 repo 根，`resources/pets` 存在 → OK。未來打包需 `extraResources` + `process.resourcesPath`（已在 spec §9 與 CHANGELOG 不涉及；屬打包待辦）。若 Task 4 內建造型讀不到 → 檢查 `app.getAppPath()` 實際值（log 出來）。
- **CSP 擋 pet:**：若寵物變空白，DevTools console 會報 CSP violation → 確認 index.html / skins.html 的 `img-src` 含 `pet:`。
- **protocol 未在載窗前註冊**：寵物圖載不出 → 確認 `registerPetProtocol` 在 `createPetWindow()` 之前呼叫。
- **web build 編到 skin-scan**：`DiscoveredSkin` 經 api.d.ts 進 web build；skin-scan 只 import pet-validation/webp-size（純），web-safe；若 typecheck 報 node 型別錯，檢查 skin-scan 沒誤 import node 模組。

---

## Self-Review

**1. Spec coverage**

| Spec 段落 | 對應 Task |
|---|---|
| §5.1 readWebpSize | Task 1 |
| §5.2 describeSkin / isSafeSkinId / isSafeSpritesheetPath | Task 2 |
| §6.1 scanSkins（只讀檔頭、duplicate id、路徑防護） | Task 4 |
| §6.2 pet:// protocol | Task 5 |
| §6.3 get-skins / select-skin handler + open-skins | Task 5 + Task 6 |
| §7.1 pet renderer pet:// + CSP | Task 8 |
| §7.2 選擇視窗 | Task 9 |
| §8 IPC contract + preload | Task 7 |
| §9 既有調整（prefs 放寬、選單、vite 入口、打包註記） | Task 6 + Task 9 + docs |
| §11 測試 | Task 1/2（純函式）+ Task 10（整合/手動） |

✓ 全 cover。

**2. Placeholder scan**：無 TBD；每步有具體 code/命令。Task 5 Step 3 標明與 Task 6 互依、一起驗證——非 placeholder，是明確的執行順序說明。

**3. Type consistency**
- `SkinSheetMeta`（webp-size）↔ describeSkin 第三參數型別一致。
- `DiscoveredSkin`（skin-scan）欄位 id/displayName/description/source/valid/error — Task 2 定義，Task 4/7/9 使用一致。
- `describeSkin(id, rawJson, sheet, source)` 四參數順序：Task 2 定義、Task 4 呼叫一致。
- `get-skins` result `{skins, requestedId, effectiveId}`、`select-skin` result `{ok, effectiveId}` — contract（Task 7）、window handler（Task 6）、skins.ts（Task 9）三處一致。
- `getSkinSheetPath`（window.ts 匯出，Task 6）↔ index.ts 使用（Task 5）一致。
- `registerPetScheme` / `registerPetProtocol`（Task 5）名稱一致。

✓
