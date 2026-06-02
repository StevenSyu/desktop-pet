# 寵物大小調整 實作計畫（#3）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 或 executing-plans。步驟用 `- [ ]` 追蹤。

**Goal:** 寵物右下角 hover 出現縮放把手，拖曳即時調整大小（左上固定、每隻各自、跨重啟記住）。

**Architecture:** `#pet { transform-origin: top left; transform: scale(s) }`（sprite 位移不動）＋ main `setBounds` 把視窗尺寸 resize 成 `BASE × s`（x/y 不變＝左上固定）。scale 存 `window-state.json` per-channel。卡片定位用 `getBounds()` 自動跟。

**Tech Stack:** Electron、electron-vite、TypeScript、Vitest（純函式）、Playwright `_electron`（探針）。

設計依據：`docs/superpowers/specs/2026-06-02-pet-resize-design.md`

---

### Task 1: core `pet-scale` 純函式（TDD）

**Files:** Create `src/core/pet-scale.ts`、Test `tests/core/pet-scale.test.ts`

- [ ] **Step 1: 失敗測試**
```ts
import { describe, it, expect } from 'vitest'
import { clampScale, scaleFromDrag, MIN_SCALE, MAX_SCALE } from '../../src/core/pet-scale'

describe('clampScale', () => {
  it('非數字 → 1', () => { expect(clampScale(undefined)).toBe(1); expect(clampScale('x')).toBe(1); expect(clampScale(NaN)).toBe(1) })
  it('界內原樣', () => expect(clampScale(1.5)).toBe(1.5))
  it('超界 clamp', () => { expect(clampScale(5)).toBe(MAX_SCALE); expect(clampScale(0.1)).toBe(MIN_SCALE) })
})
describe('scaleFromDrag', () => {
  it('往右下拖 → 放大', () => expect(scaleFromDrag(1, 135, 146, 135, 146)).toBeCloseTo(2))
  it('往左上拖 → 縮小', () => expect(scaleFromDrag(1, -54, -58.4, 135, 146)).toBeCloseTo(0.6, 1))
  it('clamp 上界', () => expect(scaleFromDrag(1.8, 270, 292, 135, 146)).toBe(MAX_SCALE))
})
```
- [ ] **Step 2: 跑測試確認失敗** — `npm test -- pet-scale`
- [ ] **Step 3: 實作**
```ts
export const MIN_SCALE = 0.6
export const MAX_SCALE = 2.0

export function clampScale(raw: unknown): number {
  if (typeof raw !== 'number' || Number.isNaN(raw)) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw))
}

export function scaleFromDrag(startScale: number, dx: number, dy: number, baseW: number, baseH: number): number {
  const delta = (dx / baseW + dy / baseH) / 2
  return clampScale(startScale + delta)
}
```
- [ ] **Step 4: 跑測試確認通過**
- [ ] **Step 5: Commit** — `feat(core): pet-scale 純函式（clampScale / scaleFromDrag）`

---

### Task 2: window-state 加 scale

**Files:** Modify `src/main/window-state.ts`、`tests/main/window-state.test.ts`

- [ ] **Step 1: 失敗測試（擴充）**
```ts
it('含 scale round-trip + 舊檔無 scale → 1', () => {
  expect(migrateWindowStates({ cA: { displayId: 1, x: 10, y: 20, scale: 1.5 } }).cA.scale).toBe(1.5)
  expect(migrateWindowStates({ cA: { displayId: 1, x: 10, y: 20 } }).cA.scale).toBe(1) // 無 scale → 1
})
```
- [ ] **Step 2:** `WindowState` 加 `scale: number`；`isValid` 仍只要求 displayId/x/y 為 number（scale 可缺）；`migrateWindowStates` 與單一檔分支都帶 `scale: clampScale((v as any).scale)`（import `clampScale` from `../core/pet-scale`）。
- [ ] **Step 3: 跑測試確認通過** — `npm test -- window-state`
- [ ] **Step 4: Commit** — `feat(window-state): 每寵物 scale（向後相容無 scale→1）`

---

### Task 3: IPC + preload set-scale

**Files:** Modify `src/ipc/contract.ts`、`src/preload/index.ts`、`src/preload/api.d.ts`

- [ ] **Step 1: contract.ts**
  - `Commands` 加 `'set-scale': { channelId: string; scale: number }`
  - `Pushes` 加 `'set-scale': number`
- [ ] **Step 2: preload/index.ts**（petBridge）
  - `setScale: (channelId: string, scale: number) => sendCommand('set-scale', { channelId, scale })`
  - `onSetScale: (cb: (scale: number) => void) => subscribePush('set-scale', cb)`（沿用本檔既有 send/subscribe helper 寫法）
- [ ] **Step 3: api.d.ts** petBridge 加 `setScale: (channelId: string, scale: number) => void`、`onSetScale: (cb: (scale: number) => void) => void`
- [ ] **Step 4: Commit** — `feat(ipc): set-scale 命令/推播`

---

### Task 4: 把手 DOM + 樣式 + #pet transform-origin

**Files:** Modify `src/renderer/index.html`、`src/renderer/styles.css`

- [ ] **Step 1: index.html** — `<div id="badge" hidden></div>` 後加 `<div id="resize-handle" hidden></div>`
- [ ] **Step 2: styles.css** — `#pet` 加 `transform-origin: top left;`（不要寫死 transform，由 JS 設）。加：
```css
#resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  pointer-events: auto;
  background:
    linear-gradient(135deg, transparent 0 50%, rgba(80,70,60,.55) 50% 60%, transparent 60% 70%, rgba(80,70,60,.55) 70% 80%, transparent 80%);
  border-bottom-right-radius: 4px;
}
#resize-handle[hidden] { display: none; }
```
- [ ] **Step 3: Commit** — `feat(pet): 縮放把手 DOM + 樣式 + transform-origin`

