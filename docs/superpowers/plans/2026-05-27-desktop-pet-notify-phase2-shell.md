# 桌面寵物通知工具 — Phase 2：Electron 外殼（會動的骨架 + 事件管線）實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Phase 1 的核心庫接上 Electron，做出一個會在桌面右下角待機賣萌、收到 HTTP 事件就播反應動畫＋卡片的可執行 App。

**Architecture:** electron-vite 三段式（main / preload / renderer）。main 託管本機 HTTP ingest server 與 endpoint.json；preload 用 contextBridge 暴露型別化 IPC；renderer 用 CSS background-position 依 Phase 1 的 `PetController` + `SPRITE_FORMAT` 渲染精靈，並顯示卡片。core 維持與 Electron 無關，main 與 renderer 共用。

**Tech Stack:** Electron、electron-vite、TypeScript、Vitest。沿用 Phase 1 的 `src/core`。

**設計來源：** `docs/superpowers/specs/2026-05-27-desktop-pet-notify-design.md`（§4 架構、§7 連接埠/安全、§12 通知、§13 視窗控制器）。

**前置：** Phase 1 已併入 main（`src/core` 5 模組、28 測試）。

**範圍（Phase 2）**：開機常駐、右下角透明置頂無邊框視窗、may 待機動畫、本機 HTTP 端點＋endpoint.json＋token、`curl` → 寵物反應＋卡片、點擊穿透。
**不在 Phase 2（延後 Phase 2b/3）**：選單列托盤、多寵物切換 UI、開機自啟、掃描使用者目錄的完整 pet registry（本階段用內建 may）、音效。

**注意：**
- 所有 commit 訊息結尾附：`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- **需要網路的步驟（npm install）由 Claude 執行**；Codex 沙箱無法連 npm registry（見專案記憶）。Electron 整合任務多為**手動驗收**，由 Claude 啟動 App 觀察。

---

## File Structure

```
desktop-notify/
├── electron.vite.config.ts        # electron-vite 設定（main/preload/renderer 入口）
├── tsconfig.json                  # 參照用根設定（既有，擴充 references）
├── tsconfig.node.json             # main/preload（Node 環境）
├── tsconfig.web.json              # renderer（DOM 環境）
├── package.json                   # 加 electron / electron-vite + scripts、main 入口
├── src/
│   ├── core/                      # 既有 Phase 1（不動）
│   ├── main/
│   │   ├── index.ts               # app 生命週期、建立視窗、啟動 ingest + endpoint
│   │   ├── window.ts              # 透明/無邊框/置頂/右下角/點擊穿透視窗
│   │   ├── endpoint.ts            # 選埠、產 token、寫 endpoint.json
│   │   └── ingest.ts              # http server：驗 token、解析、normalize、callback
│   ├── preload/
│   │   └── index.ts               # contextBridge：onPetEvent(cb)
│   └── renderer/
│       ├── index.html             # 透明背景頁面
│       ├── main.ts                # 精靈引擎（CSS）＋卡片 UI；接 IPC
│       └── styles.css             # 寵物 + 卡片樣式
├── tests/
│   ├── core/                      # 既有（不動）
│   └── main/
│       ├── endpoint.test.ts       # 選埠 + 寫檔（TDD）
│       └── ingest.test.ts         # 請求處理 / 驗 token / 解析（TDD）
└── resources/pets/may/            # 內建 may（從專案根 may/ 複製，供打包）
    ├── pet.json
    └── spritesheet.webp
