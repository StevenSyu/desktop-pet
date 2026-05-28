# 動畫與效能（Spec ③）實作計畫

> 設計：`docs/superpowers/specs/2026-05-28-animation-perf-design.md`
>
> 分工：Task 1（純 TDD）派 Codex；Task 2–5（整合／GUI／驗收）Claude 執行。

**Goal:** 在 idle 期間加入隨機走動，並把 sprite 影格切換從 rAF 改成 CSS `@keyframes` + 視窗不可見時暫停，降低 CPU/耗電。

**Architecture:** 新增純函式 `walk-planner`（決定間隔／距離／duration、邊界夾值）。renderer 移除 rAF 推 `background-position` 的迴圈，改 setInterval(100ms) 輪詢 FSM 並切換 `#pet[data-anim]` 屬性；CSS 9 個 `@keyframes` 各自跑該動畫的 sprite frame。idle 達 `nextWalkAt` 時透過新 IPC 請 main 推進視窗位置；事件/拖動/不可見時取消。

**Tech Stack:** TS、Vitest、Electron `BrowserWindow.setPosition`、CSS `@keyframes` + `steps()` + `animation-play-state`。

---

## File Structure

- 新增 `src/core/walk-planner.ts`（純函式，可測）
- 新增 `tests/core/walk-planner.test.ts`
- 修改 `src/preload/index.ts`、`src/preload/api.d.ts`：暴露 `walkStart` / `walkCancel` / `onWalkEnded`
- 修改 `src/main/window.ts`：walk IPC handler、drag-start 取消 walk
- 修改 `src/renderer/main.ts`：移除 rAF render；setInterval 輪詢；data-anim 切換；walk 觸發；visibilitychange 暫停
- 修改 `src/renderer/styles.css`：9 個 `@keyframes` + `#pet[data-anim="..."]` 規則 + `[data-paused]` 規則
- 修改 `src/renderer/index.html`（必要時）

---

### Task 1：`walk-planner` 純函式 + TDD（Codex）

**Files:**
- Create: `src/core/walk-planner.ts`
- Create: `tests/core/walk-planner.test.ts`

- [ ] **Step 1：寫失敗測試**

```ts
// tests/core/walk-planner.test.ts
import { describe, it, expect } from 'vitest'
import { pickWalk, clampWalkToWorkArea } from '../../src/core/walk-planner'

function seededRng(seq: number[]): () => number {
  let i = 0
  return () => seq[i++ % seq.length]
}

describe('pickWalk', () => {
  it('依注入 rng 決定方向／距離／duration／nextWalkAt 範圍', () => {
    // 三次 rng：direction(0=left)、distance(0→min)、duration(0→min)、interval(0→min)
    const rng = seededRng([0, 0, 0, 0])
    const w = pickWalk(rng, 10_000)
    expect(w.direction).toBe('left')
    expect(w.distance).toBe(60)
    expect(w.duration).toBe(1500)
    expect(w.nextWalkAt).toBe(10_000 + 30_000)
  })

  it('rng=0.999 → 方向 right、距離/時長/間隔接近上界', () => {
    const rng = seededRng([0.999, 0.999, 0.999, 0.999])
    const w = pickWalk(rng, 0)
    expect(w.direction).toBe('right')
    expect(w.distance).toBeGreaterThanOrEqual(199)
    expect(w.distance).toBeLessThanOrEqual(200)
    expect(w.duration).toBeGreaterThanOrEqual(2997)
    expect(w.duration).toBeLessThanOrEqual(3000)
    expect(w.nextWalkAt).toBeGreaterThanOrEqual(89_900)
    expect(w.nextWalkAt).toBeLessThanOrEqual(90_000)
  })
})

describe('clampWalkToWorkArea', () => {
  const workArea = { x: 0, y: 0, width: 1440, height: 900 }
  const petWidth = 134 // 192 * 0.7

  it('完全在工作區內 → 不變', () => {
    expect(clampWalkToWorkArea(500, 'right', 100, workArea, petWidth)).toBe(100)
    expect(clampWalkToWorkArea(500, 'left', 100, workArea, petWidth)).toBe(100)
  })

  it('向右會出界 → 截到剛好不出界', () => {
    // startX=1300, petWidth=134, right edge = 1440 → 可走 6px
    expect(clampWalkToWorkArea(1300, 'right', 100, workArea, petWidth)).toBe(6)
  })

  it('向左會出界 → 截到剛好不出界', () => {
    // startX=10 → 可走 10px
    expect(clampWalkToWorkArea(10, 'left', 100, workArea, petWidth)).toBe(10)
  })

  it('已經貼在/超過邊界 → 回 0', () => {
    expect(clampWalkToWorkArea(1306, 'right', 100, workArea, petWidth)).toBe(0)
    expect(clampWalkToWorkArea(0, 'left', 100, workArea, petWidth)).toBe(0)
    expect(clampWalkToWorkArea(-5, 'left', 100, workArea, petWidth)).toBe(0)
  })
})
```

