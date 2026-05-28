# 視窗行為強化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 寵物視窗可拖動且重啟記憶位置；`alwaysOnTop` 改 `'floating'` 自動避開別 App 全螢幕；多螢幕拔掉時自動吸附回 primary；「關閉小幫手」加確認對話框避免誤觸。

**Architecture:** 純函式（位置決定）放 `src/core/`、可單元測試；持久化 IO 放 `src/main/`；拖動使用自寫 `pointerdown/move/up`（不用 `-webkit-app-region: drag`，否則右鍵選單失效）；level 改 `'floating'` 不需自寫全螢幕偵測。

**Tech Stack:** TypeScript、Electron（`screen`, `ipcMain`, `dialog`）、Vitest。沿用既有 core/main/preload/renderer 結構。

**設計來源：** `docs/superpowers/specs/2026-05-28-window-behavior-design.md`

**注意：**
- commit 結尾附：`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- 純邏輯與 IO 任務可由 Codex 離線完成；視窗整合的 build/啟動驗證由 Claude 跑。

---

## Task 1：window-position 純函式（核心 TDD）

**Files:**
- Create: `src/core/window-position.ts`
- Test: `tests/core/window-position.test.ts`

- [ ] **Step 1: 寫失敗測試**

Create `tests/core/window-position.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  defaultPosition,
  clampToValidPosition,
  type DisplayInfo,
  type WindowState,
} from '../../src/core/window-position'

const primary: DisplayInfo = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } }
const second: DisplayInfo = { id: 2, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } }
const winSize = { width: 280, height: 300 }
const margin = 24

describe('defaultPosition', () => {
  it('右下角，含邊距', () => {
    expect(defaultPosition(primary, winSize, margin)).toEqual({
      x: 0 + 1440 - 280 - 24, // 1136
      y: 0 + 900 - 300 - 24,  // 576
    })
  })
  it('考慮非零原點（外接螢幕）', () => {
    expect(defaultPosition(second, winSize, margin)).toEqual({
      x: 1440 + 1920 - 280 - 24,
      y: 0 + 1080 - 300 - 24,
    })
  })
})

