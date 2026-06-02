# 寵物大小調整 設計文件（#3）

- 日期：2026-06-02
- 狀態：設計定案（自走：直接進 writing-plans）
- 對應 backlog：issue #3「可調整寵物大小（右下角縮放把手，左上固定）」

---

## 1. 動機
讓使用者可調整單隻寵物大小：寵物右下角一個縮放把手，拖曳即時改變大小，**左上角固定**（往右下擴/縮）。每隻寵物各自大小、跨重啟記住。

## 2. 範圍
**目標**
- 每隻寵物可獨立縮放（per-channel），scale 存 `window-state.json`、跨重啟生效。
- 右下角縮放把手：**hover 寵物時才出現**，拖曳調整大小（左上固定）。
- 縮放範圍 clamp **0.6×–2.0×**（1.0× = 現狀 135×146）。
- 卡片定位跟著寵物實際大小（已天然支援：`repositionCard` 用 `getBounds()`）。

**非目標**
- 堆疊間距依縮放重算（`stackPosition` 仍用 base 尺寸；縮放是視覺微調，初始堆疊位置不重算）。
- 縮放動畫過場；多寵物等比聯動。

## 3. 縮放機制（關鍵）
sprite 動畫的 `background-position` 在 CSS 是**寫死的 0.7-scale px 值**，故**不可**只改 `#pet` 寬高。採 **CSS transform**：
- `#pet { transform-origin: top left; transform: scale(s) }` —— 所有 sprite 位移不動，整體視覺縮放；`transform-origin: top left` 天然「左上固定」。
- 視窗尺寸：main `win.setBounds({ x, y, width: Math.round(BASE_W * s), height: Math.round(BASE_H * s) })`，**x/y 不變**（左上固定）。`BASE_W=135`、`BASE_H=146`（= 現有 `PET_WIDTH/HEIGHT`）。
- renderer 套 `#pet` transform、main 管視窗尺寸；兩者用同一 scale 值同步。

## 4. 資料
`window-state.ts` `WindowState` 加 `scale: number`：
- `isValid`：`scale` 缺省或非數字 → 視為有效、載入時補 `1`（向後相容舊檔無 scale）。
- `migrateWindowStates`：保留 scale（缺→1，clamp 後）。
- `saveWindowState`：寫入含 scale。

## 5. 純函式（core，TDD）
新檔 `src/core/pet-scale.ts`：
- `MIN_SCALE=0.6`、`MAX_SCALE=2.0`
- `clampScale(raw: unknown): number` — 非數字 → 1；否則 clamp 到 [MIN,MAX]
- `scaleFromDrag(startScale: number, dx: number, dy: number, baseW: number, baseH: number): number` — 由把手位移算新 scale（用對角位移比例：`(dx/baseW + dy/baseH)/2` 疊加到 startScale），回傳 `clampScale`。

## 6. 把手互動
- `index.html`：`<div id="resize-handle" hidden></div>`（右下角）。
- `styles.css`：右下角小握把（如 12×12 斜紋/圓點），`pointer-events: auto`，預設 `hidden`；hover 寵物時顯示。
- `main.ts`（renderer）：
  - 沿用既有 `mouseenter/mouseleave`：進入顯示把手、離開隱藏（**拖曳中保持顯示**）。
  - 把手 `pointerdown` → 記 startScale + 起點；`pointermove`（拖曳中）→ `scaleFromDrag` 算新 scale → 即時套 `#pet` transform + 送 `set-scale {channelId, scale}`（節流，如每幀/每 50ms）→ main resize 視窗；`pointerup` → 送最終 `set-scale` + 結束。
  - 拖把手期間視窗需 interactive（沿用既有 `setInteractive` 機制，避免被點擊穿透吞掉 pointer 事件）。
- 初始 scale：main `createPetWindow` 用存檔 scale 建立 scaled 視窗；`did-finish-load` 推 `set-scale` 給 renderer 套初始 transform。

## 7. IPC（`contract.ts`）
- Commands 加：`'set-scale': { channelId: string; scale: number }`
- Pushes 加：`'set-scale': number`（main→renderer 初始/同步 scale）
- preload `petBridge`：`setScale(channelId, scale)`、`onSetScale(cb)`；`api.d.ts` 同步。

## 8. main（`window.ts` / `index.ts`）
- `window.ts createPetWindow(channelId, skin, index)`：建立時套用存檔 scale（視窗尺寸 = BASE × scale；`did-finish-load` 推 `set-scale`）。
- `handleCommand('set-scale', ({channelId, scale}))`：`s=clampScale(scale)`；`win.setBounds({ x, y, width: round(BASE_W*s), height: round(BASE_H*s) })`（x/y 取現有 bounds，左上固定）；`saveWindowState(dir, channelId, { displayId, x, y, scale: s })`；`bus.emit('pet-moved', channelId)`（連動卡片重定位）。
- 既有 drag-end 存檔也要帶上目前 scale（避免拖動後覆寫掉 scale）。

## 9. 連動
- **卡片**：`repositionCard` 用 `pet.getBounds()`（scaled），自動跟（已驗證 index.ts:161）。`set-scale` 後 emit `pet-moved` 觸發重定位。
- **badge（未讀紅點）**：`#badge` 是 `#pet` 兄弟、不受 `#pet` transform 影響。縮放後寵物右上角位置改變 → badge 需依 scale 調整定位（plan：badge 容器也套對應 transform-origin/scale，或定位用百分比跟視窗 resize 自然移動）。
- **堆疊**：維持 base 尺寸（非目標重算）。

## 10. 測試
**核心/單元（TDD）**：`pet-scale`（clampScale：非數字→1、超界 clamp、界內原樣；scaleFromDrag：放大/縮小/clamp）。`window-state`（含 scale 的 migrate/save/load round-trip + 舊檔無 scale→1）。
**探針（Playwright `_electron`）**：
1. 預置 window-state 某 channel scale=1.5 → 啟動該寵物視窗 bounds ≈ round(135×1.5)×round(146×1.5)、`#pet` transform scale(1.5)、左上座標不變。
2. 模擬 `set-scale` → 視窗 resize、x/y 不變、window-state.json 寫入 scale、卡片若顯示則跟著移動。
3. e2e SMOKE 不壞。

## 11. 風險
- 把手 pointer 事件 vs 點擊穿透：拖曳需視窗 interactive；確保把手 `pointer-events:auto` 且拖曳期間 `setInteractive(true)`。
- resize 即時同步閃爍：renderer 先套 transform（即時視覺）+ 送 command resize；節流避免過量 setBounds。
- scale 存檔與 drag-end 位置存檔共用 window-state key，避免互相覆寫（兩者都讀-改-寫完整 WindowState 含 scale）。