```

設計原則：main 端把「可測邏輯」（endpoint、ingest 的請求處理）抽成純函式以利 TDD；Electron 專屬（視窗、IPC、渲染）以最小整合碼 + 手動驗收。

---

## Task 1：electron-vite 骨架與 App 啟動

**Files:**
- Modify: `package.json`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.node.json`
- Create: `tsconfig.web.json`
- Modify: `tsconfig.json`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.ts`

- [ ] **Step 1: 安裝依賴（Claude 執行，需網路）**

Run:
```bash
npm install -D electron electron-vite
```
Expected: 安裝成功，無錯誤。

> 註：Codex 沙箱無法連網，這步必須由 Claude 跑。

- [ ] **Step 2: 設定 package.json 的 main 入口與 scripts**

Modify `package.json` — 加入 `"main"` 與 dev/build/start scripts（保留既有 test/typecheck）：
```json
{
  "name": "desktop-notify",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json"
  }
}
```

- [ ] **Step 3: 建立 electron.vite.config.ts**

Create `electron.vite.config.ts`:
```ts
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: 'src/main/index.ts' } },
    },
  },
  preload: {
    build: {
      rollupOptions: { input: { index: 'src/preload/index.ts' } },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: { input: { index: 'src/renderer/index.html' } },
    },
  },
})
```

- [ ] **Step 4: 建立 TS 分環境設定**

Create `tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src/main", "src/preload", "src/core", "electron.vite.config.ts"]
}
```

Create `tsconfig.web.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "noEmit": true
  },
  "include": ["src/renderer", "src/core"]
}
```

Modify `tsconfig.json`（改為純參照，避免重複涵蓋；測試型別檢查仍由 vitest/tsc 分檔處理）：
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

> 註：core 的單元測試仍用 `npm test`（vitest）；型別檢查改走 `npm run typecheck`（兩個 tsconfig）。

- [ ] **Step 5: 建立最小 main（先只開一個視窗載入 renderer）**

Create `src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 240,
    height: 260,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

> **ESM/`__dirname` 應變**：本專案 `package.json` 有 `"type": "module"`。若 build 後啟動報 `__dirname is not defined`（main/preload 被當 ESM），改用 `import.meta.dirname`（Node 20.11+）：在 main/index.ts 與 window.ts 頂端加 `const __dirname = import.meta.dirname`，或全部 `join(__dirname, ...)` 改 `join(import.meta.dirname, ...)`。若 electron-vite 仍輸出 CJS 則 `__dirname` 原生可用、無需改。以 Task 1 Step 9 實際啟動結果為準。

- [ ] **Step 6: 建立最小 preload**

Create `src/preload/index.ts`:
```ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('petBridge', {
  ping: () => 'pong',
})
```

- [ ] **Step 7: 建立最小 renderer**

Create `src/renderer/index.html`:
```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'" />
    <title>desktop-notify</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div id="app">啟動中…</div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

Create `src/renderer/styles.css`:
```css
html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
#app { font: 12px sans-serif; color: #fff; }
```

Create `src/renderer/main.ts`:
```ts
const app = document.querySelector<HTMLDivElement>('#app')!
app.textContent = `renderer ok: ${(window as unknown as { petBridge?: { ping(): string } }).petBridge?.ping() ?? 'no bridge'}`
```

- [ ] **Step 8: 型別檢查**

Run: `npm run typecheck`
Expected: 兩個 tsconfig 皆通過、exit 0。

- [ ] **Step 9: 啟動 App 手動驗收（Claude 執行）**

Run: `npm run build` （預期 build 成功，產出 `out/main`、`out/preload`、`out/renderer`）
然後啟動並截圖確認：
```bash
timeout 12 npx electron . >/tmp/deskpet-run.log 2>&1 &
sleep 8
# 觀察是否有視窗、log 是否有錯誤
tail -20 /tmp/deskpet-run.log
```
Expected: App 啟動、出現視窗顯示「renderer ok: pong」，log 無致命錯誤。

> 若在無視窗環境（CI/headless）無法目視，至少確認 `npm run build` 成功且 electron 進程啟動無 crash log。

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json electron.vite.config.ts tsconfig.json tsconfig.node.json tsconfig.web.json src/main src/preload src/renderer
git commit -m "feat(shell): electron-vite 骨架與最小視窗" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：透明、無邊框、置頂、右下角定位的視窗

**Files:**
- Create: `src/main/window.ts`
- Modify: `src/main/index.ts`

對應 spec §13（透明/無邊框/置頂；位置依 display work area）。

- [ ] **Step 1: 建立 window.ts**

Create `src/main/window.ts`:
```ts
import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

