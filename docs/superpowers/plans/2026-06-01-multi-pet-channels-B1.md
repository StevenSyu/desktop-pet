# 多寵物 子專案 B1：多寵物核心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每個啟用 channel + 「全部」各一隻寵物視窗（各自造型、反應、未讀紅點），channel 寵物簡化不自走；把單寵物的 window.ts/IPC 重構成多寵物。

**Architecture:** 寵物共用同一 renderer，靠 URL `?c=<channelId>` 知道身分；per-pet 命令帶 channelId，main 用 `Map<channelId, win>` 路由。main `reconcilePets()` 依 channels + allEnabled 生/收寵物（≥1 不變量防鎖死）。事件依 `all + matchingChannels` 路由到多寵物。

**Tech Stack:** Electron + electron-vite、TypeScript、typed IPC、Vitest。

**依據 spec：** `docs/superpowers/specs/2026-06-01-multi-pet-channels-B1-design.md`

**B1 邊界：** channel 寵物**只演反應動畫 + 紅點，無即時卡片**（卡片仍只在「全部」寵物，沿用現流程）；拖曳位置**不持久化**（重啟重新堆疊）。per-pet 卡片 / 位置記憶 / 點寵物開中心 = B2。

---

## File Structure

**新增**
- `src/core/pet-layout.ts`（+ `tests/core/pet-layout.test.ts`）— `stackPosition` 純函式

**修改**
- `src/ipc/contract.ts` — per-pet 命令加 channelId
- `src/preload/index.ts`、`src/preload/api.d.ts` — petBridge 命令簽名加 channelId
- `src/renderer/main.ts` — 讀 `?c=` 取 myChannel、命令帶 channelId、自走/卡片 gate 'all'
- `src/main/window.ts` — 單寵物 → 多寵物管理（Map + per-pet 路由 + reconcile 用匯出）
- `src/main/index.ts` — `reconcilePets`、事件/未讀/造型路由多寵物、reconcile 觸發點

---

## Task 1: `pet-layout.ts` 純函式（TDD）

> 純函式，派 codex TDD、Claude review。

**Files:**
- Create: `src/core/pet-layout.ts`
- Test: `tests/core/pet-layout.test.ts`

- [ ] **Step 1: 寫失敗測試**

`tests/core/pet-layout.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { stackPosition, type Rect } from '../../src/core/pet-layout'

const wa: Rect = { x: 0, y: 0, width: 1440, height: 900 }
const size = { width: 135, height: 146 }
const margin = 24
const gap = 12

describe('stackPosition', () => {
  it('index 0 → 右下角（= defaultPosition）', () => {
    // x = 1440-135-24 = 1281；y = 900-146-24 = 730
    expect(stackPosition(0, size, wa, margin, gap)).toEqual({ x: 1281, y: 730 })
  })
  it('index 1/2 → 向左各退 (寬+gap)=147', () => {
    expect(stackPosition(1, size, wa, margin, gap)).toEqual({ x: 1134, y: 730 })
    expect(stackPosition(2, size, wa, margin, gap)).toEqual({ x: 987, y: 730 })
  })
  it('太多 → x 夾在 workArea.x（不為負）', () => {
    // index 大到 x<0 → 夾到 workArea.x
    expect(stackPosition(50, size, wa, margin, gap).x).toBe(0)
  })
  it('負原點外接螢幕', () => {
    const waNeg: Rect = { x: -1920, y: 0, width: 1920, height: 1080 }
    // index0: x = -1920+1920-135-24 = -159；y = 0+1080-146-24 = 910
    expect(stackPosition(0, size, waNeg, margin, gap)).toEqual({ x: -159, y: 910 })
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/core/pet-layout.test.ts`
Expected: FAIL — 找不到模組。

- [ ] **Step 3: 實作**

`src/core/pet-layout.ts`：