describe('clampToValidPosition', () => {
  it('saved=null → 預設右下角', () => {
    expect(clampToValidPosition(null, [primary], primary, winSize, margin)).toEqual(
      defaultPosition(primary, winSize, margin),
    )
  })
  it('saved displayId 不存在 → 預設', () => {
    const saved: WindowState = { displayId: 999, x: 100, y: 100 }
    expect(clampToValidPosition(saved, [primary, second], primary, winSize, margin)).toEqual(
      defaultPosition(primary, winSize, margin),
    )
  })
  it('saved 在有效 display 且座標在工作區內 → 原值', () => {
    const saved: WindowState = { displayId: 2, x: 1500, y: 100 }
    expect(clampToValidPosition(saved, [primary, second], primary, winSize, margin)).toEqual({
      x: 1500,
      y: 100,
    })
  })
  it('座標導致視窗超出工作區 → 預設', () => {
    const saved: WindowState = { displayId: 1, x: 1300, y: 700 } // 右下會超
    expect(clampToValidPosition(saved, [primary], primary, winSize, margin)).toEqual(
      defaultPosition(primary, winSize, margin),
    )
  })
  it('座標恰好等於工作區邊緣 → 仍有效', () => {
    const saved: WindowState = { displayId: 1, x: 1440 - 280, y: 900 - 300 }
    expect(clampToValidPosition(saved, [primary], primary, winSize, margin)).toEqual({
      x: 1440 - 280,
      y: 900 - 300,
    })
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/core/window-position.test.ts`
Expected: FAIL（無法解析模組）。

- [ ] **Step 3: 寫實作**

Create `src/core/window-position.ts`:
```ts
export interface DisplayInfo {
  id: number
  workArea: { x: number; y: number; width: number; height: number }
}

export interface WindowState {
  displayId: number
  x: number
  y: number
}

export interface WinSize {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** 給定 display 的工作區與視窗尺寸，回傳右下角座標。 */
export function defaultPosition(primary: DisplayInfo, win: WinSize, margin: number): Point {
  const { x, y, width, height } = primary.workArea
  return {
    x: x + width - win.width - margin,
    y: y + height - win.height - margin,
  }
}

/**
 * 若已儲存座標仍位於某 display 工作區內 → 回該座標；否則回 primary 預設。
 */
export function clampToValidPosition(
  saved: WindowState | null,
  displays: DisplayInfo[],
  primary: DisplayInfo,
  win: WinSize,
  margin: number,
): Point {
  if (!saved) return defaultPosition(primary, win, margin)
  const d = displays.find((x) => x.id === saved.displayId)
  if (!d) return defaultPosition(primary, win, margin)
  const wa = d.workArea
  const fitsX = saved.x >= wa.x && saved.x + win.width <= wa.x + wa.width
  const fitsY = saved.y >= wa.y && saved.y + win.height <= wa.y + wa.height
  if (!fitsX || !fitsY) return defaultPosition(primary, win, margin)
  return { x: saved.x, y: saved.y }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/core/window-position.test.ts`
Expected: PASS（7 tests）。

- [ ] **Step 5: 全測試 + typecheck**

Run: `npm test && npm run typecheck`
Expected: 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/core/window-position.ts tests/core/window-position.test.ts
git commit -m "feat(core): window-position（defaultPosition / clampToValidPosition）純函式 + 測試" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：window-state IO（main 側、TDD）

**Files:**
- Create: `src/main/window-state.ts`
- Test: `tests/main/window-state.test.ts`

- [ ] **Step 1: 寫失敗測試**

Create `tests/main/window-state.test.ts`:
```ts
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/main/window-state.test.ts`
Expected: FAIL（無法解析 `../../src/main/window-state`）。

- [ ] **Step 3: 寫實作**

Create `src/main/window-state.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface WindowState {
  displayId: number
  x: number
  y: number
}

const FILENAME = 'window-state.json'

function isValid(value: unknown): value is WindowState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.displayId === 'number' && typeof v.x === 'number' && typeof v.y === 'number'
}

export function loadWindowState(userDataDir: string): WindowState | null {
  const path = join(userDataDir, FILENAME)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return isValid(parsed) ? { displayId: parsed.displayId, x: parsed.x, y: parsed.y } : null
  } catch {
    return null
  }
}

export function saveWindowState(userDataDir: string, state: WindowState): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(userDataDir, FILENAME), JSON.stringify(state), 'utf8')
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/main/window-state.test.ts`
Expected: PASS（6 tests）。

- [ ] **Step 5: 全測試 + typecheck**

Run: `npm test && npm run typecheck`
Expected: 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/main/window-state.ts tests/main/window-state.test.ts
git commit -m "feat(main): window-state IO（loadWindowState / saveWindowState）+ 測試" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：main 串接（level→floating、拖動 IPC、display-removed、關閉確認）

**Files:**
- Modify: `src/main/window.ts`
- Modify: `src/main/center-window.ts`

- [ ] **Step 1: 改 center-window 的 alwaysOnTop level**

Modify `src/main/center-window.ts` — 找到：
```ts
  win.setAlwaysOnTop(true, 'screen-saver')
```
改為：
```ts
  win.setAlwaysOnTop(true, 'floating')
```

- [ ] **Step 2: 改 window.ts — imports、引入 helpers、level、初始位置**

Modify `src/main/window.ts`：

(a) 頂端 imports（取代既有 imports 段）：
```ts
import { app, BrowserWindow, screen, ipcMain, Menu, dialog } from 'electron'
import { join } from 'node:path'
import { SKINS } from '../core/skins'
import { bus } from './bus'
import { clampToValidPosition, defaultPosition, type DisplayInfo } from '../core/window-position'
import { loadWindowState, saveWindowState } from './window-state'
```

(b) 將既有的 `let handlersRegistered = false` 之後加入模組層級的 ref：
```ts
let petWinRef: BrowserWindow | null = null
```

(c) 在 `createPetWindow` 函式開頭，把目前的 primary + position 計算改為走 helper（**取代**現有的 `const primary = screen.getPrimaryDisplay()` 與 `const { x, y, width, height } = primary.workArea` 與 BrowserWindow x/y 的計算）：
```ts
  const primary = screen.getPrimaryDisplay()
  const displays: DisplayInfo[] = screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea }))
  const primaryInfo: DisplayInfo = { id: primary.id, workArea: primary.workArea }
  const saved = loadWindowState(app.getPath('userData'))
  const winSize = { width: PET_WIDTH, height: PET_HEIGHT }
  const { x: initX, y: initY } = clampToValidPosition(saved, displays, primaryInfo, winSize, MARGIN)

  const win = new BrowserWindow({
    width: PET_WIDTH,
    height: PET_HEIGHT,
    x: initX,
    y: initY,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
    },
  })
```

(d) 把現有的 `win.setAlwaysOnTop(true, 'screen-saver')` 改為：
```ts
  win.setAlwaysOnTop(true, 'floating')
```

(e) 在 `win.setIgnoreMouseEvents(true, { forward: true })` 之後設置 `petWinRef`：
```ts
  petWinRef = win
  win.on('closed', () => {
    if (petWinRef === win) petWinRef = null
  })