const PET_WIDTH = 180
const PET_HEIGHT = 220
const MARGIN = 24

export function createPetWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.workArea

  const win = new BrowserWindow({
    width: PET_WIDTH,
    height: PET_HEIGHT,
    x: x + width - PET_WIDTH - MARGIN,
    y: y + height - PET_HEIGHT - MARGIN,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
    },
  })

  win.setAlwaysOnTop(true, 'screen-saver')

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}
```

- [ ] **Step 2: 改 index.ts 改用 createPetWindow**

Modify `src/main/index.ts` — 移除原本的 `createWindow` 與 `BrowserWindow` 直接 import，改用 window.ts。完整替換為：
```ts
import { app, BrowserWindow } from 'electron'
import { createPetWindow } from './window'

app.whenReady().then(() => {
  createPetWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 3: 型別檢查**

Run: `npm run typecheck`
Expected: 通過。

- [ ] **Step 4: 手動驗收（Claude 執行）**

Run:
```bash
npm run build && timeout 12 npx electron . >/tmp/deskpet-run.log 2>&1 &
sleep 8
tail -20 /tmp/deskpet-run.log
```
Expected: 視窗出現在**主螢幕右下角**、**無邊框、背景透明、置頂**；log 無錯誤。

- [ ] **Step 5: Commit**

```bash
git add src/main/window.ts src/main/index.ts
git commit -m "feat(shell): 右下角透明置頂無邊框寵物視窗" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：renderer 精靈引擎（CSS background-position，待機動畫）

**Files:**
- Modify: `src/renderer/main.ts`
- Modify: `src/renderer/styles.css`
- Create: `resources/pets/may/pet.json`（從專案根 `may/` 複製）
- Create: `resources/pets/may/spritesheet.webp`（從專案根 `may/` 複製）

對應 spec §9（格式）、§11（idle）。本階段直接用內建 may（Vite 以 asset 方式載入）。

- [ ] **Step 1: 複製內建 may 到 resources（Claude 執行）**

Run:
```bash
mkdir -p resources/pets/may
cp may/pet.json resources/pets/may/pet.json
cp may/spritesheet.webp resources/pets/may/spritesheet.webp
```
Expected: 兩檔存在於 `resources/pets/may/`。

- [ ] **Step 2: 寫 renderer 精靈引擎**

Replace `src/renderer/main.ts` with:
```ts
import { SPRITE_FORMAT, frameRect, type AnimationName } from '../core/sprite-format'
import { PetController } from '../core/pet-fsm'
import sheetUrl from '../../resources/pets/may/spritesheet.webp'

const DISPLAY_SCALE = 0.7

const petEl = document.querySelector<HTMLDivElement>('#pet')!
petEl.style.width = `${SPRITE_FORMAT.frameWidth * DISPLAY_SCALE}px`
petEl.style.height = `${SPRITE_FORMAT.frameHeight * DISPLAY_SCALE}px`
petEl.style.backgroundImage = `url(${sheetUrl})`
petEl.style.backgroundSize = `${SPRITE_FORMAT.sheetWidth * DISPLAY_SCALE}px ${SPRITE_FORMAT.sheetHeight * DISPLAY_SCALE}px`

const pet = new PetController()

function render(now: number): void {
  const view = pet.advance(now)
  const anim = SPRITE_FORMAT.animations[view.animation as AnimationName]
  const frameIndex = Math.floor((now / 1000) * anim.fps) % anim.frames
  const rect = frameRect(anim.row, frameIndex)
  petEl.style.backgroundPosition = `-${rect.x * DISPLAY_SCALE}px -${rect.y * DISPLAY_SCALE}px`
  requestAnimationFrame(render)
}
requestAnimationFrame(render)

// 之後 Task 6 會在這裡接上 IPC 事件 → pet.onEvent(...)
;(window as unknown as { __pet?: PetController }).__pet = pet
```

Replace `src/renderer/index.html` 的 body 內容為：
```html
  <body>
    <div id="pet"></div>
    <div id="cards"></div>
    <script type="module" src="./main.ts"></script>
  </body>
```

- [ ] **Step 3: 樣式**

Replace `src/renderer/styles.css` with:
```css
html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
#pet {
  position: absolute;
  right: 8px;
  bottom: 8px;
  image-rendering: pixelated;
  background-repeat: no-repeat;
}
#cards {
  position: absolute;
  right: 8px;
  bottom: 170px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
}
```

- [ ] **Step 4: 型別檢查**

Run: `npm run typecheck`
Expected: 通過（renderer 用 tsconfig.web.json，含 DOM lib）。

> 若 `import sheetUrl from '...webp'` 型別報錯，新增 `src/renderer/assets.d.ts`：
> ```ts
> declare module '*.webp' { const src: string; export default src }
> ```
> 並把它加入 tsconfig.web.json 的 include（已含 src/renderer）。

- [ ] **Step 5: 手動驗收（Claude 執行）**

Run:
```bash
npm run build && timeout 12 npx electron . >/tmp/deskpet-run.log 2>&1 &
sleep 8
tail -20 /tmp/deskpet-run.log
```
Expected: 右下角看到 **may 在待機動畫**（idle 列循環、像素清晰）；log 無錯誤。

- [ ] **Step 6: Commit**

```bash
git add resources src/renderer
git commit -m "feat(renderer): CSS 精靈引擎與 may 待機動畫" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4：Endpoint manager（選埠 + token + 寫 endpoint.json）— TDD