```ts
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 寵物堆疊定位：index 0 = workArea 右下角；index 1,2,… 向左各退 (寬+gap)。
 * x 夾進 [workArea.x, 右下角 x]；y 同一底列。
 */
export function stackPosition(
  index: number,
  size: { width: number; height: number },
  workArea: Rect,
  margin: number,
  gap: number,
): { x: number; y: number } {
  const baseX = workArea.x + workArea.width - size.width - margin
  const y = workArea.y + workArea.height - size.height - margin
  const x = Math.max(workArea.x, baseX - index * (size.width + gap))
  return { x, y }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/core/pet-layout.test.ts`
Expected: PASS（4 案例）。

- [ ] **Step 5: commit**

```bash
git add src/core/pet-layout.ts tests/core/pet-layout.test.ts
git commit -m "feat(core): pet-layout stackPosition 純函式（寵物向左堆疊定位）"
```

---

## Task 2: IPC contract — per-pet 命令加 channelId

**Files:**
- Modify: `src/ipc/contract.ts`

- [ ] **Step 1: 改 per-pet 命令 payload**

`src/ipc/contract.ts` `Commands` 內，把這些命令改為含 `channelId`（`show-context-menu` 也加，供 popup 在正確寵物）：

```ts
  'set-interactive': { channelId: string; interactive: boolean }
  'show-context-menu': { channelId: string }
  'drag-start': { channelId: string; sx: number; sy: number }
  'drag-move': { channelId: string; sx: number; sy: number }
  'drag-end': { channelId: string }
  'walk-start': { channelId: string; direction: 'left' | 'right'; distance: number; duration: number }
  'walk-cancel': { channelId: string }
```

（其餘命令不變。`set-interactive` 由 boolean 改為物件、`show-context-menu` 由 void 改為物件、`drag-end`/`walk-cancel` 由 void 改為物件。）

- [ ] **Step 2: typecheck（會因 preload/main 未改而報錯 → 後續任務修；本步僅確認 contract 本身語法）**

Run: `npm run typecheck`
Expected: 可能於 preload/window/main 報型別錯（下游未改）—— Task 3/5/6 修齊後轉綠。本任務先 commit contract。

- [ ] **Step 3: commit**

```bash
git add src/ipc/contract.ts
git commit -m "feat(ipc): per-pet 命令加 channelId（set-interactive/drag/walk/show-context-menu）"
```

---

## Task 3: preload + api.d.ts — petBridge 命令加 channelId

**Files:**
- Modify: `src/preload/index.ts`、`src/preload/api.d.ts`

- [ ] **Step 1: preload/index.ts 方法簽名加 channelId**

`src/preload/index.ts`，改這些方法（renderer 會傳自己的 channelId）：

```ts
  setInteractive: (channelId: string, interactive: boolean) => sendCommand('set-interactive', { channelId, interactive }),
  showContextMenu: (channelId: string) => sendCommand('show-context-menu', { channelId }),
  dragStart: (channelId: string, sx: number, sy: number) => sendCommand('drag-start', { channelId, sx, sy }),
  dragMove: (channelId: string, sx: number, sy: number) => sendCommand('drag-move', { channelId, sx, sy }),
  dragEnd: (channelId: string) => sendCommand('drag-end', { channelId }),
  walkStart: (channelId: string, req: { direction: 'left' | 'right'; distance: number; duration: number }) =>
    sendCommand('walk-start', { channelId, ...req }),
  walkCancel: (channelId: string) => sendCommand('walk-cancel', { channelId }),
```

- [ ] **Step 2: api.d.ts 同步型別**

`src/preload/api.d.ts` petBridge 內對應改：

```ts
      setInteractive: (channelId: string, interactive: boolean) => void
      showContextMenu: (channelId: string) => void
      dragStart: (channelId: string, sx: number, sy: number) => void
      dragMove: (channelId: string, sx: number, sy: number) => void
      dragEnd: (channelId: string) => void
      walkStart: (channelId: string, req: { direction: 'left' | 'right'; distance: number; duration: number }) => void
      walkCancel: (channelId: string) => void
```

- [ ] **Step 3: typecheck（renderer 未改前會報錯，Task 4 修）**

Run: `npm run typecheck` — 預期 renderer/main.ts 報參數錯，Task 4 修。

