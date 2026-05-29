# 即時卡片獨立視窗（Spec ⑦）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把即時卡片從寵物視窗的 DOM 抽成獨立浮動小視窗、寵物視窗縮成 sprite 大小（收尾 issue #1 貼頂問題），並新增「有卡片暫停自走、走動中 hover/click 立即中斷」。

**Architecture:** pet renderer 仍是大腦（持有 currentEvent / replay / 徽章 / 互動），但不再用 DOM 畫卡片，改發 `show-card`/`hide-card` IPC；main 持有獨立 card BrowserWindow 生命週期與定位（純函式 `cardPosition` 算上方/下方）；card renderer 純顯示。卡片 IPC 帶事件 id 防舊卡片誤標已讀；main 集中 `repositionCard()` 讓卡片跟著寵物所有位移。

**Tech Stack:** Electron + electron-vite（main/preload/renderer 三層）、TypeScript、typed IPC contract（`src/ipc`）、Vitest（純函式 TDD）、自訂 `pet://` protocol。

**依據 spec：** `docs/superpowers/specs/2026-05-29-card-window-design.md`

**與 spec 的一處刻意偏離：** spec §5.3 把 `CardView` 型別放 `contract.ts`。實作改放 `src/core/card-view.ts`（純型別、僅依賴 `core/events` 的 `NotifyType`）。原因：card renderer 在 **web** tsconfig（`tsconfig.web.json`，僅含 `src/renderer`+`src/core`）下編譯；若 `CardView` 在 `contract.ts`，card renderer `import` 會把 `contract.ts`→`../main/prefs`（Node 模組）拉進 web 編譯而 typecheck 失敗。放 core 可同時被 contract / preload / 兩個 renderer 引用且平台中立。

**尺寸常數（全程一致）：**
- 寵物視窗：`PET_WIDTH = 135`、`PET_HEIGHT = 146`（= `ceil(192×0.7)`×`ceil(208×0.7)`，sprite 顯示尺寸）
- 卡片視窗：`CARD_W = 264`、`CARD_H = 112`、`CARD_GAP = 8`（含透明邊距給 CSS 陰影；最終值在 Task 9 視覺微調）

---

## File Structure

**新增**
- `src/core/card-view.ts` — `CardView` 純型別（id/type/label/body/source）
- `src/core/card-position.ts` — 純函式 `cardPosition()`：依寵物 bounds 算卡片左上座標（上方優先、不足翻下方、右對齊、夾 workArea）
- `tests/core/card-position.test.ts` — 上述純函式測試
- `src/main/card-window.ts` — 建立/設定 card BrowserWindow，匯出 `CARD_W`/`CARD_H`/`CARD_GAP`
- `src/preload/card.ts` — 窄版 bridge（`cardBridge`：`onCardData`/`cardClicked`），不暴露 petBridge
- `src/renderer/card.html` / `src/renderer/card.ts` / `src/renderer/card.css` — 卡片純顯示 UI

**修改**
- `src/ipc/contract.ts` — 新增 `show-card`/`hide-card`/`card-clicked`/`card-data`/`card-dismissed` 五個 channel
- `src/preload/index.ts` + `src/preload/api.d.ts` — pet bridge 新增 `showCard`/`hideCard`/`onCardDismissed`；宣告 `cardBridge`
- `src/main/index.ts` — card window 生命週期、handlers、`repositionCard()`、`activeCardId` 防呆、`display-metrics-changed`
- `src/main/window.ts` — PET 尺寸 135×146；`drag-move`/`display-removed` 後 `bus.emit('pet-moved')`
- `src/renderer/main.ts` — 移除 DOM 卡片，改 IPC；走動 gate `!currentEvent`；hover 走動中 `walkCancel`；`onCardDismissed`
- `src/renderer/index.html` — 移除 `#cards`
- `src/renderer/styles.css` — 移除 `#cards`/`.card*`/`cardIn`；`#pet` 齊頂、`#badge` 右上角
- `electron.vite.config.ts` — renderer 加 `card` 入口、preload 加 `card` 入口

---

## Task 1: 純函式 `cardPosition`（TDD）

> 此任務為純函式，可切 git worktree 併行、派 codex 以 TDD 實作、Claude review（見專案分工記憶）。worktree 內若遇 symlinked node_modules EPERM，測試用 `npx vitest run --configLoader runner tests/core/card-position.test.ts`。