- [ ] **Step 2：實作 `src/core/walk-planner.ts`**

```ts
export type WalkDirection = 'left' | 'right'

export interface Walk {
  direction: WalkDirection
  distance: number
  duration: number
  nextWalkAt: number
}

export interface WorkArea { x: number; y: number; width: number; height: number }

const DISTANCE_MIN = 60
const DISTANCE_MAX = 200
const DURATION_MIN_MS = 1500
const DURATION_MAX_MS = 3000
const INTERVAL_MIN_MS = 30_000
const INTERVAL_MAX_MS = 90_000

export function pickWalk(rng: () => number, now: number): Walk {
  const direction: WalkDirection = rng() < 0.5 ? 'left' : 'right'
  const distance = Math.round(DISTANCE_MIN + rng() * (DISTANCE_MAX - DISTANCE_MIN))
  const duration = Math.round(DURATION_MIN_MS + rng() * (DURATION_MAX_MS - DURATION_MIN_MS))
  const interval = Math.round(INTERVAL_MIN_MS + rng() * (INTERVAL_MAX_MS - INTERVAL_MIN_MS))
  return { direction, distance, duration, nextWalkAt: now + interval }
}

export function clampWalkToWorkArea(
  startX: number,
  direction: WalkDirection,
  distance: number,
  workArea: WorkArea,
  petWidth: number,
): number {
  if (direction === 'right') {
    const maxX = workArea.x + workArea.width - petWidth
    const available = Math.max(0, maxX - startX)
    return Math.min(distance, available)
  } else {
    const minX = workArea.x
    const available = Math.max(0, startX - minX)
    return Math.min(distance, available)
  }
}
```

- [ ] **Step 3：執行測試**

Run: `npm test -- tests/core/walk-planner.test.ts`
Expected：全部通過。

- [ ] **Step 4：Commit**

```bash
git add src/core/walk-planner.ts tests/core/walk-planner.test.ts
git commit -m "feat(core): walk-planner（pickWalk / clampWalkToWorkArea）+ 測試"
```

---

### Task 2：preload + api.d.ts（Claude）

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/api.d.ts`

- [ ] **Step 1：在 `src/preload/index.ts` 既有 bridge 中加入**

```ts
walkStart: (req: { direction: 'left' | 'right'; distance: number; duration: number }) =>
  ipcRenderer.send('walk-start', req),
walkCancel: () => ipcRenderer.send('walk-cancel'),
onWalkEnded: (cb: () => void) => ipcRenderer.on('walk-ended', () => cb()),
```

- [ ] **Step 2：在 `src/preload/api.d.ts` 中加入對應型別**

```ts
walkStart: (req: { direction: 'left' | 'right'; distance: number; duration: number }) => void
walkCancel: () => void
onWalkEnded: (cb: () => void) => void
```

- [ ] **Step 3：typecheck**

Run: `npm run typecheck`
Expected：通過。

- [ ] **Step 4：Commit**

```bash
git add src/preload/index.ts src/preload/api.d.ts
git commit -m "feat(preload): walk-start / walk-cancel / walk-ended bridge"
```

---

### Task 3：main 端 walk handler（Claude）

**Files:**
- Modify: `src/main/window.ts`

- [ ] **Step 1：在 main 端 handlers 區塊加入 walk 狀態與 handler**

加到既有 `ipcMain.on('drag-start' ...)` 等附近：

```ts
// walk session：單一 in-flight；setTimeout 鏈式推進避免時鐘漂移
let walkTimer: NodeJS.Timeout | null = null