- [ ] **Step 4: commit**

```bash
git add src/preload/index.ts src/preload/api.d.ts
git commit -m "feat(preload): petBridge per-pet 命令簽名加 channelId"
```

---

## Task 4: renderer main.ts — 身分 / 命令帶 channelId / gate

**Files:**
- Modify: `src/renderer/main.ts`

- [ ] **Step 1: 取得 myChannel（檔案頂部，import 後）**

在 `const DISPLAY_SCALE = 0.7` 之前加：

```ts
const myChannel = new URLSearchParams(location.search).get('c') ?? 'all'
const isAllPet = myChannel === 'all'
```

- [ ] **Step 2: 命令帶 channelId**

把 main.ts 內所有 petBridge per-pet 命令呼叫改成帶 `myChannel`：
- `applyEffect`：`window.petBridge.dragStart(myChannel, eff.sx, eff.sy)`、`flushDragMove` 內 `window.petBridge.dragMove(myChannel, pendingDragMove.sx, pendingDragMove.sy)`、`window.petBridge.dragEnd(myChannel)`。
- 自走觸發：`window.petBridge.walkStart(myChannel, { direction: w.direction, distance: w.distance, duration: w.duration })`。
- 所有 `window.petBridge.walkCancel()` → `window.petBridge.walkCancel(myChannel)`（共 3 處：applyEvent、onAutoWalkChanged、visibilitychange、bindHover hover 中斷）。
- `bindHover`：`enableInteractive = () => window.petBridge.setInteractive(myChannel, true)`、`disableInteractive = () => window.petBridge.setInteractive(myChannel, false)`。
- contextmenu：`window.petBridge?.showContextMenu?.(myChannel)`。

- [ ] **Step 3: 卡片只在「全部」寵物（B1）**

把 `onPetEvent` callback 改為（channel 寵物只演動畫 + 徽章，不顯示卡片/replay）：

```ts
window.petBridge?.onPetEvent?.((event: AppEvent) => {
  applyEvent(event)
  dispatch({ kind: 'externalEvent' })
  if (isAllPet) {
    currentEvent = event
    window.petBridge.showCard(buildCardView(event))
    startReplay(event)
  }
  refreshBadge()
})
```

（`onDndOn`/`onCardDismissed` 不變：channel 寵物 `currentEvent` 恆 null，這兩個 handler 對它自然 no-op。）

- [ ] **Step 4: 自走 gate 加 isAllPet**

`tick()` 內自走觸發條件最前面加 `isAllPet &&`：

```ts
  if (
    isAllPet &&
    !currentEvent &&
    shouldWalkNow({ autoWalkEnabled, walking, animation: view.animation, hidden: document.hidden, now, nextWalkAt })
  ) {
```

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: renderer 端 OK（main.ts 已配合新簽名）。main/window.ts 仍會報錯（Task 5/6 修）。

- [ ] **Step 6: commit**

```bash
git add src/renderer/main.ts
git commit -m "feat(renderer): 寵物讀 ?c= 身分、命令帶 channelId、自走/卡片限「全部」寵物"
```

---

## Task 5: window.ts 重構為多寵物管理

**Files:**
- Modify: `src/main/window.ts`（整檔重構）

- [ ] **Step 1: 覆寫 window.ts**

以下為完整新檔（單 `petWinRef` → `petWindows: Map`；per-pet drag/hover；walk 限 'all'；命令依 channelId 路由；匯出 `createPetWindow(channelId, requestedSkin, index)` / `getPetWindow` / `petChannelIds` / `closePetWindow` 供 index.ts reconcile）：