---

### Task 5: renderer 縮放互動

**Files:** Modify `src/renderer/main.ts`

- [ ] **Step 1:** import `clampScale, scaleFromDrag` from `../core/pet-scale`；常數 `const BASE_W = 135, BASE_H = 146`。
- [ ] **Step 2:** 初始 scale 套用 + 訂閱：
```ts
const handleEl = document.querySelector<HTMLDivElement>('#resize-handle')!
let scale = 1
function applyScale(): void { petEl.style.transform = `scale(${scale})` }
window.petBridge.onSetScale((s) => { scale = clampScale(s); applyScale() })
```
- [ ] **Step 3:** hover 顯示把手（併入既有 mouseenter/mouseleave；拖曳中不隱藏）：
```ts
let resizing = false
petEl.addEventListener('mouseenter', () => { handleEl.hidden = false })
petEl.addEventListener('mouseleave', () => { if (!resizing) handleEl.hidden = true })
```
> 註：與既有 mouseenter/mouseleave（hover 互動、名稱標籤）並存，新增這兩行即可，勿覆蓋既有 handler。
- [ ] **Step 4:** 把手拖曳：
```ts
handleEl.addEventListener('pointerdown', (e) => {
  e.preventDefault(); e.stopPropagation()
  resizing = true
  handleEl.setPointerCapture(e.pointerId)
  window.petBridge.setInteractive(myChannel, true)
  const startScale = scale
  const startX = e.screenX, startY = e.screenY
  let raf = 0
  const onMove = (ev: PointerEvent) => {
    const next = scaleFromDrag(startScale, ev.screenX - startX, ev.screenY - startY, BASE_W, BASE_H)
    scale = next; applyScale()
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; window.petBridge.setScale(myChannel, scale) })
  }
  const onUp = (ev: PointerEvent) => {
    handleEl.releasePointerCapture(e.pointerId)
    handleEl.removeEventListener('pointermove', onMove)
    handleEl.removeEventListener('pointerup', onUp)
    resizing = false
    window.petBridge.setScale(myChannel, scale)
    if (!petEl.matches(':hover')) handleEl.hidden = true
  }
  handleEl.addEventListener('pointermove', onMove)
  handleEl.addEventListener('pointerup', onUp)
})
```
- [ ] **Step 5:** 跑 `npm run typecheck`
- [ ] **Step 6: Commit** — `feat(pet): 把手拖曳縮放（左上固定、節流送 set-scale）`

---

### Task 6: main 視窗 resize + 存檔

**Files:** Modify `src/main/window.ts`、`src/main/index.ts`

- [ ] **Step 1: window.ts** — 常數 `BASE_W=PET_WIDTH`、`BASE_H=PET_HEIGHT`。`createPetWindow`：讀該 channel 存檔 `scale`（`states[channelId]?.scale ?? 1`，經 `clampScale`），建立視窗 `width: Math.round(BASE_W*scale)`、`height: Math.round(BASE_H*scale)`；`did-finish-load` 內 `pushTo(win, 'set-scale', scale)`。
- [ ] **Step 2: window.ts** — `handleCommand('set-scale', ({ channelId, scale }) => {...})`：
```ts
const s = clampScale(scale)
const win = getPetWindow(channelId)
if (!win) return
const b = win.getBounds()
win.setBounds({ x: b.x, y: b.y, width: Math.round(PET_WIDTH * s), height: Math.round(PET_HEIGHT * s) })
const d = screen.getDisplayMatching(win.getBounds())
saveWindowState(app.getPath('userData'), channelId, { displayId: d.id, x: b.x, y: b.y, scale: s })
bus.emit('pet-moved', channelId) // 連動卡片重定位
```
（import `clampScale` from `../core/pet-scale`）
- [ ] **Step 3: window.ts** — 既有 `drag-end` 存檔帶上目前 scale：存檔前讀 `loadWindowStates()[channelId]?.scale ?? 1`，`saveWindowState(..., { displayId, x, y, scale })`（避免拖動覆寫掉 scale）。
- [ ] **Step 4:** 跑 `npm run typecheck` + `npm test` + `npm run build`
- [ ] **Step 5: Commit** — `feat(pet): 視窗依 scale resize（左上固定）+ scale 存檔`

---

## 驗證（全部後，Claude 負責）
- `npm run typecheck && npm test`（含 pet-scale、window-state scale 測試）全綠。
- `npm run build`、`npm run e2e`（先確保 allEnabled=true）SMOKE PASS。
- Playwright `_electron` 探針：
  1. 預置 window-state scale=1.5 → 該寵物視窗 bounds ≈ 203×219、`#pet` transform `scale(1.5)`、左上 x/y 不變。
  2. `petBridge.setScale('cA', 1.3)` → 視窗 resize、x/y 不變、window-state.json `channels[cA].scale`... （注意 window-state 是獨立檔，key=channelId）寫入 1.3、卡片若顯示則跟著移動。截圖大小不同的寵物。

## Self-Review 註記
- 型別一致：`set-scale` command `{channelId,scale}`、push `number`；`scale` 全程 `clampScale`。
- 單一寫入：scale 與位置同存 `window-state.json` 一個 key，set-scale 與 drag-end 都讀-改-寫完整 `WindowState`（含 scale），不互相覆寫。
- 無 placeholder：互動 code 完整；badge 連動若需微調於驗證階段補（spec §9）。
