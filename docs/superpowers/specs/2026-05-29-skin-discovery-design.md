# 造型掃描與選擇 UI — 設計文件

- 日期：2026-05-29
- 狀態：設計定案（待使用者最終審閱 → 進入實作計畫）
- 範圍代號：Spec ⑥（前為 ⑤ 勿擾模式）

---

## 1. 定位與動機

目前造型（skin）寫死在 `src/core/skins.ts` 的 `SKINS`，spritesheet 由 renderer build-time `import` 打包（`import maySheet from '../../resources/pets/may/spritesheet.webp'`），新增造型必須改 code + 重 build。

本 spec 讓使用者把合規的造型資料夾丟進 `userData/pets/`，重開「造型選擇 UI」就自動出現、可選；並提供一個仿通知中心的獨立浮動視窗顯示 `pet.json` 資訊（名稱／描述／來源／有效性）。無效的造型仍顯示但灰掉並標出原因。

設計經 Codex 技術審查後調整（WebP 尺寸解析、路徑穿越防護、CSP、select 改 query 等）。

## 2. 範圍

**目標（v1）**
- 掃描 `~/Library/Application Support/desktop-notify/pets/<id>/`，每個資料夾含 `pet.json` + spritesheet。
- 合規造型出現在選擇 UI 可選；無效造型灰掉 + 中文原因（缺 json / JSON 格式錯 / 尺寸不符 / spritesheet 路徑不安全 / 找不到圖）。
- UI 顯示 `pet.json` 的 displayName、description、id、來源（內建／使用者）、有效性。
- 內建 3 隻與發現的造型**統一走 `pet://` protocol** 載圖；移除 renderer 的 static import 與 `SHEET_URL`。
- 每次開 UI 重新掃描。
- 選擇後沿用既有 `prefs.skin` 持久化 + push `set-skin`。

**非目標（v1，延後）**
- 使用者自訂掃描路徑（固定 `userData/pets/`）。
- 造型熱重載（不重開 UI 自動更新）。
- 打包（codesign / extraResources）——僅在文件註記打包待辦。
- mtime 快取（v1 用「只讀檔頭」降成本，不做快取）。

## 3. 架構總覽

四塊：
1. **`pet://<id>/sheet` 自訂 protocol**（main）：統一服務內建與發現造型的 spritesheet。
2. **掃描 + 驗證**（main IO + core 純函式）：列內建 3 + 掃 `userData/pets/`，組成 `DiscoveredSkin[]` 與 `id → 實體 spritesheet 路徑` map。
3. **造型選擇視窗**（仿 center：獨立 frameless BrowserWindow + `skins.html`）。
4. **選擇 + 持久化**：沿用既有 `prefs.skin` + push `set-skin`（Spec ④ 造型記憶）。

## 4. 資料模型

```ts
// src/core/skin-scan.ts
export interface DiscoveredSkin {
  id: string
  displayName: string
  description: string
  source: 'builtin' | 'user'
  valid: boolean
  error?: string // 無效時的分類原因（中文、不含本機路徑 / stack）
}

export interface SkinSheetMeta {
  width: number
  height: number
}
```

`get-skins` query 回傳：

```ts
export interface SkinList {
  skins: DiscoveredSkin[]
  requestedId: string // prefs.skin 存的 id（可能已失效）
  effectiveId: string // 目前實際顯示的 id（requestedId 失效時為 DEFAULT_SKIN_ID）
}
```

## 5. 核心純函式（`src/core/`，TDD）

### 5.1 `src/core/webp-size.ts`
> **Codex 指出**：Electron `nativeImage` 對 WebP 尺寸不可靠（官方僅保證 PNG/JPEG），故自寫 header 解析。

```ts
export function readWebpSize(bytes: Uint8Array): SkinSheetMeta | null
```
- 解析 WebP RIFF 容器：檢查 `RIFF....WEBP`；依第 12 byte 起的 chunk fourCC 分三種：
  - `VP8 `（lossy）：寬高在 frame tag 後（14 bits each，`& 0x3fff`）。
  - `VP8L`（lossless）：1 byte signature `0x2f` 後，14+14 bits（width-1、height-1）。
  - `VP8X`（extended）：canvas 寬高各 24-bit（值 +1）。
- 不是合法 WebP / bytes 太短 → 回 `null`。
- **只需檔頭約前 32 bytes** 即可判定，呼叫端只讀檔頭、不載整個檔。

### 5.2 `src/core/skin-scan.ts`
```ts
export function describeSkin(
  rawJson: unknown,
  sheet: SkinSheetMeta | null,
  source: 'builtin' | 'user',
): DiscoveredSkin
```
- 內部用既有 `validatePet`（`src/core/pet-validation.ts`）。
- `sheet === null`（讀不到圖 / 非合法 WebP）→ `valid:false, error:'找不到或無法讀取 spritesheet'`。
- 缺欄位 / JSON 非物件 → 對應分類原因。
- 尺寸不符 → `error:'尺寸不符（需 1536×1872）'`（不印實際路徑）。