```ts
import { app, BrowserWindow, screen, Menu, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SKIN_ID } from '../core/skins'
import { scanSkins } from './skin-registry'
import { bus } from './bus'
import { clampToValidPosition, defaultPosition, type DisplayInfo } from '../core/window-position'
import { stackPosition } from '../core/pet-layout'
import { sanitizeWalkBounds, DEFAULT_WALK_BOUNDS, type WalkBounds } from '../core/walk-planner'
import { WalkSession } from '../core/walk-session'
import { loadWindowState, saveWindowState } from './window-state'
import { loadPrefs, updatePrefs, type Prefs } from './prefs'
import { handleCommand, handleQuery, pushTo } from '../ipc/main-helpers'

const PET_WIDTH = 135
const PET_HEIGHT = 146
const MARGIN = 24
const GAP = 12

let handlersRegistered = false
const petWindows = new Map<string, BrowserWindow>() // channelId → window；'all' = 全部
let prefs: Prefs = {
  autoWalk: true,
  walk: { ...DEFAULT_WALK_BOUNDS },
  skin: DEFAULT_SKIN_ID,
  dnd: false,
  allEnabled: true,
  channels: [],
  knownSources: [],
}
let skinSheetPaths = new Map<string, string>()

export function getSkinSheetPath(id: string): string | undefined {
  return skinSheetPaths.get(id)
}
export function getPetWindow(channelId: string): BrowserWindow | undefined {
  const w = petWindows.get(channelId)
  return w && !w.isDestroyed() ? w : undefined
}
export function petChannelIds(): string[] {
  return [...petWindows.keys()]
}
export function closePetWindow(channelId: string): void {
  const w = petWindows.get(channelId)
  if (w && !w.isDestroyed()) w.close()
  petWindows.delete(channelId)
}

function builtinRoot(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath()
}

// ===== per-pet 拖動狀態；walk 只給 'all' =====
const dragOffsets = new Map<string, { x: number; y: number }>()
const walkSession = new WalkSession()
let walkTimer: NodeJS.Timeout | null = null
function endWalk(notify: boolean): void {
  if (walkTimer) {
    clearTimeout(walkTimer)
    walkTimer = null
  }
  walkSession.cancel()
  if (notify) pushTo(getPetWindow('all'), 'walk-ended')
}

export function createPetWindow(channelId: string, requestedSkin: string, index: number): BrowserWindow {
  prefs = loadPrefs(app.getPath('userData'))
  skinSheetPaths = scanSkins(app.getPath('userData'), builtinRoot()).sheetPaths

  // 定位：'all' 用 window-state（沿用單寵物）；其餘向左堆疊
  let pos: { x: number; y: number }
  if (channelId === 'all') {
    const primary = screen.getPrimaryDisplay()
    const displays: DisplayInfo[] = screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea }))
    const saved = loadWindowState(app.getPath('userData'))
    pos = clampToValidPosition(saved, displays, { id: primary.id, workArea: primary.workArea }, { width: PET_WIDTH, height: PET_HEIGHT }, MARGIN)
  } else {
    pos = stackPosition(index, { width: PET_WIDTH, height: PET_HEIGHT }, screen.getPrimaryDisplay().workArea, MARGIN, GAP)
  }

  const win = new BrowserWindow({
    width: PET_WIDTH,
    height: PET_HEIGHT,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: { preload: join(__dirname, '../preload/index.cjs') },
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?c=${encodeURIComponent(channelId)}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { c: channelId } })
  }
  win.webContents.once('did-finish-load', () => {
    const { sheetPaths } = scanSkins(app.getPath('userData'), builtinRoot())
    skinSheetPaths = sheetPaths
    const effectiveId = sheetPaths.has(requestedSkin) ? requestedSkin : DEFAULT_SKIN_ID
    pushTo(win, 'set-skin', effectiveId)
  })
  win.setIgnoreMouseEvents(true, { forward: true })
  petWindows.set(channelId, win)
  win.on('closed', () => {
    if (petWindows.get(channelId) === win) petWindows.delete(channelId)
  })

  if (!handlersRegistered) {
    handlersRegistered = true
    registerHandlers()
  }
  return win
}

function registerHandlers(): void {
  handleCommand('set-interactive', ({ channelId, interactive }) => {
    getPetWindow(channelId)?.setIgnoreMouseEvents(!interactive, { forward: true })
  })

  handleCommand('show-context-menu', ({ channelId }) => {
    const win = getPetWindow(channelId)
    if (!win) return
    const menu = Menu.buildFromTemplate([
      { label: '更換造型…', click: () => bus.emit('open-skins') },
      { label: '頻道…', click: () => bus.emit('open-channels') },
      {
        label: '自動走動',
        type: 'checkbox',
        checked: prefs.autoWalk,
        click: (mi) => {
          prefs = updatePrefs(app.getPath('userData'), { autoWalk: mi.checked })
          pushTo(getPetWindow('all'), 'auto-walk-changed', prefs.autoWalk)
          if (!prefs.autoWalk) endWalk(true)
        },
      },
      { label: '勿擾模式', type: 'checkbox', checked: prefs.dnd, click: (mi) => applyDnd(mi.checked) },
      { label: '進階設定…', click: () => bus.emit('open-settings') },
      { type: 'separator' },
      { label: '通知中心', click: () => bus.emit('open-center') },
      { type: 'separator' },
      { label: '關閉小幫手', click: () => app.quit() },
    ])
    menu.popup({ window: win })
  })

  // ===== 拖動（per-pet）=====
  handleCommand('drag-start', ({ channelId }) => {
    const win = getPetWindow(channelId)
    if (!win) return
    if (channelId === 'all') endWalk(true) // 只有 'all' 會走動
    const cursor = screen.getCursorScreenPoint()
    const [wx, wy] = win.getPosition()
    dragOffsets.set(channelId, { x: cursor.x - wx, y: cursor.y - wy })
  })
  handleCommand('drag-move', ({ channelId }) => {
    const win = getPetWindow(channelId)
    const off = dragOffsets.get(channelId)
    if (!win || !off) return
    const cursor = screen.getCursorScreenPoint()
    win.setPosition(Math.round(cursor.x - off.x), Math.round(cursor.y - off.y))
    if (channelId === 'all') bus.emit('pet-moved') // 卡片只跟「全部」（B1）
  })
  handleCommand('drag-end', ({ channelId }) => {
    dragOffsets.delete(channelId)
    const win = getPetWindow(channelId)
    if (!win) return
    if (channelId === 'all') {
      const [x, y] = win.getPosition()
      const d = screen.getDisplayMatching(win.getBounds())
      saveWindowState(app.getPath('userData'), { displayId: d.id, x, y }) // 只持久化「全部」（B1）
    }
  })

  // ===== walk：只給 'all' =====
  handleCommand('walk-start', (req) => {
    if (req.channelId !== 'all') return
    const win = getPetWindow('all')
    if (!win) return
    endWalk(false)
    const [startX, startY] = win.getPosition()
    const display = screen.getDisplayNearestPoint({ x: startX, y: startY })
    const res = walkSession.start(
      { startX, requestedDirection: req.direction, distance: req.distance, duration: req.duration, workArea: display.workArea, petWidth: PET_WIDTH },
      Date.now(),
    )
    if (!res.ok) {
      pushTo(win, 'walk-ended')
      return
    }
    if (res.flippedTo) pushTo(win, 'walk-direction', res.flippedTo)
    const step = (): void => {
      const w = getPetWindow('all')
      if (!w) {
        endWalk(false)
        return
      }
      const frame = walkSession.step(Date.now())
      if (!frame) return
      w.setPosition(frame.x, startY)
      if (frame.done) {
        endWalk(true)
        return
      }
      walkTimer = setTimeout(step, 16)
    }
    step()
  })
  handleCommand('walk-cancel', ({ channelId }) => {
    if (channelId === 'all') endWalk(true)
  })

  // ===== 全域命令 / 查詢（不分 pet）=====
  handleCommand('open-center', () => bus.emit('open-center'))
  handleQuery('get-auto-walk', () => prefs.autoWalk)
  handleQuery('get-prefs', () => prefs)
  handleQuery('get-skins', () => {
    const { skins, sheetPaths } = scanSkins(app.getPath('userData'), builtinRoot())
    skinSheetPaths = sheetPaths
    const requestedId = prefs.skin
    return { skins, requestedId, effectiveId: sheetPaths.has(requestedId) ? requestedId : DEFAULT_SKIN_ID }
  })
  handleQuery('select-skin', (id) => {
    const { sheetPaths } = scanSkins(app.getPath('userData'), builtinRoot())
    skinSheetPaths = sheetPaths
    if (!sheetPaths.has(id)) {
      return { ok: false, effectiveId: sheetPaths.has(prefs.skin) ? prefs.skin : DEFAULT_SKIN_ID }
    }
    prefs = updatePrefs(app.getPath('userData'), { skin: id })
    pushTo(getPetWindow('all'), 'set-skin', id) // 「全部」造型
    return { ok: true, effectiveId: id }
  })
  handleCommand('open-pets-folder', () => {
    const dir = join(app.getPath('userData'), 'pets')
    mkdirSync(dir, { recursive: true })
    shell.openPath(dir)
  })
  handleCommand('set-walk-bounds', (partial) => {
    const next = sanitizeWalkBounds({ ...prefs.walk, ...partial })
    prefs = updatePrefs(app.getPath('userData'), { walk: next })
    pushTo(getPetWindow('all'), 'prefs-changed', prefs)
  })

  function applyDnd(enabled: boolean): void {
    prefs = updatePrefs(app.getPath('userData'), { dnd: enabled })
    bus.emit('dnd-changed', enabled)
    for (const w of petWindows.values()) {
      if (enabled) pushTo(w, 'dnd-on')
      pushTo(w, 'dnd-changed', enabled)
    }
  }
  handleCommand('set-dnd', (enabled) => applyDnd(enabled))
  handleQuery('get-dnd', () => prefs.dnd)

  // ===== display-removed：每隻寵物各自失效重吸附 =====
  screen.on('display-removed', () => {
    const displays = screen.getAllDisplays()
    for (const [channelId, win] of petWindows) {
      if (win.isDestroyed()) continue
      const b = win.getBounds()
      const inside = displays.some(
        (d) => b.x >= d.workArea.x && b.y >= d.workArea.y && b.x + b.width <= d.workArea.x + d.workArea.width && b.y + b.height <= d.workArea.y + d.workArea.height,
      )
      if (!inside) {
        const primary = screen.getPrimaryDisplay()
        const pos = defaultPosition({ id: primary.id, workArea: primary.workArea }, { width: PET_WIDTH, height: PET_HEIGHT }, MARGIN)
        win.setPosition(pos.x, pos.y)
        if (channelId === 'all') bus.emit('pet-moved')
      }
    }
  })
}
```

