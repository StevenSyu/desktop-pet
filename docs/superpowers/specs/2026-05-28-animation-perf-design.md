# 動畫與效能 — 設計文件

- 日期：2026-05-28
- 狀態：設計定案（待使用者最終審閱 → 進入實作計畫）
- 範圍代號：Spec ③（前為 ② 視窗行為）

---

## 1. 定位與動機

目前動畫由 renderer 的 `requestAnimationFrame` 每幀計算 sprite 的 `background-position`：螢幕焦點不在 may、被別 App 全螢幕遮住、甚至 macOS 進入鎖屏，rAF 雖會被 Chromium 節流但仍持續耗電。idle 狀態下寵物完全不動，畫面活潑度也差。

本 spec 處理兩件事：A2 idle 走動動畫（活潑度），D1 rAF→CSS + 視窗不可見時暫停（效能/耗電）。

## 2. 範圍

**目標（v1）**
- idle 期間每 30–90 秒隨機觸發一次小走動（左或右），距離 60–200px，總長 1.5–3 秒；同步播放 `running-left` / `running-right` 動畫格。
- 走動會被任何非 idle 事件即時中斷（回該事件對應動畫，視窗停在當下位置）。
- 走動不出工作區邊界；接近邊緣自動反向或縮短距離。
- 走動是「會話內行為」，不寫進 `window-state.json`——重啟仍回最後一次拖動位置。
- sprite 影格切換從 rAF 推 `background-position` 改為 CSS `@keyframes` + `steps()`；JS 只切 class。
- `document.hidden` 為 true、或視窗 `blur`/不可見時，CSS 動畫 `animation-play-state: paused`、FSM 輪詢 setInterval 也暫停。

**非目標（v1，延後）**
- 走動腳步音、跳起、轉身過場。
- 路徑規劃（迴避 dock、貼邊、貼到視窗邊…）。
- 拖動完成後重啟也記得「最後走到哪」。
- 多隻寵物互動。

## 3. idle 走動（A2）

**觸發**
- renderer 維護 `nextWalkAt`（performance.now() + 30000–90000ms 內隨機）。
- FSM 輪詢時若 `view.animation === 'idle'` 且 `now >= nextWalkAt` 且當前沒被反應動畫中佔用 → 啟動 walk session。
- 任何 `pet.onEvent(...)` 進入時，若 walk 中則立即取消（renderer 把走動狀態清掉、停止位置推送、CSS class 切到對應反應動畫；視窗停留在當下位置）。

**訊號流**
```
renderer (idle 中, 達 nextWalkAt):
  rand direction ∈ {left, right}, distance ∈ [60, 200]px, duration ∈ [1500, 3000]ms
  → IPC 'walk-start' { direction, distance, duration }
  切 CSS class 為 pet-anim-running-left / pet-anim-running-right

main:
  收到 walk-start → 取 win.getPosition() 與當前 display workArea
  夾住：若 newX 會超出 workArea，截斷 distance（或翻轉方向 / 直接放棄）
  以 setInterval(16ms) 推進 setPosition(currentX ± step, y)
  到 duration 結束 → 自己停下、發送 'walk-end' 給 renderer

renderer (走動進行中):
  若收到 onPetEvent / 使用者開始拖動 → IPC 'walk-cancel' → main 立刻停推位置
  收到 'walk-end' 或 'walk-cancelled' → 切回 idle class、重排下次 nextWalkAt

main (拖動期間):
  drag-start 也對 walk session 取消（與 walk-cancel 同路徑）
```

**取消保證**
- 「事件中斷」「使用者拖動」「視窗不可見」三條都會立即取消走動。
- 走動取消 = 視窗保持在當下位置，不回起點。

## 4. CSS-only 影格切換（D1 之一）

**現況**：renderer rAF 每幀呼叫 `pet.advance(now)`，依 `anim.fps * frame` 計算 `background-position`。

**新做法**：
- 為 9 個動畫各寫一個 `@keyframes`，`background-position-x` 從 `0` 走到 `-${frames * frameWidth * DISPLAY_SCALE}px`，`animation-timing-function: steps(N)`、`animation-duration: ${frames / fps}s`。
- `loop:true` → `animation-iteration-count: infinite`；`loop:false` → `forwards` + JS 在 hold 結束前切回 idle class（FSM 仍負責 3s 持續循環的反應 → 對 loop:false 動畫用 `infinite` 也行，反正會被 advance 切走）。
- 動畫之間切換：JS 把 `#pet` 的 `data-anim` 屬性改成新動畫名（CSS 用 `[data-anim="..."]` 選擇器套對應 `@keyframes`）。
- 走動方向也用 data-anim 區分（`running-left` / `running-right`）。

**為什麼資料屬性而非 class**
- 多個 class 容易殘留；單一 `data-anim` 屬性語意清楚、易切換。

**FSM 輪詢頻率**
- 不再 rAF（60Hz）；改 `setInterval(100ms)`。advance() 僅在 idle/反應 hold 結束時改變回傳的動畫名，100ms 解析度足夠（人眼感不到）。
- 走動觸發判斷也搭這個輪詢做。