**Files:**
- Create: `src/core/card-position.ts`
- Test: `tests/core/card-position.test.ts`

- [ ] **Step 1: 寫失敗測試**

`tests/core/card-position.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { cardPosition, type Rect } from '../../src/core/card-position'

const wa: Rect = { x: 0, y: 0, width: 1440, height: 900 }
const card = { width: 264, height: 112 }
const gap = 8

describe('cardPosition', () => {
  it('上方有空間 → 浮上方、右對齊寵物', () => {
    const pet: Rect = { x: 1136, y: 560, width: 135, height: 146 }
    // x = 1136 + 135 - 264 = 1007；y = 560 - 112 - 8 = 440
    expect(cardPosition(pet, card, wa, gap)).toEqual({ x: 1007, y: 440 })
  })

  it('寵物貼頂、上方不足 → 翻到下方', () => {
    const pet: Rect = { x: 1136, y: 0, width: 135, height: 146 }
    // y(上) = 0 - 112 - 8 = -120 < workArea.y(0) → 下方 = 0 + 146 + 8 = 154
    expect(cardPosition(pet, card, wa, gap)).toEqual({ x: 1007, y: 154 })
  })

  it('寵物貼左邊 → 卡片左緣夾回 workArea.x', () => {
    const pet: Rect = { x: 0, y: 560, width: 135, height: 146 }
    // x = 0 + 135 - 264 = -129 → 夾到 0
    expect(cardPosition(pet, card, wa, gap)).toEqual({ x: 0, y: 440 })
  })

  it('負原點外接螢幕（左側）座標正確', () => {
    const waNeg: Rect = { x: -1920, y: 0, width: 1920, height: 1080 }
    const pet: Rect = { x: -800, y: 560, width: 135, height: 146 }
    // x = -800 + 135 - 264 = -929（在 [-1920, -264] 內）；y = 560 - 112 - 8 = 440
    expect(cardPosition(pet, card, waNeg, gap)).toEqual({ x: -929, y: 440 })
  })

  it('寵物貼右邊 → 卡片右緣不超出 workArea', () => {
    const pet: Rect = { x: 1305, y: 560, width: 135, height: 146 } // 1305+135=1440 貼右
    // x = 1305 + 135 - 264 = 1176；上限 = 1440 - 264 = 1176 → 1176
    expect(cardPosition(pet, card, wa, gap)).toEqual({ x: 1176, y: 440 })
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/core/card-position.test.ts`
Expected: FAIL — `cardPosition` 不存在 / 找不到模組。

- [ ] **Step 3: 實作最小程式**

`src/core/card-position.ts`：

```ts
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * 依寵物視窗 bounds 算卡片視窗左上座標。
 * - 右對齊寵物（卡片右緣對齊寵物右緣），水平夾進 workArea。
 * - 預設浮在寵物上方；上方空間不足（超出 workArea 頂）則翻到下方。
 */
export function cardPosition(
  pet: Rect,
  card: { width: number; height: number },
  workArea: Rect,
  gap: number,
): { x: number; y: number } {
  const rawX = pet.x + pet.width - card.width
  const x = clamp(rawX, workArea.x, workArea.x + workArea.width - card.width)

  const aboveY = pet.y - card.height - gap
  const y = aboveY >= workArea.y ? aboveY : pet.y + pet.height + gap

  return { x, y }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/core/card-position.test.ts`
Expected: PASS（5 個案例全綠）。

- [ ] **Step 5: commit**

```bash
git add src/core/card-position.ts tests/core/card-position.test.ts
git commit -m "feat(core): cardPosition 純函式（上方/下方 flip + 右對齊 + 夾邊）"
```

---

## Task 2: `CardView` 型別 + IPC contract 五個 channel

**Files:**
- Create: `src/core/card-view.ts`
- Modify: `src/ipc/contract.ts`

- [ ] **Step 1: 建 `CardView` 型別**

`src/core/card-view.ts`：