```ts
export function isSafeSkinId(id: unknown): id is string // ^[a-z0-9_-]+$
export function isSafeSpritesheetPath(p: unknown): boolean // 非絕對、不含 '..' 區段
```
- protocol id 防護用 `isSafeSkinId`。
- `spritesheetPath` 防護用 `isSafeSpritesheetPath`（relative-only），registry 再以 `path.resolve` 確認 resolved 仍在該 skin 資料夾內。

## 6. main 端

### 6.1 `src/main/skin-registry.ts`（IO）
```ts
export interface ScanResult {
  skins: DiscoveredSkin[]
  sheetPaths: Map<string, string> // id → canonical 絕對 spritesheet 路徑（只含 valid skin）
}
export function scanSkins(userDataDir: string, builtinRoot: string): ScanResult
```
- **內建**：`src/core/skins.ts` 的 `SKINS` 為內建清單，路徑 `join(builtinRoot, 'pets', id, 'spritesheet.webp')`（`builtinRoot = app.getAppPath()`，內含 `resources/`，故實為 `<app>/resources/pets/...`；見 §9 打包註記）。
- **使用者**：`fs.readdirSync(join(userDataDir,'pets'))`，每個資料夾：
  - id = 資料夾名；`isSafeSkinId` 不過 → 略過。
  - **duplicate id 規則**：id 與內建相同 → 跳過（內建優先，使用者不可 shadow）。
  - 讀 `pet.json`（try/catch JSON）；`spritesheetPath`（預設 `spritesheet.webp`）經 `isSafeSpritesheetPath` + `path.resolve` 確認在資料夾內；讀該檔前 32 bytes → `readWebpSize`。
  - `describeSkin(raw, sheet, 'user')`。
- 只有 `valid` 的 skin 進 `sheetPaths` map。
- 防呆：限制掃描資料夾數上限（例如 100）、單一檔頭讀取失敗以 `null` 處理；整體錯誤不外拋。

### 6.2 `src/main/pet-protocol.ts`
- main module top-level（app ready 前、一次）：
  ```ts
  protocol.registerSchemesAsPrivileged([
    { scheme: 'pet', privileges: { standard: true, secure: true } },
  ])
  ```
- `app.whenReady()` 最前段註冊 handler（在任何載入 `pet:` 的視窗前）：
  ```ts
  protocol.handle('pet', (req) => {
    const url = new URL(req.url)         // pet://<id>/sheet
    const id = url.hostname
    if (!isSafeSkinId(id) || url.pathname !== '/sheet') return new Response(null, { status: 400 })
    const path = currentSheetPaths.get(id)
    if (!path) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(path).toString(), { headers: { 'Content-Type': 'image/webp' } })
  })
  ```
- `currentSheetPaths` 由每次 `scanSkins` 更新（module-level，main 持有）。
- 不開 `bypassCSP`；CSP 由各視窗 meta 控（§7）。

### 6.3 掃描時機與 IPC handler（在 window.ts，與既有 prefs / get-prefs 同處）
- Query `get-skins`：呼 `scanSkins` → 更新 `currentSheetPaths` → 算 `effectiveId`（`prefs.skin` 在有效清單則用之，否則 `DEFAULT_SKIN_ID`）→ 回 `SkinList`。
- Query `select-skin(id)`：重掃驗證 id 為當前 valid skin → 設 `prefs.skin = id`、save、push `set-skin` → 回 `{ ok: boolean; effectiveId: string }`（失敗回 `ok:false` 不改 prefs）。
- `bus.emit('open-skins')` → index.ts `createSkinWindow()`（比照 open-center / open-settings）。

## 7. renderer

### 7.1 pet 視窗（`src/renderer/main.ts`）
- `setSkin(id)` 改為：`petEl.style.backgroundImage = url(pet://${id}/sheet)`。
- 移除 3 個 static import 與 `SHEET_URL`。
- 啟動先用 `DEFAULT_SKIN_ID`，main 在 did-finish-load 後 push `effectiveId` 的 `set-skin`（既有流程，改推 effectiveId）。
- `index.html` 加 CSP meta：`img-src 'self' data: pet:`（若原無 CSP 則新增；確保 background-image 的 `pet:` 不被擋）。

### 7.2 造型選擇視窗（新）
- `src/main/skin-window.ts`：`createSkinWindow()`，比照 center-window（frameless、transparent、floating、blur 關、Esc 關）。視窗略大（約 380×500）容納卡片。
- `src/renderer/skins.html` / `skins.ts` / `skins.css`：
  - CSP meta：`img-src 'self' data: pet:; style-src 'self' 'unsafe-inline'`。
  - 載入時 `getSkins()` → 渲染卡片（§ mockup 已定案版面）：左縮圖 + displayName + description + `id`/來源 + 狀態。
  - **縮圖**：`background-image: url(pet://<id>/sheet)` + `background-position` 裁 idle 第一格（左上 192×208 區，依 DISPLAY 比例縮放）。
  - 「使用中」= `effectiveId`；`requestedId` 失效時，該（已不存在的）造型不顯示，但可在 header 標示「上次造型已失效，目前顯示 may」。
  - 點「選擇」→ `selectSkin(id)`；成功後標記更新（不必關窗）。
  - ↻ 重新整理 → 重 `getSkins()`。× / Esc 關。

