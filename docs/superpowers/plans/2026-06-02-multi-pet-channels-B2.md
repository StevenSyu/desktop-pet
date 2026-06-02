# 多寵物 子專案 B2：每寵物即時卡片 + 位置記憶 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** 每隻寵物（含 channel）顯示自己的即時卡片（定位在它旁邊）；每頻道拖曳位置跨重啟記住。

**Architecture:** 把 B1 對 pet 視窗的多實例化套到 card 視窗：`cardWindows: Map<channelId, …>`、card.html 帶 `?c=`、卡片命令帶 channelId。window-state 單一 → keyed map（向後相容）。

**Tech Stack:** Electron + electron-vite、TypeScript、typed IPC、Vitest。

**依據 spec：** `docs/superpowers/specs/2026-06-02-multi-pet-channels-B2-design.md`

---

## Task 1: window-state → keyed map（TDD）

**Files:** Modify `src/main/window-state.ts`；Create/Modify `tests/main/window-state.test.ts`

- [ ] **Step 1: 失敗測試**（`tests/main/window-state.test.ts`，新增 migrate 純函式測試）

```ts
import { describe, it, expect } from 'vitest'
import { migrateWindowStates } from '../../src/main/window-state'

describe('migrateWindowStates', () => {
  it('舊單一檔 → { all: 該物件 }（向後相容）', () => {
    expect(migrateWindowStates({ displayId: 1, x: 10, y: 20 })).toEqual({ all: { displayId: 1, x: 10, y: 20 } })
  })
  it('新 keyed map → 過濾有效項', () => {
    const raw = { all: { displayId: 1, x: 1, y: 2 }, cA: { displayId: 1, x: 3, y: 4 }, bad: { x: 1 } }
    expect(migrateWindowStates(raw)).toEqual({ all: { displayId: 1, x: 1, y: 2 }, cA: { displayId: 1, x: 3, y: 4 } })
  })
  it('非物件 → {}', () => expect(migrateWindowStates(null)).toEqual({}))
})
```

- [ ] **Step 2: 跑確認 FAIL** `npx vitest run tests/main/window-state.test.ts`

- [ ] **Step 3: 改 window-state.ts**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface WindowState {
  displayId: number
  x: number
  y: number
}
export type WindowStates = Record<string, WindowState>

const FILENAME = 'window-state.json'

function isValid(value: unknown): value is WindowState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.displayId === 'number' && typeof v.x === 'number' && typeof v.y === 'number'
}

/** 舊單一檔 {displayId,x,y} → { all: 它 }；新 keyed map → 過濾有效項；其餘 → {}。 */
export function migrateWindowStates(raw: unknown): WindowStates {
  if (isValid(raw)) return { all: { displayId: raw.displayId, x: raw.x, y: raw.y } }
  if (typeof raw !== 'object' || raw === null) return {}
  const out: WindowStates = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isValid(v)) out[k] = { displayId: v.displayId, x: v.x, y: v.y }
  }
  return out
}