## 5. 不可見時暫停（D1 之二）

**事件**
- `document.addEventListener('visibilitychange', ...)` → `document.hidden`：暫停。
- `window.addEventListener('blur'/'focus', ...)`：作為輔助訊號（不可靠，但失焦時通常被別 App 遮蓋）。

**暫停內容**
- CSS：`#pet[data-paused] { animation-play-state: paused; }`。
- JS：`setInterval` 清掉，恢復可見時再 setInterval；走動若正在進行 → 觸發 walk-cancel。

**復原**
- `visibilitychange` 變回 visible → 移除 `data-paused`、重啟輪詢、重排下次 `nextWalkAt`。

**注意：浮動視窗在被全螢幕 App 蓋住時 macOS 會送什麼？**
- 經 floating level 行為，pet window 在別 App 全螢幕時會被系統隱藏 → `BrowserWindow.isVisible()` 為 false、renderer 端會收 `visibilitychange` 為 hidden（webContents 跟著被掛起）。可實機驗證後再決定要不要加 main 端 explicit 通知。

## 6. 架構與檔案

**新增**
- `src/core/walk-planner.ts`（純函式，可測）
  - `pickWalk(rng, now, lastWalkEndedAt)` → `{ direction: 'left'|'right', distance: number, duration: number, nextWalkAt: number }`。
  - `clampWalkToWorkArea(start, direction, distance, workArea, petWidth)` → 截斷後的 `distance`（可為 0 表示不走）。

**修改**
- `src/renderer/main.ts`：
  - 移除 `requestAnimationFrame(render)` 與每幀 `backgroundPosition` 寫入。
  - 改 `setInterval(advance, 100)` + 切 `#pet` 的 `data-anim`。
  - 加 walk 觸發邏輯：idle 時 `now >= nextWalkAt` → IPC walk-start；事件中斷 → walk-cancel。
  - `visibilitychange` → 暫停/恢復。
- `src/renderer/index.html`：`#pet` 不再用 inline `background-position`，改用 CSS。
- `src/renderer/styles.css`：加 9 個 `@keyframes` 與 `[data-anim="..."]` 規則；`data-paused` 暫停規則。
- `src/main/window.ts`：
  - 加 `walk-start` / `walk-cancel` IPC handler；維持單一 walkTimer 變數，重入時先 cancel 再 start。
  - walk 結束送 `walk-end`，cancel 送 `walk-cancelled`（renderer 共用同一個重排邏輯）。
  - drag-start 自動取消正在進行的 walk。
- `src/preload/index.ts` + `api.d.ts`：暴露 `walkStart({direction, distance, duration})`, `walkCancel()`, `onWalkEnded(cb)`（end/cancelled 都觸發 cb）。

## 7. 測試策略

**核心 TDD**（`src/core/walk-planner.ts`）
- `pickWalk` 用注入 rng，給定 seed → 回固定的方向/距離/duration、nextWalkAt 在合理範圍。
- `clampWalkToWorkArea`：
  - 走動會出 workArea 右界 → 截短到剛好不出界。
  - 走動完全出界 → 回 distance=0。
  - 走動在 workArea 中間 → 不變。

**整合驗證**（手動 + Playwright）
- idle 一段時間（手動把 `nextWalkAt` 觸發時間調小做 dev 模式測試）→ 應看到 may 左/右走動，走完回原地（其實是新位置）。
- 走動中 POST 一個 `done` 事件 → may 應立即停下、切到 jumping、卡片彈出。
- 走動中拖動 may → walk 應立即取消，視窗跟著游標走。
- 切到其他 App 進 macOS 全螢幕 → may 應消失（既有 floating 行為），切回桌面 → idle 動畫繼續、輪詢恢復。
- Playwright 截圖驗證 `data-anim` 切換時 `background-position` 來自 CSS keyframe 而非 inline style。

## 8. v1 範圍 vs 之後

**v1**：idle 走動觸發/中斷/邊界、CSS-only 影格切換、不可見時暫停。

**之後**：
- 走動腳步音、走前抬頭看／走後伸懶腰過場動畫。
- 智慧路徑（避 dock、視窗邊緣磁吸）。
- 拖動之外也保存走動最終位置（需配套 UI 避免使用者「我的寵物自己跑掉了」困惑）。
- 鼠標 hover 寵物時暫停走動（已 hover 就回去）。

## 9. 待確認/未決（進實作計畫前）

1. idle 走動間隔 30–90 秒、距離 60–200px、duration 1.5–3 秒——數字可調。
2. CSS `@keyframes` 重複 9 份還是用 CSS 變數參數化（CSS 變數無法插值 keyframe stop，所以仍要 9 份；但可用 PostCSS 或 Vite 模版產生——v1 先手寫 9 個）。
3. FSM 輪詢頻率 100ms 是否足夠（反應動畫 hold 3 秒，100ms 切換感無感）。
4. main 端 walk loop 用 `setInterval(16ms)` 或 `setTimeout` 鏈式（後者抗時鐘漂移更好），實作時擇一。