```ts
import type { NotifyType } from './events'

/** 卡片視窗顯示用的精簡資料（pet renderer 組好 → main → card renderer 純顯示）。 */
export interface CardView {
  id: string
  type: NotifyType
  /** 狀態標籤，如「完成」「錯誤」（由 type 對應，pet renderer 算好）。 */
  label: string
  /** 內文，已 stripMarkdown；無內文則為空字串。 */
  body: string
  /** 來源 + session 短碼組合字串；無則為空字串。 */
  source: string
}
```

- [ ] **Step 2: contract 加入 channel**

`src/ipc/contract.ts`：頂部 import 區加一行（放在既有 import 之後）：

```ts
import type { CardView } from '../core/card-view'
```

在 `Commands` 介面尾端（`'open-pets-folder': void` 之後）加：

```ts
  'show-card': CardView
  'hide-card': void
  'card-clicked': { id: string }
```

在 `Pushes` 介面尾端（`'messages-updated': StoredMessage[]` 之後）加：

```ts
  'card-data': CardView
  'card-dismissed': { id: string }
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: PASS（新型別未被使用，但 contract 本身須能編譯通過）。

- [ ] **Step 4: commit**

```bash
git add src/core/card-view.ts src/ipc/contract.ts
git commit -m "feat(ipc): CardView 型別 + show-card/hide-card/card-clicked/card-data/card-dismissed channel"
```

---

## Task 3: preload — pet bridge 新增 + 窄版 card preload

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/api.d.ts`
- Create: `src/preload/card.ts`

- [ ] **Step 1: pet bridge 暴露卡片 API**

`src/preload/index.ts`：頂部 import 區加：

```ts
import type { CardView } from '../core/card-view'
```

在 `exposeInMainWorld('petBridge', { ... })` 物件內，於 `onMessagesUpdated` 那行之後加三個方法：

```ts
  showCard: (view: CardView) => sendCommand('show-card', view),
  hideCard: () => sendCommand('hide-card'),
  onCardDismissed: (cb: (p: { id: string }) => void) => subscribePush('card-dismissed', cb),
```

- [ ] **Step 2: 建窄版 card preload**

`src/preload/card.ts`：

```ts
import { contextBridge } from 'electron'
import type { CardView } from '../core/card-view'
import { sendCommand, subscribePush } from '../ipc/preload-helpers'

// 卡片視窗專用、最小權限 bridge：只收卡片資料、只回報點擊。不暴露 walk/prefs/skin 等。
contextBridge.exposeInMainWorld('cardBridge', {
  onCardData: (cb: (view: CardView) => void) => subscribePush('card-data', cb),
  cardClicked: (id: string) => sendCommand('card-clicked', { id }),
})
```

- [ ] **Step 3: 補型別宣告**

`src/preload/api.d.ts`：頂部 import 區加：

```ts
import type { CardView } from '../core/card-view'
```

在 `petBridge` 物件型別內，`onMessagesUpdated` 那行之後加：

```ts
      showCard: (view: CardView) => void
      hideCard: () => void
      onCardDismissed: (cb: (p: { id: string }) => void) => void
```

在 `interface Window { ... }` 內、`petBridge: {...}` 之後加 `cardBridge`：

```ts
    cardBridge: {
      onCardData: (cb: (view: CardView) => void) => void
      cardClicked: (id: string) => void
    }
```

- [ ] **Step 4: typecheck**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: commit**

```bash
git add src/preload/index.ts src/preload/api.d.ts src/preload/card.ts
git commit -m "feat(preload): pet bridge showCard/hideCard/onCardDismissed + 窄版 cardBridge"
```

---

## Task 4: 卡片 renderer（html/ts/css）+ vite 入口

**Files:**
- Create: `src/renderer/card.html`
- Create: `src/renderer/card.ts`
- Create: `src/renderer/card.css`
- Modify: `electron.vite.config.ts`

- [ ] **Step 1: card.html**

`src/renderer/card.html`：

```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'" />
    <title>card</title>
    <link rel="stylesheet" href="./card.css" />
  </head>
  <body>
    <div id="card"></div>
    <script type="module" src="./card.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: card.ts（純顯示 + 點擊回報）**

`src/renderer/card.ts`：

```ts
/// <reference path="../preload/api.d.ts" />

import type { CardView } from '../core/card-view'

const root = document.querySelector<HTMLDivElement>('#card')!
let currentId: string | null = null