function endWalk(notify: boolean): void {
  if (walkTimer) { clearTimeout(walkTimer); walkTimer = null }
  if (notify) win.webContents.send('walk-ended')
}

ipcMain.on('walk-start', (_e, req: { direction: 'left' | 'right'; distance: number; duration: number }) => {
  // 同步先取消任何進行中的 walk
  endWalk(false)
  const [startX, startY] = win.getPosition()
  const display = screen.getDisplayNearestPoint({ x: startX, y: startY })
  const sign = req.direction === 'right' ? 1 : -1
  // 利用 core 純函式夾值（main 端直接 inline 計算亦可，此處保持與 spec 一致）
  const available = clampWalkToWorkArea(startX, req.direction, req.distance, display.workArea, PET_WIDTH)
  if (available <= 0) { win.webContents.send('walk-ended'); return }

  const startedAt = Date.now()
  const step = (): void => {
    const elapsed = Date.now() - startedAt
    const t = Math.min(1, elapsed / req.duration)
    const x = Math.round(startX + sign * available * t)
    win.setPosition(x, startY)
    if (t >= 1) { endWalk(true); return }
    walkTimer = setTimeout(step, 16)
  }
  step()
})

ipcMain.on('walk-cancel', () => endWalk(true))
```

並在檔案頂部新增 `import { clampWalkToWorkArea } from '../core/walk-planner'`。

- [ ] **Step 2：drag-start 自動取消正在進行的 walk**

把現有 `ipcMain.on('drag-start', ...)` 的最開頭加：

```ts
endWalk(true) // 拖動時取消任何走動
```

- [ ] **Step 3：typecheck + build**

```bash
npm run typecheck && npm run build
```

Expected：通過（renderer 還沒呼叫 walkStart 也 OK；handler 只是註冊）。

- [ ] **Step 4：Commit**

```bash
git add src/main/window.ts
git commit -m "feat(main): walk 視窗推進 + drag-start 自動取消"
```

---

### Task 4：renderer rAF→CSS + walk 觸發 + 不可見暫停（Claude）

這是本 spec 最大的一筆，但檔案集中、邏輯整體要一起換。

**Files:**
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/main.ts`

- [ ] **Step 1：在 `styles.css` 加 9 個 `@keyframes` 與規則**

每個動畫 keyframes 名稱與 row/frames/fps 對應 `src/core/sprite-format.ts`。畫布縮放是 `DISPLAY_SCALE = 0.7`，frame 寬 192 → 縮放後 134.4px；keyframes 用 sprite 原座標 × 0.7 計算。

```css
/* 9 個動畫；duration = frames / fps；each frame 用 steps(frames) 跳格 */
@keyframes pet-idle {
  from { background-position-x: 0; }
  to   { background-position-x: -806.4px; } /* 6 frames * 192 * 0.7 */
}
@keyframes pet-running-right {
  from { background-position-x: 0; }
  to   { background-position-x: -1075.2px; } /* 8 * 192 * 0.7 */
}
@keyframes pet-running-left {
  from { background-position-x: 0; }
  to   { background-position-x: -1075.2px; }
}
@keyframes pet-waving {
  from { background-position-x: 0; }
  to   { background-position-x: -537.6px; } /* 4 * 192 * 0.7 */
}
@keyframes pet-jumping {
  from { background-position-x: 0; }
  to   { background-position-x: -672px; } /* 5 * 192 * 0.7 */
}
@keyframes pet-failed {
  from { background-position-x: 0; }
  to   { background-position-x: -1075.2px; }
}
@keyframes pet-waiting {
  from { background-position-x: 0; }
  to   { background-position-x: -806.4px; }
}
@keyframes pet-running {
  from { background-position-x: 0; }
  to   { background-position-x: -806.4px; }
}
@keyframes pet-review {
  from { background-position-x: 0; }
  to   { background-position-x: -940.8px; } /* 7 * 192 * 0.7 */
}

/* row 對應 background-position-y（× DISPLAY_SCALE 0.7，row 高 208） */
#pet[data-anim="idle"]          { background-position-y: 0;       animation: pet-idle          4.8s steps(6) infinite; }
#pet[data-anim="running-right"] { background-position-y: -145.6px; animation: pet-running-right 1.6s steps(8) infinite; }
#pet[data-anim="running-left"]  { background-position-y: -291.2px; animation: pet-running-left  1.6s steps(8) infinite; }
#pet[data-anim="waving"]        { background-position-y: -436.8px; animation: pet-waving        1s   steps(4) infinite; }
#pet[data-anim="jumping"]       { background-position-y: -582.4px; animation: pet-jumping       1s   steps(5) infinite; }
#pet[data-anim="failed"]        { background-position-y: -728px;   animation: pet-failed        1.6s steps(8) infinite; }
#pet[data-anim="waiting"]       { background-position-y: -873.6px; animation: pet-waiting       2s   steps(6) infinite; }
#pet[data-anim="running"]       { background-position-y: -1019.2px;animation: pet-running       1.2s steps(6) infinite; }
#pet[data-anim="review"]        { background-position-y: -1164.8px;animation: pet-review        1.75s steps(7) infinite; }

#pet[data-paused="true"] { animation-play-state: paused; }
```