- [ ] **Step 2: typecheck（index.ts 尚未配合 → 會報錯，Task 6 修齊）**

Run: `npm run typecheck` — 預期 index.ts 報 `createPetWindow()` 參數錯（Task 6 改）。

- [ ] **Step 3: commit（連同 Task 6 一起，因 index.ts 依賴新簽名）**

> 註：window.ts 與 index.ts 互相依賴（index 用新 createPetWindow/getPetWindow），**Task 5 + Task 6 一起 typecheck 通過後再 commit**。

---

## Task 6: index.ts — reconcilePets + 多寵物事件/未讀/造型路由

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: import 調整**

`src/main/index.ts`：
- `import { createPetWindow, getSkinSheetPath } from './window'` → `import { createPetWindow, getSkinSheetPath, getPetWindow, petChannelIds, closePetWindow } from './window'`
- 已有 `matchingChannels`、`DEFAULT_SKIN_ID`、`loadPrefs`。

- [ ] **Step 2: 移除單一 petWindow、加 reconcile**

把 `let petWindow: BrowserWindow | null = null` 移除（改用 `getPetWindow('all')` 取「全部」寵物）。`broadcastUnread` 改為 per-pet，並新增 `reconcilePets` + skin 計算：

```ts
function skinFor(channelId: string): string {
  if (channelId === 'all') return loadPrefs(app.getPath('userData')).skin
  const ch = channels.find((c) => c.id === channelId)
  return ch ? ch.skin : DEFAULT_SKIN_ID
}

// 應存在的寵物集合：allEnabled?'all' + 啟用 channel；空則強制留 'all'（≥1 防鎖死）
function desiredPetIds(): string[] {
  const ids = [...(allEnabled ? ['all'] : []), ...channels.filter((c) => c.enabled).map((c) => c.id)]
  return ids.length > 0 ? ids : ['all']
}

function reconcilePets(): void {
  const desired = desiredPetIds()
  const want = new Set(desired)
  for (const id of petChannelIds()) if (!want.has(id)) closePetWindow(id)
  desired.forEach((id, index) => {
    if (!getPetWindow(id)) {
      const win = createPetWindow(id, skinFor(id), index)
      if (id === 'all') {
        win.on('closed', () => {
          if (cardWindow && !cardWindow.isDestroyed()) cardWindow.close()
        })
      }
    }
  })
}

function broadcastUnread(): void {
  for (const id of petChannelIds()) {
    const counts = require('../core/channel').unreadByChannel(store.list(), channels) // 見下：改 import
    pushTo(getPetWindow(id), 'unread-count', id === 'all' ? counts.all : (counts[id] ?? 0))
  }
}
```