export function loadWindowStates(userDataDir: string): WindowStates {
  const path = join(userDataDir, FILENAME)
  if (!existsSync(path)) return {}
  try {
    return migrateWindowStates(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return {}
  }
}

export function saveWindowState(userDataDir: string, channelId: string, state: WindowState): void {
  mkdirSync(userDataDir, { recursive: true })
  const all = loadWindowStates(userDataDir)
  all[channelId] = state
  writeFileSync(join(userDataDir, FILENAME), JSON.stringify(all), 'utf8')
}
```

- [ ] **Step 4: 跑確認 PASS**；**Step 5: commit** `feat(window-state): keyed map（per-channel）+ 向後相容 migrate`

> 註：`loadWindowState`（單數）已被移除 → Task 7 改 window.ts 用 `loadWindowStates`/新 `saveWindowState(dir, channelId, state)`。

---

## Task 2: IPC contract — 卡片命令加 channelId

**Files:** Modify `src/ipc/contract.ts`

- [ ] **Step 1:** `Commands` 改：

```ts
  'show-card': { channelId: string; view: CardView }
  'hide-card': { channelId: string }
  'card-clicked': { channelId: string; id: string }
  'card-more': { channelId: string; id: string }
```

（`card-data`/`card-dismissed`/`open-detail` Pushes 不變。）

- [ ] **Step 2:** typecheck（下游未改會報錯，後續修）；**Step 3:** commit `feat(ipc): 卡片命令加 channelId`

---

## Task 3: preload + api.d.ts

**Files:** `src/preload/index.ts`、`src/preload/card.ts`、`src/preload/api.d.ts`

- [ ] **Step 1: petBridge（index.ts）** showCard/hideCard 帶 channelId：

```ts
  showCard: (channelId: string, view: CardView) => sendCommand('show-card', { channelId, view }),
  hideCard: (channelId: string) => sendCommand('hide-card', { channelId }),
```

- [ ] **Step 2: cardBridge（card.ts preload）** cardClicked/cardMore 帶 channelId：

```ts
  cardClicked: (channelId: string, id: string) => ipcRenderer.send('card-clicked', { channelId, id }),
  cardMore: (channelId: string, id: string) => ipcRenderer.send('card-more', { channelId, id }),
```

- [ ] **Step 3: api.d.ts** 同步 petBridge.showCard/hideCard + cardBridge.cardClicked/cardMore 簽名（加 channelId）。

- [ ] **Step 4:** typecheck（renderer 未改報錯，Task 4 修）；**Step 5:** commit `feat(preload): 卡片命令簽名加 channelId`

---

## Task 4: renderer — 移除卡片 gate + 帶 channelId

**Files:** `src/renderer/main.ts`、`src/renderer/card.ts`

- [ ] **Step 1: main.ts onPetEvent 移除 isAllPet gate**（所有寵物都顯示卡片）：

```ts
window.petBridge?.onPetEvent?.((event: AppEvent) => {
  applyEvent(event)
  dispatch({ kind: 'externalEvent' })
  currentEvent = event
  window.petBridge.showCard(myChannel, buildCardView(event))
  startReplay(event)
  refreshBadge()
})
```

- [ ] **Step 2: main.ts hideCard 帶 myChannel**：`onDndOn` 內 `window.petBridge.hideCard(myChannel)`。（自走 gate `isAllPet` 不變。）

- [ ] **Step 3: card.ts 讀 ?c= + 命令帶 channelId**：

頂部加 `const myChannel = new URLSearchParams(location.search).get('c') ?? 'all'`。
- close 按鈕：`window.cardBridge.cardClicked(myChannel, currentId)`
- root 點擊：`window.cardBridge.cardMore(myChannel, currentId)`

- [ ] **Step 4:** typecheck（main 仍報錯，Task 5/6 修齊）；**Step 5:** commit（連同 Task 5/6，因 main/index 互相依賴）

---

## Task 5: card-window.ts — createCardWindow(channelId)

**Files:** `src/main/card-window.ts`

- [ ] **Step 1:** 改 `createCardWindow` 帶 channelId、載入 `?c=`：

```ts
export function createCardWindow(channelId: string): BrowserWindow {
  // …（BrowserWindow 設定不變）…
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/card.html?c=${encodeURIComponent(channelId)}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/card.html'), { query: { c: channelId } })
  }
  return win
}
```

- [ ] **Step 2:** typecheck（index 未改報錯，Task 6）；commit 連同 Task 6。

---

## Task 6: index.ts — cardWindows Map（per-pet 卡片）

**Files:** `src/main/index.ts`

- [ ] **Step 1: 卡片狀態單→Map**

移除 `cardWindow`/`cardLoaded`/`pendingCard`/`activeCardId` 單一變數，改：

```ts
interface CardState { win: BrowserWindow; loaded: boolean; pending: CardView | null; activeId: string | null }
const cardWindows = new Map<string, CardState>()
```

- [ ] **Step 2: ensureCard/flushCard/repositionCard 改 per-channel**

```ts
function ensureCard(channelId: string): CardState {
  const existing = cardWindows.get(channelId)
  if (existing && !existing.win.isDestroyed()) return existing
  const win = createCardWindow(channelId)
  const cs: CardState = { win, loaded: false, pending: null, activeId: null }
  cardWindows.set(channelId, cs)
  win.webContents.once('did-finish-load', () => {
    cs.loaded = true
    flushCard(channelId)
  })
  win.on('closed', () => {
    if (cardWindows.get(channelId) === cs) cardWindows.delete(channelId)
  })
  return cs
}
function repositionCard(channelId: string): void {
  const cs = cardWindows.get(channelId)
  const pet = getPetWindow(channelId)
  if (!cs || cs.win.isDestroyed() || !cs.win.isVisible() || !pet) return
  const display = screen.getDisplayMatching(pet.getBounds())
  const pos = cardPosition(pet.getBounds(), { width: CARD_W, height: CARD_H }, display.workArea, CARD_GAP)
  cs.win.setPosition(pos.x, pos.y)
  cs.win.moveTop()
}
function flushCard(channelId: string): void {
  const cs = cardWindows.get(channelId)
  if (!cs || !cs.pending || cs.win.isDestroyed()) return
  pushTo(cs.win, 'card-data', cs.pending)
  cs.win.showInactive()
  repositionCard(channelId)
  cs.pending = null
}
```

- [ ] **Step 3: handlers per-channel**

```ts
  handleCommand('show-card', ({ channelId, view }) => {
    const cs = ensureCard(channelId)
    cs.activeId = view.id
    cs.pending = view
    if (cs.loaded) flushCard(channelId)
  })
  handleCommand('hide-card', ({ channelId }) => {
    const cs = cardWindows.get(channelId)
    if (!cs) return
    cs.activeId = null
    cs.pending = null
    if (!cs.win.isDestroyed()) cs.win.hide()
  })
  handleCommand('card-clicked', ({ channelId, id }) => {
    const cs = cardWindows.get(channelId)
    if (!cs || id !== cs.activeId) return
    cs.activeId = null
    if (!cs.win.isDestroyed()) cs.win.hide()
    pushTo(getPetWindow(channelId), 'card-dismissed', { id })
  })
  handleCommand('card-more', ({ channelId, id }) => {
    const cs = cardWindows.get(channelId)
    if (!cs || id !== cs.activeId) return
    cs.activeId = null
    if (!cs.win.isDestroyed()) cs.win.hide()
    pushTo(getPetWindow(channelId), 'card-dismissed', { id })
    pendingDetailId = id
    openCenter(channelId) // 開該頻道分頁 + 詳情
    pushTo(centerWindow, 'open-detail')
  })