**Files:**
- Create: `src/main/endpoint.ts`
- Test: `tests/main/endpoint.test.ts`

對應 spec §7。把「找可用埠」與「寫 endpoint.json」抽成可測純函式（fs 與 net 以注入/暫存目錄測試）。

- [ ] **Step 1: 寫失敗測試**

Create `tests/main/endpoint.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeEndpointFile, generateToken, type EndpointInfo } from '../../src/main/endpoint'

const dirs: string[] = []
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'deskpet-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('generateToken', () => {
  it('produces a non-empty unique-ish token', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a.length).toBeGreaterThanOrEqual(16)
    expect(a).not.toBe(b)
  })
})

describe('writeEndpointFile', () => {
  it('writes endpoint.json with port and token', () => {
    const dir = tempDir()
    const info: EndpointInfo = { port: 8765, token: 'tok123' }
    const path = writeEndpointFile(dir, info)
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ port: 8765, token: 'tok123' })
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/main/endpoint.test.ts`
Expected: FAIL（無法解析 `../../src/main/endpoint`）。

- [ ] **Step 3: 寫實作**

Create `src/main/endpoint.ts`:
```ts
import { createServer } from 'node:net'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export interface EndpointInfo {
  port: number
  token: string
}

export const DEFAULT_PORT = 8765

export function generateToken(): string {
  return randomBytes(16).toString('hex')
}

/** 從 startPort 起找一個可用的本機埠。 */
export function findFreePort(startPort = DEFAULT_PORT): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number): void => {
      const srv = createServer()
      srv.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && port < startPort + 50) {
          tryPort(port + 1)
        } else {
          reject(err)
        }
      })
      srv.once('listening', () => {
        srv.close(() => resolve(port))
      })
      srv.listen(port, '127.0.0.1')
    }
    tryPort(startPort)
  })
}

/** 寫 endpoint.json 到 userDataDir，回傳檔案路徑。 */
export function writeEndpointFile(userDataDir: string, info: EndpointInfo): string {
  const path = join(userDataDir, 'endpoint.json')
  writeFileSync(path, JSON.stringify({ port: info.port, token: info.token }), 'utf8')
  return path
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/main/endpoint.test.ts`
Expected: PASS。

- [ ] **Step 5: 型別檢查**

Run: `npm run typecheck`
Expected: 通過。

- [ ] **Step 6: Commit**