function render(view: CardView): void {
  currentId = view.id
  root.dataset.type = view.type // CSS 依此上狀態色
  root.replaceChildren()

  const label = document.createElement('div')
  label.className = 'card-label'
  label.textContent = view.label
  root.appendChild(label)

  if (view.body) {
    const body = document.createElement('div')
    body.className = 'card-body'
    body.textContent = view.body
    root.appendChild(body)
  }

  if (view.source) {
    const source = document.createElement('div')
    source.className = 'card-source'
    source.textContent = view.source
    root.appendChild(source)
  }
}

window.cardBridge.onCardData(render)

root.title = '點一下關閉'
root.addEventListener('click', () => {
  if (currentId) window.cardBridge.cardClicked(currentId)
})
```

- [ ] **Step 3: card.css（由 styles.css 的 .card 樣式搬來、改填滿視窗）**

`src/renderer/card.css`：

```css
html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
/* body 留透明邊距讓 box-shadow 不被視窗邊界裁掉 */
body { padding: 14px; box-sizing: border-box; height: 100vh; }

#card {
  --accent: #8a8175;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 8px 14px 9px 13px;
  border-left: 4px solid var(--accent);
  border-radius: 5px 14px 14px 5px;
  background: #fffdf8;
  color: #2a2622;
  font-family: ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif;
  box-shadow: 0 3px 12px rgba(46, 33, 18, .24);
  cursor: pointer;
  overflow: hidden;
  animation: cardIn .26s cubic-bezier(.2, .9, .3, 1.25) both;
}
#card[data-type="done"]      { --accent: #2e9e6b; }
#card[data-type="attention"] { --accent: #e08a2b; }
#card[data-type="error"]     { --accent: #d6453d; }
#card[data-type="review"]    { --accent: #5b6ee0; }
#card[data-type="working"]   { --accent: #2e9e9e; }
#card[data-type="info"]      { --accent: #8a8175; }

.card-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .09em;
  color: var(--accent);
}
.card-body {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.36;
  margin-top: 2px;
  color: #2a2622;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-source {
  font-size: 10.5px;
  letter-spacing: .02em;
  color: #ad9f8c;
  margin-top: 3px;
}

@keyframes cardIn {
  from { opacity: 0; transform: translateY(7px) scale(.95); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
```

- [ ] **Step 4: vite 加入 card renderer + card preload 入口**

`electron.vite.config.ts`：

`preload.build.rollupOptions.input` 由：

```ts
        input: { index: 'src/preload/index.ts' },
```

改成：

```ts
        input: { index: 'src/preload/index.ts', card: 'src/preload/card.ts' },
```

`renderer.build.rollupOptions.input` 的物件加一行 `card`：

```ts
        input: {
          index: 'src/renderer/index.html',
          center: 'src/renderer/center.html',
          settings: 'src/renderer/settings.html',
          skins: 'src/renderer/skins.html',
          card: 'src/renderer/card.html',
        },
```

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: PASS（card.ts 引用 `window.cardBridge`，由 api.d.ts 宣告）。

- [ ] **Step 6: commit**

```bash
git add src/renderer/card.html src/renderer/card.ts src/renderer/card.css electron.vite.config.ts
git commit -m "feat(renderer): 卡片視窗 UI（card.html/ts/css）+ vite card 入口"
```

---

## Task 5: `card-window.ts`

**Files:**
- Create: `src/main/card-window.ts`

- [ ] **Step 1: 建立 card window 工廠**

`src/main/card-window.ts`（參考 `center-window.ts`，但用 card preload、不綁 blur 關閉、預設隱藏）：

```ts
import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

// 卡片視窗尺寸（含透明邊距給 CSS 陰影；定位以視窗 bounds 計）
export const CARD_W = 264
export const CARD_H = 112
export const CARD_GAP = 8

export function createCardWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { x, y } = primary.workArea

  const win = new BrowserWindow({
    width: CARD_W,
    height: CARD_H,
    x, // 佔位座標，實際位置由 main 的 repositionCard() 設定
    y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/card.cjs'),
    },
  })

  win.setAlwaysOnTop(true, 'floating')
  // 跨 Spaces / 全螢幕，建立時設一次（避免反覆呼叫造成 process-type 閃爍）
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/card.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/card.html'))
  }

  return win
}
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: commit**