> 註：`broadcastUnread` 內不要用 `require`；改在檔頭 `import { matchingChannels, unreadByChannel, type Channel, type SourceMatch } from '../core/channel'`，函式體用 `const counts = unreadByChannel(store.list(), channels)`（每次重算一份即可）。

- [ ] **Step 3: 啟動改用 reconcile**

`app.whenReady` 內把 `petWindow = createPetWindow()` 改為：

```ts
  reconcilePets()
```

（移除原本 `petWindow.on('closed', …)`，已移進 reconcile 的 'all' 分支。）

- [ ] **Step 4: pet-event 路由到多寵物**

ingest `onEvent` 內，把 `pushTo(petWindow, 'pet-event', event)` 改為路由到「全部 + 命中 channel」：

```ts
    onEvent: (event: AppEvent) => {
      store.push(event)
      autoDetectChannel(event.source)
      broadcastUnread()
      broadcastMessages()
      if (dndEnabled) return
      const targets = new Set<string>([...(allEnabled ? ['all'] : []), ...matchingChannels(event.source, channels)])
      for (const id of targets) pushTo(getPetWindow(id), 'pet-event', event)
    },
```

- [ ] **Step 5: 其餘 petWindow 參照改 getPetWindow('all')**

把 index.ts 內所有原 `petWindow` 參照改成「全部」寵物：
- `computeCenterPos`：`const all = getPetWindow('all'); if (!all) return undefined; const pet = all.getBounds()`。
- `repositionCard`：同理用 `getPetWindow('all')` 的 bounds（否則 return）。
- `card-clicked` / `card-more` handler 內 `pushTo(petWindow, 'card-dismissed', { id })` → `pushTo(getPetWindow('all'), 'card-dismissed', { id })`。
- `bus.on('pet-moved', repositionCard)` 不變（只有 'all' drag/display-removed 會 emit）。