```bash
git add src/main/endpoint.ts tests/main/endpoint.test.ts
git commit -m "feat(main): endpoint manager（選埠 + token + endpoint.json）" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：Ingest HTTP server（驗 token + 解析 + normalize）— TDD

**Files:**
- Create: `src/main/ingest.ts`
- Test: `tests/main/ingest.test.ts`

對應 spec §6/§7。把請求處理抽成可測函式 `handleNotifyBody(rawBody, headers, token, deps)`，再由 http server 包起來。

- [ ] **Step 1: 寫失敗測試**

Create `tests/main/ingest.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { handleNotifyBody } from '../../src/main/ingest'

const TOKEN = 'secret'
const deps = { now: () => 1000, uuid: () => 'id-1' }

describe('handleNotifyBody', () => {
  it('rejects a wrong token with 401', () => {
    const res = handleNotifyBody('{}', { 'x-token': 'nope' }, TOKEN, deps)
    expect(res.status).toBe(401)
    expect(res.event).toBeUndefined()
  })

  it('rejects malformed JSON with 400', () => {
    const res = handleNotifyBody('not json', { 'x-token': TOKEN }, TOKEN, deps)
    expect(res.status).toBe(400)
    expect(res.event).toBeUndefined()
  })

  it('accepts a valid payload and returns a normalized event', () => {
    const res = handleNotifyBody(
      JSON.stringify({ type: 'done', title: 'Claude Code', body: '完成', source: 'claude-code' }),
      { 'x-token': TOKEN },
      TOKEN,
      deps,
    )
    expect(res.status).toBe(200)
    expect(res.event).toMatchObject({
      id: 'id-1',
      type: 'done',
      title: 'Claude Code',
      body: '完成',
      source: { kind: 'claude-code' },
      timestamp: 1000,
    })
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/main/ingest.test.ts`
Expected: FAIL（無法解析 `../../src/main/ingest`）。

- [ ] **Step 3: 寫實作**

Create `src/main/ingest.ts`:
```ts
import { createServer, type Server } from 'node:http'
import { normalizePayload, type AppEvent, type NormalizeDeps } from '../core/events'

export interface NotifyResult {
  status: 200 | 400 | 401
  event?: AppEvent
}

/** 純函式：依 token 與 body 決定結果，可單元測試。 */
export function handleNotifyBody(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  token: string,
  deps: NormalizeDeps = {},
): NotifyResult {
  const got = headers['x-token']
  if (got !== token) return { status: 401 }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return { status: 400 }
  }
  if (typeof parsed !== 'object' || parsed === null) return { status: 400 }

  const event = normalizePayload(parsed as Record<string, unknown>, deps)
  return { status: 200, event }
}

export interface IngestOptions {
  port: number
  token: string
  onEvent: (event: AppEvent) => void
}

/** 啟動只綁 127.0.0.1 的 ingest server。 */
export function startIngestServer(opts: IngestOptions): Server {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/notify') {
      res.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const result = handleNotifyBody(body, req.headers, opts.token)
      if (result.status === 200 && result.event) opts.onEvent(result.event)
      res.writeHead(result.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(result.status === 200 ? { ok: true, id: result.event!.id } : { ok: false }))
    })
  })
  server.listen(opts.port, '127.0.0.1')
  return server
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/main/ingest.test.ts`
Expected: PASS（3 tests）。

- [ ] **Step 5: 型別檢查**

Run: `npm run typecheck`
Expected: 通過。

- [ ] **Step 6: Commit**

```bash
git add src/main/ingest.ts tests/main/ingest.test.ts
git commit -m "feat(main): ingest HTTP server（驗 token + 解析 + normalize）" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6：串接 main → renderer（事件 → 寵物反應 + 卡片）

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Create: `src/preload/api.d.ts`
- Modify: `src/renderer/main.ts`

對應 spec §4 資料流、§11 寵物反應、§12 卡片。

- [ ] **Step 1: main 啟動 endpoint + ingest，並把事件送到 renderer**