```bash
git add src/main/card-window.ts
git commit -m "feat(main): card-window.ts 工廠（隱藏建立、card preload、跨 Spaces）"
```

---

## Task 6: main/index.ts — 卡片視窗生命週期、定位、id 防呆

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: import 與狀態**

`src/main/index.ts`：

頂部 `from 'electron'` 改為同時引入 `screen`：

```ts
import { app, BrowserWindow, screen } from 'electron'
```

新增 import：

```ts
import { createCardWindow, CARD_W, CARD_H, CARD_GAP } from './card-window'
import { cardPosition } from '../core/card-position'
import type { CardView } from '../core/card-view'
```

在既有 `let skinWindow ...` 等狀態宣告附近加：

```ts
let cardWindow: BrowserWindow | null = null
let cardLoaded = false
let pendingCard: CardView | null = null
let activeCardId: string | null = null
```

- [ ] **Step 2: 卡片視窗 helper（lazy 建立、定位、顯示）**

在 `openCenter()` 函式之後加入：

```ts
function ensureCardWindow(): BrowserWindow {
  if (cardWindow && !cardWindow.isDestroyed()) return cardWindow
  cardLoaded = false
  cardWindow = createCardWindow()
  cardWindow.webContents.once('did-finish-load', () => {
    cardLoaded = true
    flushCard()
  })
  cardWindow.on('closed', () => {
    cardWindow = null
    cardLoaded = false
  })
  return cardWindow
}

// 若卡片可見，依寵物 bounds 重新定位卡片並置頂（兩窗同為 floating，需 moveTop 保證在寵物上）
function repositionCard(): void {
  if (!cardWindow || cardWindow.isDestroyed() || !cardWindow.isVisible()) return
  if (!petWindow || petWindow.isDestroyed()) return
  const pet = petWindow.getBounds()
  const display = screen.getDisplayMatching(pet)
  const pos = cardPosition(pet, { width: CARD_W, height: CARD_H }, display.workArea, CARD_GAP)
  cardWindow.setPosition(pos.x, pos.y)
  cardWindow.moveTop()
}

function flushCard(): void {
  if (!pendingCard || !cardWindow || cardWindow.isDestroyed()) return
  pushTo(cardWindow, 'card-data', pendingCard)
  cardWindow.showInactive() // 顯示但不搶焦點
  repositionCard()
  pendingCard = null
}
```

- [ ] **Step 3: 註冊 show-card / hide-card / card-clicked handlers**

在 `app.whenReady().then(...)` 內、`handleQuery('get-messages', ...)` 之後加入：

```ts
  handleCommand('show-card', (view) => {
    activeCardId = view.id
    pendingCard = view
    ensureCardWindow()
    if (cardLoaded) flushCard()
    // 未載入完成則由 did-finish-load → flushCard 處理
  })
  handleCommand('hide-card', () => {
    activeCardId = null
    pendingCard = null
    if (cardWindow && !cardWindow.isDestroyed()) cardWindow.hide()
  })
  handleCommand('card-clicked', ({ id }) => {
    if (id !== activeCardId) return // 舊卡片殘留點擊：忽略
    activeCardId = null
    if (cardWindow && !cardWindow.isDestroyed()) cardWindow.hide()
    pushTo(petWindow, 'card-dismissed', { id })
  })
```

- [ ] **Step 4: 訂閱寵物位移以同步卡片**

在 `bus.on('open-center', openCenter)` 附近加入：

```ts
  bus.on('pet-moved', repositionCard) // 拖動 / display-removed 重吸附後同步卡片
  screen.on('display-metrics-changed', repositionCard) // 解析度 / 排列變更
```

- [ ] **Step 5: 關閉寵物時一併關卡片**

在 `petWindow = createPetWindow()` 之後加入：

```ts
  petWindow.on('closed', () => {
    if (cardWindow && !cardWindow.isDestroyed()) cardWindow.close()
  })
```

- [ ] **Step 6: typecheck**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 7: commit**

```bash
git add src/main/index.ts
git commit -m "feat(main): card window 生命週期 + repositionCard + activeCardId id 防呆 + display-metrics 同步"
```

---

## Task 7: window.ts — 寵物視窗縮小 + 發 pet-moved

**Files:**
- Modify: `src/main/window.ts`