```

- [ ] **Step 4: pet-moved 帶 channelId + reconcile 關卡片**

- `bus.on('pet-moved', repositionCard)` → `bus.on('pet-moved', (channelId: string) => repositionCard(channelId))`。
- `display-metrics-changed` → 重定位所有可見卡片：`screen.on('display-metrics-changed', () => { for (const id of cardWindows.keys()) repositionCard(id) })`。
- reconcilePets 關閉寵物時一併關它的卡片：在 `closePetWindow(id)` 前加 `const cs = cardWindows.get(id); if (cs && !cs.win.isDestroyed()) cs.win.close()`。
- 移除原本「`getPetWindow('all')` closed 時關 cardWindow」那段（改由 reconcile 統一處理；或保留但改成關該 pet 的卡片）。

- [ ] **Step 5: typecheck（Task 4/5/6 一起）** `npm run typecheck`；**Step 6: commit**（Task 4+5+6）`feat(multi-pet B2): per-pet 卡片視窗（cardWindows Map + ?c= + channelId 路由 + 定位各寵物旁）`

---

## Task 7: window.ts — 每頻道位置持久化

**Files:** `src/main/window.ts`

- [ ] **Step 1: import 改** `import { loadWindowStates, saveWindowState } from './window-state'`（移除舊 `loadWindowState`）。

- [ ] **Step 2: createPetWindow 定位用 per-channel 存檔**

把定位段改為：先查該 channel 存檔、有效就用，否則 'all' 用預設右下、channel 用 stack：

```ts
  const states = loadWindowStates(app.getPath('userData'))
  const saved = states[channelId]
  let pos: { x: number; y: number }
  const displays: DisplayInfo[] = screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea }))
  const validSaved = saved && displays.some((d) => saved.x >= d.workArea.x && saved.y >= d.workArea.y && saved.x + PET_WIDTH <= d.workArea.x + d.workArea.width && saved.y + PET_HEIGHT <= d.workArea.y + d.workArea.height)
  if (validSaved && saved) {
    pos = { x: saved.x, y: saved.y }
  } else if (channelId === 'all') {
    const primary = screen.getPrimaryDisplay()
    pos = defaultPosition({ id: primary.id, workArea: primary.workArea }, { width: PET_WIDTH, height: PET_HEIGHT }, MARGIN)
  } else {
    pos = stackPosition(index, { width: PET_WIDTH, height: PET_HEIGHT }, screen.getPrimaryDisplay().workArea, MARGIN, GAP)
  }