Replace `src/main/index.ts` with:
```ts
import { app, BrowserWindow } from 'electron'
import { createPetWindow } from './window'
import { findFreePort, generateToken, writeEndpointFile } from './endpoint'
import { startIngestServer } from './ingest'
import type { AppEvent } from '../core/events'

app.whenReady().then(async () => {
  const win = createPetWindow()

  const port = await findFreePort()
  const token = generateToken()
  writeEndpointFile(app.getPath('userData'), { port, token })

  startIngestServer({
    port,
    token,
    onEvent: (event: AppEvent) => {
      if (!win.isDestroyed()) win.webContents.send('pet-event', event)
    },
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 2: preload 暴露 onPetEvent**

Replace `src/preload/index.ts` with:
```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { AppEvent } from '../core/events'

contextBridge.exposeInMainWorld('petBridge', {
  onPetEvent: (cb: (event: AppEvent) => void) => {
    ipcRenderer.on('pet-event', (_e, event: AppEvent) => cb(event))
  },
})
```

Create `src/preload/api.d.ts`:
```ts
import type { AppEvent } from '../core/events'

declare global {
  interface Window {
    petBridge: {
      onPetEvent: (cb: (event: AppEvent) => void) => void
    }
  }
}
export {}
```

- [ ] **Step 3: renderer 接事件 → pet.onEvent + 卡片**

Replace `src/renderer/main.ts` with:
```ts
import { SPRITE_FORMAT, frameRect, type AnimationName } from '../core/sprite-format'
import { PetController } from '../core/pet-fsm'
import { NotificationQueue } from '../core/notification-queue'
import type { AppEvent, NotifyType } from '../core/events'
import sheetUrl from '../../resources/pets/may/spritesheet.webp'

const DISPLAY_SCALE = 0.7
const ICON: Record<NotifyType, string> = {
  done: '✅', attention: '❓', error: '⚠️', review: '🔍', working: '⏳', info: 'ℹ️',
}

const petEl = document.querySelector<HTMLDivElement>('#pet')!
const cardsEl = document.querySelector<HTMLDivElement>('#cards')!
petEl.style.width = `${SPRITE_FORMAT.frameWidth * DISPLAY_SCALE}px`
petEl.style.height = `${SPRITE_FORMAT.frameHeight * DISPLAY_SCALE}px`
petEl.style.backgroundImage = `url(${sheetUrl})`
petEl.style.backgroundSize = `${SPRITE_FORMAT.sheetWidth * DISPLAY_SCALE}px ${SPRITE_FORMAT.sheetHeight * DISPLAY_SCALE}px`

const pet = new PetController()
// 佇列時鐘與事件 timestamp 一致用 performance.now()，否則 active() 會誤判過期、卡片不顯示
const queue = new NotificationQueue({ now: () => performance.now() })

window.petBridge.onPetEvent((event: AppEvent) => {
  pet.onEvent(event, performance.now())
  queue.push({ ...event, timestamp: performance.now() })
})

function renderCards(): void {
  const active = queue.active()
  cardsEl.replaceChildren(
    ...active.map((e) => {
      // 用 textContent 安全建構，不用 innerHTML（title/body 來自 POST，屬不可信內容）
      const card = document.createElement('div')
      card.className = 'card'

      const title = document.createElement('div')
      title.className = 'card-title'
      title.textContent = `${ICON[e.type]} ${e.title || e.source.name || e.source.kind}`
      card.appendChild(title)

      if (e.body) {
        const body = document.createElement('div')
        body.className = 'card-body'
        body.textContent = e.body
        card.appendChild(body)
      }
      return card
    }),
  )
}