- [ ] **Step 1: 改尺寸常數**

`src/main/window.ts`：

```ts
const PET_WIDTH = 135
const PET_HEIGHT = 146
```

（原 `const PET_WIDTH = 280` / `const PET_HEIGHT = 300`；`MARGIN = 24` 不變。）

- [ ] **Step 2: drag-move 後發 pet-moved**

`handleCommand('drag-move', ...)` 內，`petWinRef.setPosition(nx, ny)` 之後加一行；同時移除已過時的「寵物視窗比 sprite 大」註解。改為：

```ts
    handleCommand('drag-move', () => {
      if (!petWinRef || petWinRef.isDestroyed() || !dragGrabOffset) return
      const cursor = screen.getCursorScreenPoint()
      const nx = Math.round(cursor.x - dragGrabOffset.x)
      const ny = Math.round(cursor.y - dragGrabOffset.y)
      petWinRef.setPosition(nx, ny)
      bus.emit('pet-moved') // 同步卡片視窗（index.ts 監聽）
    })
```

- [ ] **Step 3: display-removed 重吸附後發 pet-moved**

`screen.on('display-removed', ...)` 內，`petWinRef.setPosition(pos.x, pos.y)` 之後加：

```ts
        petWinRef.setPosition(pos.x, pos.y)
        bus.emit('pet-moved')
```

- [ ] **Step 4: typecheck**

Run: `npm run typecheck`
Expected: PASS（`bus` 已 import）。

- [ ] **Step 5: commit**

```bash
git add src/main/window.ts
git commit -m "feat(main): 寵物視窗縮 135×146（收尾 #1）+ 位移時發 pet-moved 同步卡片"
```

---

## Task 8: 寵物 renderer — 移除 DOM 卡片、改 IPC、走動暫停/中斷

**Files:**
- Modify: `src/renderer/main.ts`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: index.html 移除 #cards**

`src/renderer/index.html`：刪掉這一行：

```html
    <div id="cards"></div>
```

（保留 `#pet` 與 `#badge`。）

- [ ] **Step 2: styles.css — #pet 齊頂、#badge 右上、移除卡片樣式**

`src/renderer/styles.css`：

`#pet` 區塊的 `right: 8px; bottom: 8px;` 改為齊頂齊右（sprite 頂端＝視窗頂端，往上拖即可貼選單列）：

```css
#pet {
  position: absolute;
  top: 0;
  right: 0;
  image-rendering: pixelated;
  background-repeat: no-repeat;
}
```

刪除整個 `#cards { ... }` 區塊、所有 `.card`/`.card[data-type=...]`/`.card-label`/`.card-body`/`.card-source` 區塊、以及 `@keyframes cardIn`（已搬到 `card.css`）。

`#badge` 區塊的定位由 `right: 10px; bottom: 164px;`（原本在 sprite 上方死空間）改到 sprite 右上角：

```css
#badge {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #d6453d;
  box-shadow: 0 2px 5px rgba(0, 0, 0, .35);
  cursor: pointer;
  transition: transform .12s ease;
}
```

（`#badge:hover` / `#badge:active` / `#badge[hidden]` 三行不變。）

- [ ] **Step 3: main.ts — 移除 cardsEl、renderCard 改 buildCardView + IPC**

`src/renderer/main.ts`：

(a) 頂部加 import：

```ts
import type { CardView } from '../core/card-view'
```

(b) 刪除取得 `cardsEl` 的那行：

```ts
const cardsEl = document.querySelector<HTMLDivElement>('#cards')!
```

(c) 把 `renderCard()` 整個函式（約 132–175 行）替換成 `buildCardView()`：