- [ ] **Step 6: channels / allEnabled 變動觸發 reconcile + 造型更新**

- `channel-upsert` handler 結尾加 `reconcilePets()`；若該 channel 已有寵物且 skin 變了，reconcile 不會重建 → 額外重推造型：
  ```ts
  handleCommand('channel-upsert', (ch) => {
    const withId: Channel = ch.id ? ch : { ...ch, id: nextChannelId() }
    const i = channels.findIndex((c) => c.id === withId.id)
    if (i >= 0) channels[i] = withId
    else channels = [...channels, withId]
    persistChannels()
    broadcastChannels()
    broadcastMessages()
    reconcilePets()
    pushTo(getPetWindow(withId.id), 'set-skin', withId.skin) // 既有寵物的造型即時更新（新建的由 did-finish-load 推）
    broadcastUnread()
  })
  ```
- `channel-delete` handler 結尾加 `reconcilePets(); broadcastUnread()`。
- `set-all-enabled` handler 結尾加 `reconcilePets(); broadcastUnread()`。

- [ ] **Step 7: typecheck（Task 5+6 一起）**

Run: `npm run typecheck`
Expected: PASS（window.ts + index.ts 配合一致）。

- [ ] **Step 8: commit（Task 5 + 6）**

```bash
git add src/main/window.ts src/main/index.ts
git commit -m "feat(main): window.ts 單→多寵物管理 + index.ts reconcilePets/事件/未讀/造型 per-pet 路由"
```