function render(now: number): void {
  const view = pet.advance(now)
  const anim = SPRITE_FORMAT.animations[view.animation as AnimationName]
  const frameIndex = Math.floor((now / 1000) * anim.fps) % anim.frames
  const rect = frameRect(anim.row, frameIndex)
  petEl.style.backgroundPosition = `-${rect.x * DISPLAY_SCALE}px -${rect.y * DISPLAY_SCALE}px`
  renderCards()
  requestAnimationFrame(render)
}
requestAnimationFrame(render)
```

> 註：renderer 內統一用 `performance.now()` 當時鐘，故事件 timestamp 在進佇列時改寫為 `performance.now()`，與 PetController/NotificationQueue 的 now 對齊。

新增卡片樣式，append 到 `src/renderer/styles.css`：
```css
.card {
  background: #fff; color: #222; border-radius: 10px; padding: 6px 9px;
  font: 11px sans-serif; max-width: 160px; box-shadow: 0 3px 10px rgba(0,0,0,.3);
}
.card-title { font-weight: 700; }
.card-body { opacity: .75; margin-top: 2px; }
```

- [ ] **Step 4: 型別檢查**

Run: `npm run typecheck`
Expected: 通過。

- [ ] **Step 5: 整合手動驗收（Claude 執行）**

Run（啟動 App 後用 curl 模擬事件）：
```bash
npm run build && timeout 25 npx electron . >/tmp/deskpet-run.log 2>&1 &
sleep 8
# 讀 endpoint.json（路徑為 Electron userData；macOS 預設）
EP="$HOME/Library/Application Support/desktop-notify/endpoint.json"
cat "$EP"
PORT=$(jq -r .port "$EP"); TOKEN=$(jq -r .token "$EP")
curl -s -X POST "http://127.0.0.1:$PORT/notify" -H "X-Token: $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"type":"done","title":"Claude Code","body":"任務完成","source":"claude-code"}'
sleep 3
tail -20 /tmp/deskpet-run.log
```
Expected: curl 回 `{"ok":true,...}`；畫面上 **may 播 jumping 慶祝動畫＋出現「✅ 任務完成」卡片**，幾秒後卡片淡出。

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/preload src/renderer
git commit -m "feat(shell): 串接 ingest → IPC → 寵物反應與卡片" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7：點擊穿透（hover 命中才可互動）

**Files:**
- Modify: `src/main/window.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/api.d.ts`
- Modify: `src/renderer/main.ts`

對應 spec §13（點擊穿透 + hover 命中判定）。

- [ ] **Step 1: 視窗預設忽略滑鼠，提供切換 IPC**

Modify `src/main/window.ts` — 在 `createPetWindow` 內、`return win` 前加入預設點擊穿透，並掛上切換處理：
```ts
  win.setIgnoreMouseEvents(true, { forward: true })

  // 由 renderer 依 hover 命中區切換可互動
  const { ipcMain } = await import('electron')
  ipcMain.on('set-interactive', (_e, interactive: boolean) => {
    if (!win.isDestroyed()) win.setIgnoreMouseEvents(!interactive, { forward: true })
  })
```
> 因為用到 `await import`，請把 `createPetWindow` 改為 `async function createPetWindow(): Promise<BrowserWindow>`，並在 `index.ts` 改為 `const win = await createPetWindow()`（兩處 activate 內的呼叫加 `void createPetWindow()`）。或改為在檔案頂端 `import { BrowserWindow, screen, ipcMain } from 'electron'` 後同步註冊一次（推薦：用頂端 import，避免 async 擴散）。

採用「頂端 import 同步註冊」版本 — Modify `src/main/window.ts` 開頭 import 與註冊：
```ts
import { BrowserWindow, screen, ipcMain } from 'electron'
import { join } from 'node:path'

let interactiveHandlerRegistered = false
```
並在 `createPetWindow` 內 `return win` 前：
```ts
  win.setIgnoreMouseEvents(true, { forward: true })
  if (!interactiveHandlerRegistered) {
    interactiveHandlerRegistered = true
    ipcMain.on('set-interactive', (_e, interactive: boolean) => {
      for (const w of BrowserWindow.getAllWindows()) w.setIgnoreMouseEvents(!interactive, { forward: true })
    })
  }
```

- [ ] **Step 2: preload 暴露 setInteractive**

Modify `src/preload/index.ts` — 在 exposeInMainWorld 物件加入：
```ts
  setInteractive: (interactive: boolean) => ipcRenderer.send('set-interactive', interactive),
```

Modify `src/preload/api.d.ts` — 在 petBridge 型別加入：
```ts
      setInteractive: (interactive: boolean) => void