```ts
function buildCardView(e: AppEvent): CardView {
  const sourceText = e.title || e.source.name || e.source.kind
  const sessionTag =
    e.sessionId && e.sessionId !== 'default' ? `#${e.sessionId.slice(0, 6)}` : ''
  const source = [sourceText, sessionTag].filter(Boolean).join(' · ')
  return {
    id: e.id,
    type: e.type,
    label: LABEL[e.type],
    body: e.body ? stripMarkdown(e.body) : '',
    source,
  }
}
```

(d) `onPetEvent` callback 內把 `renderCard()` 改成送卡片 IPC：

```ts
window.petBridge?.onPetEvent?.((event: AppEvent) => {
  applyEvent(event)
  currentEvent = event
  window.petBridge.showCard(buildCardView(event))
  startReplay(event)
  refreshBadge()
  dispatch({ kind: 'externalEvent' })
})
```

(e) `onDndOn` callback 內把 `renderCard()` 改成 `hideCard()`：

```ts
window.petBridge?.onDndOn?.(() => {
  currentEvent = null
  stopReplay()
  window.petBridge.hideCard()
  refreshBadge()
})
```

(f) 在 `onDndOn` 之後新增 `onCardDismissed`（卡片被點 → main 已關窗 → 這裡只清狀態，id 比對防舊卡片誤清）：

```ts
window.petBridge?.onCardDismissed?.(({ id }) => {
  if (!currentEvent || currentEvent.id !== id) return
  window.petBridge.markRead(id)
  currentEvent = null
  stopReplay()
  refreshBadge()
})
```

- [ ] **Step 4: main.ts — 走動 gate 加 `!currentEvent`**

`tick()` 內自走觸發的 `if (shouldWalkNow({...}))` 改為同時要求「無卡片」：

```ts
  if (
    !currentEvent &&
    shouldWalkNow({ autoWalkEnabled, walking, animation: view.animation, hidden: document.hidden, now, nextWalkAt })
  ) {
    const w = pickWalk(Math.random, now, walkBounds)
    nextWalkAt = w.nextWalkAt
    walking = true
    walkDirection = w.direction
    window.petBridge.walkStart({ direction: w.direction, distance: w.distance, duration: w.duration })
  }