---

## Task 7: 整合驗證 + 手動驗收

- [ ] **Step 1: 全量 typecheck + 單元測試**

Run: `npm run typecheck && npm test`
Expected: PASS（含 pet-layout）。

- [ ] **Step 2: build + e2e**

Run: `npm run build && npm run e2e`
Expected: build 成功；e2e SMOKE_RESULT: PASS（單寵物預設情境＝只有 'all'，既有鏈路不壞）。

- [ ] **Step 3: 手動驗收（`npm run dev`，對照 spec §11）**

1. 預設（無啟用 channel）→ 只有「全部」一隻、行為如舊（走動/卡片/拖動）。
2. 啟用 2 個 channel → 出現 3 隻、各自造型、從「全部」向左排不重疊。
3. 發命中 channelA 的事件 → 「全部」+ channelA 寵物演反應；channelB 不動；卡片只在「全部」跳。
4. 多屬來源（A、B 兩 channel）→ 全部 + A + B 都演。
5. 各寵物紅點 = 該 channel 未讀數；「全部」= 總未讀。
6. 拖某 channel 寵物 → 只動它；channel 寵物不自走、「全部」仍自走。
7. 停用/刪 channel → 該寵物消失；`allEnabled` 關 → 「全部」消失（剩 channel 寵物）；**全關 → 仍保留「全部」一隻（不鎖死）**。
8. 任一寵物右鍵 → 全域選單可開「頻道…」等。

- [ ] **Step 4: 交付使用者測試後再 merge**

請使用者實機驗收（多寵物生成/造型/反應/紅點/拖動/啟停回收/不鎖死）。OK 後才合併。

---

## Self-Review

**1. Spec coverage：**
- §3 身分/路由（?c= + 命令帶 channelId + walk/卡片 gate 'all'）→ Task 2/3/4 ✓。
- §4 reconcile（生/收 + ≥1 不變量）→ Task 6 `reconcilePets`/`desiredPetIds` ✓。
- §5 造型/未讀 per-pet → Task 6（skinFor/set-skin、broadcastUnread per-pet）✓。
- §6 事件反應路由（all + matchingChannels）→ Task 6 Step 4 ✓。
- §7 定位（stackPosition、'all' window-state、不持久化 channel）→ Task 1 + Task 5（createPetWindow 定位、drag-end 只存 all）✓。
- §8 window.ts 單→多重構（Map、per-pet drag、walk 限 all、display-removed 逐視窗）→ Task 5 ✓。
- §9 IPC 加 channelId → Task 2/3 ✓。
- §11 測試 → Task 1 + Task 7 ✓。

**2. Placeholder scan：** 無 TBD。Task 6 Step 2 的 `require` 已用「註」明確要求改成檔頭 import（不要留 require）。Task 5/6 互相依賴 → 已註明一起 typecheck/commit。

**3. Type consistency：**
- per-pet 命令 payload（`{channelId, …}`）：Task 2 contract、Task 3 preload/api.d.ts、Task 4 renderer 呼叫、Task 5 main handler 解構一致。
- `createPetWindow(channelId, requestedSkin, index)`：Task 5 定義、Task 6 reconcile 呼叫一致；`getPetWindow/petChannelIds/closePetWindow` 同。
- `unreadByChannel(messages, channels)`（A 既有）→ Task 6 broadcastUnread 使用一致；`matchingChannels`（A 既有）→ Task 6 事件路由一致。
- `stackPosition(index, size, workArea, margin, gap)`：Task 1 定義、Task 5 使用一致。