```

（移除原 `clampToValidPosition(saved, …)` 寫法；`clampToValidPosition` import 若不再用則移除。）

- [ ] **Step 3: drag-end 每隻存**

```ts
  handleCommand('drag-end', ({ channelId }) => {
    dragOffsets.delete(channelId)
    const win = getPetWindow(channelId)
    if (!win) return
    const [x, y] = win.getPosition()
    const d = screen.getDisplayMatching(win.getBounds())
    saveWindowState(app.getPath('userData'), channelId, { displayId: d.id, x, y })
  })
```

- [ ] **Step 4: drag-move / display-removed emit pet-moved 帶 channelId（所有寵物）**

- `drag-move` 結尾：`bus.emit('pet-moved', channelId)`（移除原 `if (channelId === 'all')` 限制）。
- `display-removed` 重吸附迴圈內：`bus.emit('pet-moved', channelId)`（每隻）。

- [ ] **Step 5: typecheck + commit** `feat(multi-pet B2): 每頻道寵物拖曳位置持久化（window-state keyed）`

---

## Task 8: 整合驗證 + 手動驗收

- [ ] **Step 1:** `npm run typecheck && npm test`（含 window-state migrate 測試）
- [ ] **Step 2:** `npm run build`（out/preload/card.cjs、card.html 仍在；preload 無 chunk）+ `npm run e2e`（單寵物鏈路不壞）
- [ ] **Step 3: 探針/手動**：
  1. 啟用 2 channel → 發 projA → 全部 + 專案A 各自彈卡片（各自旁邊）；專案B 不彈。
  2. 連發 projA、projB → 全部 + A + B 卡片同時各自顯示。
  3. 點 channel 寵物卡片本體 → 開中心該則詳情 + 切該頻道分頁；✕ 關該卡片。
  4. 拖某 channel 寵物 → 它的卡片跟著移；重啟後該寵物回到拖過位置。
  5. 停用/刪 channel → 該寵物 + 其卡片消失。
- [ ] **Step 4:** 交付使用者實機驗收後 merge。

---

## Self-Review

**Spec coverage：** per-pet 卡片（§3）→ Task 2/3/4/5/6 ✓；移除卡片 gate（§4）→ Task 4 ✓；位置持久化（§5）→ Task 1/7 ✓；IPC（§6）→ Task 2/3 ✓。
**Placeholder：** 無 TBD；Task 4/5/6 互相依賴已註明一起 commit。
**Type consistency：** `show-card {channelId,view}` / `hide-card {channelId}` / `card-clicked|card-more {channelId,id}`：Task 2 contract、Task 3 preload、Task 4 renderer、Task 6 handler 一致。`CardState{win,loaded,pending,activeId}` Task 6 內一致。`createCardWindow(channelId)` Task 5 定義、Task 6 ensureCard 呼叫一致。`loadWindowStates`/`saveWindowState(dir,channelId,state)`/`migrateWindowStates`：Task 1 定義、Task 7 使用一致。`getPetWindow`/`stackPosition`/`cardPosition`/`CARD_W/H/GAP`（既有）使用一致。