```

- [ ] **Step 3: 在 handlers 註冊區塊加入拖動 + display-removed + 關閉確認**

在 `if (!handlersRegistered) { handlersRegistered = true; ... }` 區塊內，**新增**以下處理（既有的 set-interactive、show-context-menu 不變；但 show-context-menu 內「關閉小幫手」的 click 改成走確認對話框，見下）：

```ts
    // ===== 拖動 =====
    let dragStartScreen: { x: number; y: number } | null = null
    let dragStartWin: { x: number; y: number } | null = null

    ipcMain.on('drag-start', (_event, sx: number, sy: number) => {
      if (!petWinRef || petWinRef.isDestroyed()) return
      const [wx, wy] = petWinRef.getPosition()
      dragStartScreen = { x: sx, y: sy }
      dragStartWin = { x: wx, y: wy }
    })
    ipcMain.on('drag-move', (_event, sx: number, sy: number) => {
      if (!petWinRef || petWinRef.isDestroyed()) return
      if (!dragStartScreen || !dragStartWin) return
      const nx = dragStartWin.x + (sx - dragStartScreen.x)
      const ny = dragStartWin.y + (sy - dragStartScreen.y)
      petWinRef.setPosition(Math.round(nx), Math.round(ny))
    })
    ipcMain.on('drag-end', () => {
      dragStartScreen = null
      dragStartWin = null
      if (!petWinRef || petWinRef.isDestroyed()) return
      const [x, y] = petWinRef.getPosition()
      const d = screen.getDisplayMatching(petWinRef.getBounds())
      saveWindowState(app.getPath('userData'), { displayId: d.id, x, y })
    })

    // ===== display-removed：失效時吸附回 primary =====
    screen.on('display-removed', () => {
      if (!petWinRef || petWinRef.isDestroyed()) return
      const bounds = petWinRef.getBounds()
      const displays = screen.getAllDisplays()
      const containing = displays.find((d) => {
        const wa = d.workArea
        return (
          bounds.x >= wa.x &&
          bounds.y >= wa.y &&
          bounds.x + bounds.width <= wa.x + wa.width &&
          bounds.y + bounds.height <= wa.y + wa.height
        )
      })
      if (!containing) {
        const primary = screen.getPrimaryDisplay()
        const pos = defaultPosition(
          { id: primary.id, workArea: primary.workArea },
          { width: PET_WIDTH, height: PET_HEIGHT },
          MARGIN,
        )
        petWinRef.setPosition(pos.x, pos.y)
      }
    })
```

- [ ] **Step 4: 「關閉小幫手」改成確認對話框**

在右鍵選單的 Menu template，找到：
```ts
        { label: '關閉小幫手', click: () => app.quit() },
```
改為：
```ts
        {
          label: '關閉小幫手',
          click: async () => {
            if (!petWinRef || petWinRef.isDestroyed()) {
              app.quit()
              return
            }
            const { response } = await dialog.showMessageBox(petWinRef, {
              type: 'question',
              buttons: ['取消', '關閉'],
              defaultId: 0,
              cancelId: 0,
              title: '關閉 may？',
              message: '關閉 may？',
              detail: '關閉後 Claude Code hook 仍會觸發，但 may 不會顯示。',
            })
            if (response === 1) app.quit()
          },
        },
```

- [ ] **Step 5: typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 兩個 tsconfig 通過、build 成功。

- [ ] **Step 6: Commit**

```bash
git add src/main/window.ts src/main/center-window.ts
git commit -m "feat(main): floating level、拖動 IPC + window-state 持久化、display-removed 重吸附、關閉確認對話框" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4：preload + renderer 拖動 pointer 處理

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/api.d.ts`
- Modify: `src/renderer/main.ts`

- [ ] **Step 1: preload 暴露拖動 API**

Modify `src/preload/index.ts` — 在 `markRead` 之後加入：
```ts
  dragStart: (sx: number, sy: number) => ipcRenderer.send('drag-start', sx, sy),
  dragMove: (sx: number, sy: number) => ipcRenderer.send('drag-move', sx, sy),
  dragEnd: () => ipcRenderer.send('drag-end'),
```

- [ ] **Step 2: api.d.ts 加型別**

Modify `src/preload/api.d.ts` — 在 petBridge 型別內 `markRead` 之後加入：
```ts
      dragStart: (sx: number, sy: number) => void
      dragMove: (sx: number, sy: number) => void
      dragEnd: () => void