```

- [ ] **Step 5: main.ts — hover 走動中立即中斷；移除 cardsEl 的 hover 綁定**

`bindHover()` 內：`petEl` 的 `mouseenter` 加上走動中斷；刪掉 `cardsEl` 兩行（卡片已不在本視窗）。改為：

```ts
function bindHover(): void {
  const enableInteractive = () => window.petBridge.setInteractive(true)
  const disableInteractive = () => window.petBridge.setInteractive(false)
  const badge = document.querySelector<HTMLDivElement>('#badge')!

  petEl.addEventListener('mouseenter', () => {
    enableInteractive()
    if (walking) window.petBridge.walkCancel() // 走動中被 hover → 立即停
    dispatch({ kind: 'hover' }) // 拖動中／反應中 reducer 自會略過
  })
  petEl.addEventListener('mouseleave', disableInteractive)
  badge.addEventListener('mouseenter', enableInteractive)
  badge.addEventListener('mouseleave', disableInteractive)
}
```

- [ ] **Step 6: typecheck**

Run: `npm run typecheck`
Expected: PASS（無殘留 `cardsEl` / `renderCard` 參照）。

- [ ] **Step 7: commit**

```bash
git add src/renderer/main.ts src/renderer/index.html src/renderer/styles.css
git commit -m "feat(renderer): 卡片改走 show-card/hide-card IPC；走動暫停(!currentEvent)+hover 中斷；#pet 齊頂 #badge 右上"
```

---

## Task 9: 整合驗證 + 手動驗收（含 #1 收尾）

**Files:**（不改碼，必要時微調 `card.css` / `card-window.ts` 尺寸）

- [ ] **Step 1: 全量 typecheck + 單元測試**

Run: `npm run typecheck && npm test`
Expected: PASS（含 Task 1 `card-position` 與既有測試全綠）。

- [ ] **Step 2: e2e smoke（pet:// 與基本鏈路不壞）**

Run: `npm run e2e`
Expected: 結束碼 0、無未捕捉例外。

- [ ] **Step 3: build 確認多入口產出**

Run: `npm run build`
Expected: 成功；`out/preload/` 含 `index.cjs` 與 `card.cjs`；`out/renderer/` 含 `card.html`。

- [ ] **Step 4: 手動驗收（`npm run dev`，逐項對照 spec §8）**

依序確認（必要時用 e2e 截圖輔助；Claude 透過截圖檢視畫面）：

1. 發 notify（curl POST /notify 各 type）→ 卡片浮在寵物上方、label/body/source 正確、狀態色正確。
2. 拖動寵物（卡片開著）→ 卡片跟著移動；寵物拖到該螢幕最上方 → 卡片自動翻到下方。
3. 點卡片 → 卡片關閉、徽章更新、通知中心該則標為已讀。
4. 有卡片時 → 寵物不自走（等過自走間隔仍不動）。
5. 走動中 hover → 立即停走動並改播 hover 反應；走動中點擊 → 立即停。
6. DND 開 → 不顯示卡片（訊息仍進歷史、紅點仍亮）。
7. **#1 收尾：把寵物拖到主螢幕最上方 → sprite 貼到選單列下緣**；以 `getPosition().y` 確認 `≈ workArea.y`。
8. 卡片點擊不搶焦點（前景 App 不被切走）、且卡片永遠浮在寵物之上（hover/drag 不被蓋）。
9. 縮窗後 hit-test：sprite / badge / 透明邊界各測 hover / click / drag 正常（穿透與互動切換不壞）。
10. 連發兩則事件後點「舊」卡視窗位置 → 不誤標新訊息已讀（id 比對；正常情況舊卡已被新卡覆蓋，本步驗證 race 安全）。
11. 雙螢幕 / 全螢幕 App Space：pet 與 card 同時出現、對齊。

- [ ] **Step 5: 視覺微調（如需要）**

若 Step 4 發現卡片陰影被裁、尺寸不合或翻轉間距不佳，微調 `src/main/card-window.ts` 的 `CARD_W`/`CARD_H`/`CARD_GAP` 與 `src/renderer/card.css` 的 `body padding` / `box-shadow`。改完重跑 Step 1。commit：

```bash
git add src/main/card-window.ts src/renderer/card.css
git commit -m "fix(ui): 卡片視窗尺寸/陰影微調"
```

- [ ] **Step 6: 交付使用者測試後再 merge**

請使用者實機操作驗收（雙螢幕拖曳貼頂、卡片跟隨、走動中斷、DND）。使用者確認 OK 後才合併到 main、關閉 issue #1。

---

## Self-Review

**1. Spec coverage：**
- §1/§2 動機與範圍 → 全計畫；非目標（點擊看全文、走動中卡片跟隨）未實作 ✓。
- §3 架構（pet renderer 大腦 / card 純顯示 / main 定位）→ Task 6/8 ✓。
- §4 寵物縮窗 135×146 + #pet 齊頂 + #badge 右上 + 移除 #cards → Task 7/8 ✓；像素驗收 → Task 9 Step 4.7 ✓。
- §5.1 card-window（showInactive / moveTop / setVisibleOnAllWorkspaces 一次 / 窄版 preload）→ Task 5/6/3 ✓。
- §5.2 cardPosition 純函式 → Task 1 ✓。
- §5.3 五個 channel + CardView → Task 2 ✓（CardView 改放 core，已於開頭註明偏離）。
- §5.4 生命週期 + activeCardId 防呆 + repositionCard（drag-move/display-removed/display-metrics-changed）→ Task 6/7 ✓。
- §6 走動暫停 `!currentEvent` + hover/click 中斷 → Task 8 Step 4/5 ✓（click 經 pointerdown→drag-start→endWalk 既有達成，Task 9 Step 4.5 驗收）。
- §8 測試/驗收 → Task 1 + Task 9 ✓。

**2. Placeholder scan：** 無 TBD/TODO；每個改碼步驟均附完整程式或精確刪改位置。Task 9 Step 5 為條件式微調，已給具體欄位與起始值，非佔位。

**3. Type consistency：** `CardView`{id,type,label,body,source} 自 Task 2 定義後，Task 3（preload showCard/onCardData）、Task 4（card.ts render）、Task 6（show-card handler/pushTo card-data）、Task 8（buildCardView）一致使用。channel 名 `show-card`/`hide-card`/`card-clicked`/`card-data`/`card-dismissed` 與 payload（`CardView` / `void` / `{id}`）在 contract（Task 2）、preload（Task 3）、main（Task 6）、renderer（Task 8）一致。`cardPosition(pet, card, workArea, gap)` 簽名 Task 1 定義、Task 6 呼叫一致。尺寸常數 `CARD_W/CARD_H/CARD_GAP` 由 card-window.ts 匯出、index.ts 引用一致；`PET_WIDTH/PET_HEIGHT=135/146` 與 card-position 測試的 pet width 135 一致。