## 8. IPC（走既有 contract，`src/ipc/contract.ts`）

- Queries：
  - `get-skins`：`{ args: void; result: SkinList }`
  - `select-skin`：`{ args: string; result: { ok: boolean; effectiveId: string } }`
- preload：`getSkins()`、`selectSkin(id)`。
- 既有 `set-skin` push（main → pet renderer）維持，改推 effectiveId。
- 開窗無 IPC（main 內部 bus `open-skins`，由右鍵選單觸發）。

## 9. 既有程式調整

- `src/core/skins.ts`：`SKINS` 續作「內建造型清單」（scan 的 builtin 來源）；`isValidSkinId`（硬編）不再用於 `prefs.skin` 載入驗證——改為動態（scan 後判定）。`loadPrefs` 對 `skin` 放寬為「非空字串即收」。
- 右鍵選單：原「更換造型」submenu **改為單一項「更換造型…」** → `bus.emit('open-skins')`。
- `electron.vite.config.ts`：renderer input 加 `skins: 'src/renderer/skins.html'`。
- **打包待辦（v1 僅註記）**：移除 static import 後 vite 不打包 3 個內建 webp；未來打包需把 `resources/pets` 以 `extraResources` 帶上，並讓 `builtinRoot` 在 packaged 時改用 `process.resourcesPath`。dev 與 `npm run build`/`start`（未打包）走 `app.getAppPath()` 正常。

## 10. 錯誤處理

- 掃描任何單一造型失敗 → 該造型標 invalid，不影響其他。
- protocol id 不安全 / pathname 非 `/sheet` → 400；map 無此 id → 404。
- `spritesheetPath` 不安全 → 該造型 invalid（error:「spritesheet 路徑不安全」），不進 map。
- 錯誤原因分類化（缺 json / JSON 格式錯 / 尺寸不符 / 找不到圖 / 路徑不安全），不洩漏本機絕對路徑或 stack。

## 11. 測試策略

**核心 TDD**
- `webp-size.ts`：VP8 / VP8L / VP8X 三種 header 各回正確寬高；非 WebP / 太短 → null；用實際 `resources/pets/*/spritesheet.webp` 的前 32 bytes 驗 1536×1872。
- `skin-scan.ts`：valid（builtin / user source）、缺 id、JSON 非物件、sheet=null、尺寸不符 → 各對應 `DiscoveredSkin`；`isSafeSkinId` / `isSafeSpritesheetPath`（`../`、絕對路徑、合法相對）各 case。

**整合 / 手動驗收**
- 丟一隻合規造型資料夾到 `userData/pets/foo/`（pet.json + 1536×1872 webp）→ 開造型 UI 出現、可選、寵物切換。
- 丟一隻尺寸不對的 → 灰掉標「尺寸不符」。
- 缺 pet.json / 壞 JSON / `spritesheetPath: "../x"` → 各自灰掉標分類原因。
- 內建 3 隻仍可正常切換（走 pet://）。
- 重啟後 prefs.skin 記得；把使用者造型資料夾刪掉再開 → 退回 may 並可在 UI 看到提示。
- Playwright e2e：pet 視窗 `pet://` 載圖正常、卡片/動畫不壞。

## 12. 檔案清單

**新增**
- `src/core/webp-size.ts` + `tests/core/webp-size.test.ts`
- `src/core/skin-scan.ts` + `tests/core/skin-scan.test.ts`
- `src/main/skin-registry.ts`
- `src/main/pet-protocol.ts`
- `src/main/skin-window.ts`
- `src/renderer/skins.html` / `skins.ts` / `skins.css`

**修改**
- `src/ipc/contract.ts`（get-skins / select-skin queries）
- `src/preload/index.ts` + `api.d.ts`（getSkins / selectSkin）
- `src/main/index.ts`（top-level registerSchemesAsPrivileged、whenReady 註冊 protocol handler、bus open-skins → createSkinWindow）
- `src/main/window.ts`（get-skins / select-skin handler、選單改「更換造型…」、did-finish-load 推 effectiveId）
- `src/main/prefs.ts`（skin sanitize 放寬）
- `src/core/skins.ts`（isValidSkinId 用途調整、SKINS 作 builtin 來源）
- `src/renderer/main.ts`（setSkin 走 pet://、移除 static import、index.html CSP）
- `electron.vite.config.ts`（skins 入口）

## 13. v1 範圍 vs 之後

**v1**：掃描 `userData/pets/`、WebP header 尺寸驗證、pet:// 統一載圖、選擇 UI（資訊 + 灰掉無效 + 重新整理）、選擇持久化。

**之後**：自訂掃描路徑、熱重載、mtime 快取、打包（extraResources + process.resourcesPath + codesign）。