```

- [ ] **Step 3: renderer 加拖動 pointer 處理（rAF 節流 + click vs drag 閾值）**

Modify `src/renderer/main.ts` — 在 `bindHover()` 呼叫之後、`document.addEventListener('contextmenu', ...)` 之前，**插入**：
```ts
// 拖動寵物：自寫 pointer 處理（不用 -webkit-app-region: drag，避免破壞右鍵選單與 hover）
const DRAG_THRESHOLD = 3 // px：超過才算拖動，否則視為點擊（保留給未來互動）
let dragState: { startSx: number; startSy: number; moved: boolean } | null = null
let pendingDragMove: { sx: number; sy: number } | null = null
let dragMoveRaf = 0

function flushDragMove(): void {
  dragMoveRaf = 0
  if (pendingDragMove) {
    window.petBridge.dragMove(pendingDragMove.sx, pendingDragMove.sy)
    pendingDragMove = null
  }
}

petEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return // 只接左鍵；右鍵留給 contextmenu
  dragState = { startSx: e.screenX, startSy: e.screenY, moved: false }
  petEl.setPointerCapture(e.pointerId)
  window.petBridge.dragStart(e.screenX, e.screenY)
})

petEl.addEventListener('pointermove', (e) => {
  if (!dragState) return
  if (!dragState.moved) {
    const dx = Math.abs(e.screenX - dragState.startSx)
    const dy = Math.abs(e.screenY - dragState.startSy)
    if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return
    dragState.moved = true
  }
  pendingDragMove = { sx: e.screenX, sy: e.screenY }
  if (!dragMoveRaf) dragMoveRaf = requestAnimationFrame(flushDragMove)
})

function endDrag(e: PointerEvent): void {
  if (!dragState) return
  try {
    petEl.releasePointerCapture(e.pointerId)
  } catch {
    /* 已釋放 */
  }
  if (dragState.moved) {
    // 確保最後一次位置已送出
    if (dragMoveRaf) {
      cancelAnimationFrame(dragMoveRaf)
      flushDragMove()
    }
    window.petBridge.dragEnd()
  }
  dragState = null
}
petEl.addEventListener('pointerup', endDrag)
petEl.addEventListener('pointercancel', endDrag)
```

- [ ] **Step 4: typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 通過。

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts src/preload/api.d.ts src/renderer/main.ts
git commit -m "feat(renderer): 寵物拖動 pointer 處理（click/drag 閾值 + rAF 節流）" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：整合驗證（Claude 執行）

**Files:** 無（驗證）。

- [ ] **Step 1: 全測試 + typecheck + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: 全綠（含 window-position、window-state）。

> Task 1（位置數學）與 Task 2（state IO）已 TDD 覆蓋邏輯主體；真實的 OS 級 pointer drag 與全螢幕／display-removed／系統對話框難以可靠自動模擬，整合驗證走以下手動清單。

- [ ] **Step 2: 啟動 smoke（perl alarm 8s，確認無 crash）**

Run:
```bash
perl -e 'alarm 8; exec @ARGV' ./node_modules/.bin/electron . >/tmp/deskpet-winsmoke.log 2>&1
echo "rc=$?（142=alarm 正常）"
grep -iE 'error|is not defined|uncaught|throw' /tmp/deskpet-winsmoke.log | grep -viE 'GPU|sandbox|Metal|ColorSync|IMK|CoreText|DevTools' | head || echo "no fatal errors"
pkill -f "desktop-notify/node_modules/electron" 2>/dev/null
```
Expected：rc=142、無致命錯誤。

- [ ] **Step 3: 手動驗收（使用者）**

`npm run dev` 啟動 App，逐項確認：
- **拖動**：左鍵按住 may 拖到別處（不能拖卡片區域）→ 應跟著移動；放開後重啟 App → 應回到剛剛位置。
- **floating**：另開一個 App 進 macOS 全螢幕（任一 App 的「進入全螢幕」）→ may 應自動退場；退出全螢幕 → 自動顯示。
- **多螢幕**（若有外接）：拖到外接螢幕 → 拔外接螢幕 → may 應自動回到主螢幕右下角。
- **關閉確認**：右鍵 → 「關閉小幫手」→ 應跳對話框；按 Enter／按取消不結束；點「關閉」才結束。

- [ ] **Step 4: 確認工作樹乾淨**

Run: `git status --short`
Expected: 空。

---

## 驗收標準（完成定義）

- `npm test` 全綠（含 window-position、window-state 新增測試）。
- `npm run typecheck`、`npm run build` 通過。
- 拖動 → 重啟記得位置；外接螢幕拔掉 → 自動回 primary 預設位置。
- 別 App 進全螢幕 → may 自動退場；回桌面顯示。
- 「關閉小幫手」跳確認對話框，預設取消，需明確點「關閉」才結束。

## 待後續

- 拖動到邊緣的吸附／磁吸。
- 多 display 喜好（記住「上次在哪台 display 的相對位置」）。
- 「不要再問」設定。