注意：`background-position-y` 由 CSS 規則設定；`background-position-x` 由 keyframes 控；`#pet` 既有 `background-image / background-size` 不動。

- [ ] **Step 2：改寫 `src/renderer/main.ts`**

替換現有 rAF render 段（`function render(...)` 與 `requestAnimationFrame(render)` 整段），改用 setInterval 輪詢；加入 walk 觸發、IPC 取消、visibilitychange 暫停。

刪除：
- `function render(now: number)`、`requestAnimationFrame(render)`
- `petEl.style.backgroundPosition = ...`（運行時不再寫 inline 樣式）

新增（在 PetController 建立後、bindHover() 之前）：

```ts
import { pickWalk, clampWalkToWorkArea } from '../core/walk-planner'

let currentAnim: string | null = null
let walking = false
let nextWalkAt = pickWalk(Math.random, performance.now()).nextWalkAt

function setAnim(name: string): void {
  if (currentAnim === name) return
  currentAnim = name
  petEl.setAttribute('data-anim', name)
}

function tick(): void {
  const now = performance.now()
  const view = pet.advance(now)
  setAnim(view.animation)

  // 僅 idle 且未在走動、未被暫停時觸發走動
  if (!walking && view.animation === 'idle' && !document.hidden && now >= nextWalkAt) {
    const w = pickWalk(Math.random, now)
    nextWalkAt = w.nextWalkAt // 即便走不動，也排下次
    walking = true
    setAnim(w.direction === 'right' ? 'running-right' : 'running-left')
    window.petBridge.walkStart({ direction: w.direction, distance: w.distance, duration: w.duration })
  }
}

window.petBridge.onWalkEnded(() => {
  walking = false
  nextWalkAt = pickWalk(Math.random, performance.now()).nextWalkAt
})

let tickTimer: ReturnType<typeof setInterval> | null = setInterval(tick, 100)

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    petEl.setAttribute('data-paused', 'true')
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
    if (walking) window.petBridge.walkCancel()
  } else {
    petEl.removeAttribute('data-paused')
    if (!tickTimer) tickTimer = setInterval(tick, 100)
    nextWalkAt = pickWalk(Math.random, performance.now()).nextWalkAt
  }
})

// 事件中斷走動：onPetEvent 收到非 idle 時取消（FSM advance() 下一次 tick 會自然切回反應動畫名）
window.petBridge?.onPetEvent?.((event: AppEvent) => {
  pet.onEvent(event, performance.now())
  currentEvent = event
  renderCard()
  if (walking) window.petBridge.walkCancel()
})
```

注意：原本就有的 `onPetEvent` 註冊整段被取代為上面這版（包含 `walkCancel` 呼叫）。

`clampWalkToWorkArea` 的 import 即使 renderer 沒直接用，也可選擇移除—main 端已 import。若不用 → 不要 import 以免 TS 抱怨 unused。