```

- [ ] **Step 3: renderer 依 hover 寵物/卡片切換可互動**

Modify `src/renderer/main.ts` — 在檔案結尾（requestAnimationFrame(render) 後）加入：
```ts
function bindHover(el: HTMLElement): void {
  el.addEventListener('mouseenter', () => window.petBridge.setInteractive(true))
  el.addEventListener('mouseleave', () => window.petBridge.setInteractive(false))
}
bindHover(petEl)
bindHover(cardsEl)
```

- [ ] **Step 4: 型別檢查**

Run: `npm run typecheck`
Expected: 通過。

- [ ] **Step 5: 手動驗收（Claude 執行）**

Run:
```bash
npm run build && timeout 18 npx electron . >/tmp/deskpet-run.log 2>&1 &
sleep 8
tail -20 /tmp/deskpet-run.log
```
Expected：寵物以外的桌面區域可正常點到後方視窗（點擊穿透）；滑鼠移到寵物上時該區變為可互動。log 無錯誤。
> headless 環境無法目視點擊穿透，至少確認啟動無 crash、`set-interactive` 無錯誤。

- [ ] **Step 6: Commit**

```bash
git add src/main/window.ts src/preload src/renderer/main.ts
git commit -m "feat(shell): 點擊穿透與 hover 命中切換" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8：Phase 2 收尾驗證

**Files:** 無（驗證）

- [ ] **Step 1: 單元測試全綠**

Run: `npm test`
Expected: core（28）+ main（endpoint + ingest）全部通過，0 failed。

- [ ] **Step 2: 型別檢查**

Run: `npm run typecheck`
Expected: 兩個 tsconfig 皆 exit 0。

- [ ] **Step 3: build 成功**

Run: `npm run build`
Expected: 產出 out/main、out/preload、out/renderer，無錯誤。

- [ ] **Step 4: 端到端手動驗收（Claude 執行）**

Run（同 Task 6 的 curl 流程，逐一試 done / attention / error）：
```bash
npm run build && timeout 30 npx electron . >/tmp/deskpet-run.log 2>&1 &
sleep 8
EP="$HOME/Library/Application Support/desktop-notify/endpoint.json"
PORT=$(jq -r .port "$EP"); TOKEN=$(jq -r .token "$EP")
for t in done attention error; do
  curl -s -X POST "http://127.0.0.1:$PORT/notify" -H "X-Token: $TOKEN" \
    -H 'content-type: application/json' \
    -d "{\"type\":\"$t\",\"title\":\"Claude Code\",\"body\":\"測試 $t\",\"source\":\"claude-code\"}"
  echo; sleep 2
done
tail -30 /tmp/deskpet-run.log
```
Expected: 三次皆回 `{"ok":true}`；寵物依序播 jumping / waving / failed，並出現對應卡片。

- [ ] **Step 5: 確認工作樹乾淨**

Run: `git status --short`
Expected: 空。

---

## 驗收標準（Phase 2 完成定義）

- `npm test` 全綠（core + main 單元測試）。
- `npm run typecheck`（node + web 兩設定）通過。
- `npm run build` 成功。
- 手動端到端：App 開機常駐右下角、may 待機；`curl` POST /notify（帶正確 token）→ 寵物播對應反應動畫 + 卡片，5 秒後淡出；錯誤 token 回 401、壞 JSON 回 400。
- 點擊穿透：寵物以外區域可點到後方。
- 已涵蓋 spec：§4 資料流、§6 正規化（沿用 core）、§7 連接埠/安全、§11 反應、§12 卡片、§13 視窗。

## 待後續（Phase 2b / Phase 3）

- 選單列托盤（顯示/隱藏、切換寵物、開機自啟、結束）。
- 完整 pet registry：掃描 `userData/pets` + 內建，驗證尺寸（用 image-size 讀 webp 尺寸），UI 切換。
- 開機自啟（app.setLoginItemSettings）、音效、視窗拖動與多螢幕位置記憶。
- Hook Kit（Phase 3）：notify 腳本讀 endpoint.json、Claude Code hooks 安裝說明。
- 視窗高度/卡片區與寵物實際像素的精修。