- [ ] **Step 3：typecheck + build**

```bash
npm run typecheck && npm run build
```

Expected：通過。

- [ ] **Step 4：本地 smoke**

```bash
perl -e 'alarm 8; exec @ARGV' ./node_modules/.bin/electron . >/tmp/deskpet-anim-smoke.log 2>&1; echo rc=$?
```

Expected：rc=142（alarm 自殺正常），log 無致命錯誤。

- [ ] **Step 5：Commit**

```bash
git add src/renderer/styles.css src/renderer/main.ts
git commit -m "feat(renderer): rAF→CSS sprite 動畫、idle 走動觸發、不可見時暫停"
```

---

### Task 5：整合驗證（Claude）

- [ ] **Step 1：全套自動驗證**

```bash
npm test && npm run typecheck && npm run build
```

Expected：60+ 測試通過（含 walk-planner 新增的 6 個），typecheck/build 通過。

- [ ] **Step 2：Playwright e2e smoke 截圖**

```bash
npm run e2e
```

Expected：產出 `/tmp/deskpet-shot.png`；截圖中 may 仍應正常顯示（CSS keyframes 動畫應在跑）。

- [ ] **Step 3：手動驗收（請使用者跑）**

```bash
npm run dev
```

對下列 4 項：

1. **走動觸發**：在 30–90 秒 idle 期間，may 應自行往左或右小步走動 1.5–3 秒，然後停下。
   - dev 加速驗證：可暫時把 `INTERVAL_MIN_MS = 3000`、`INTERVAL_MAX_MS = 5000` 觀察。
2. **走動中斷**：走動進行時，從別處 `curl -H "X-Token: ..." http://127.0.0.1:.../notify -d '{"type":"done","body":"yo"}'`（用 endpoint.json 內 token/port）→ may 應立刻停下並切到 jumping、彈卡片。
3. **拖動取消走動**：走動進行時，左鍵拖動 may → walk 應立刻取消，視窗跟著游標走。
4. **不可見暫停**：把另一個 App 進 macOS 全螢幕 → may 應消失（既有 floating 行為）；切回桌面 → idle 動畫繼續、走動間隔重排（不會立刻觸發）。

- [ ] **Step 4：更新 README + CHANGELOG（在使用者確認後）**

README「特色」加：
- idle 期間隨機自走動畫
- CSS-only sprite 動畫 + 視窗不可見時暫停（省電）

CHANGELOG `Unreleased / Added` 加對應條目；`Changed` 加「動畫核心從 rAF 推 backgroundPosition 改為 CSS `@keyframes` + `steps()`，視窗不可見時暫停」。

- [ ] **Step 5：Commit + 合併 main**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: README/CHANGELOG 反映 Spec ③（idle 走動 + CSS 動畫 + 不可見暫停）"
git checkout main && git merge feat/animation-perf
```

---

## 風險與回退

- **CSS keyframes 與 sprite 框格不對齊**：drag 一格／半格錯位 → 視覺立刻看得到；修 keyframes 的像素值。
- **走動 jitter（setTimeout 16ms 不準）**：若視覺不流暢，改用 main 端 rAF（`BrowserWindow.webContents` 沒有 rAF；可用 `setInterval(16)` 或 native `setImmediate`）。
- **renderer 端走動觸發跟 FSM advance 時序對撞**：onPetEvent 進來時若同時有 walk 在跑 → walkCancel；reentrancy 用單一 walking flag 防雙重觸發。
- **若走動造成體感太「神經質」**：把 `INTERVAL_MIN_MS` 拉到 60 秒、`DISTANCE_MAX` 降到 120px。

## Self-Review

- **Spec coverage**：A2（走動觸發/中斷/邊界/不持久）— Task 1+3+4；D1（rAF→CSS + 不可見暫停）— Task 4。✓
- **Placeholder scan**：無 TBD。每個 Step 都有具體程式碼／命令。✓
- **型別一致**：`WalkDirection`、`Walk`、`walkStart` 參數型別 — Task 1/2 一致。`onWalkEnded` 接 0 引數 cb — Task 2/4 一致。✓
- **分支**：建議在 `feat/animation-perf` 上做（與既有命名一致）。
