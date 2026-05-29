# 即時卡片獨立視窗 — 設計文件

- 日期：2026-05-29
- 狀態：設計定案（待使用者最終審閱 → 進入實作計畫）
- 範圍代號：Spec ⑦（前為 ⑥ 造型掃描與選擇 UI）

---

## 1. 定位與動機

目前即時卡片與徽章和寵物 sprite 擠在同一個 280×300 視窗裡，卡片區佔據 sprite 上方約 150px 透明空間。這造成 [issue #1](https://github.com/StevenSyu/desktop-pet/issues/1) 的殘留問題：往主螢幕最上方拖時，視窗頂端（空白卡片區）先撞到選單列，寵物 sprite 無法貼到頂。

本 spec 把即時卡片抽成**獨立浮動小視窗**、寵物視窗縮成只包 sprite。順帶：
- 寵物可拖到主螢幕最上方、sprite 貼選單列下緣（收尾 #1）。
- 為未來「點擊卡片顯示全部內容」鋪路（卡片有了自己的視窗，易於擴充）。
- 新增「走動中被 hover / 點擊立即中斷走動」。

## 2. 範圍

**目標（v1）**
- 寵物視窗縮成 sprite 大小（含徽章紅點空間）。
- 即時卡片獨立成浮動視窗，浮在寵物上方（上方不夠改下方），跟著寵物移動。
- 走動中出現卡片 → 暫停自走；走動中被 hover / 點擊 → 立即中斷走動。
- 卡片點擊維持現行（標已讀 + 關閉）。
- 徽章紅點留在寵物視窗角落。

**非目標（v1，延後）**
- 「點擊卡片顯示全部內容」的展開 UI（僅鋪路，不實作）。
- 走動中卡片逐幀跟隨（已決定走動時不顯示移動中的卡片——有卡片就暫停走動）。
- 卡片進出動畫的大改（沿用現有 cardIn 彈入）。

## 3. 架構

採「卡片獨立 BrowserWindow + main 定位 + pet renderer 仍是大腦」。
（考慮並否決：B 動態改寵物視窗高度——會讓貼頂問題回來、resize 卡頓；C 全螢幕透明 overlay——click-through 複雜。）

- **pet renderer = 大腦**：維持 `currentEvent`、replay、徽章、互動 reducer、走動觸發；**不再用 DOM 畫卡片**，改發 IPC 請 main 顯示/隱藏卡片視窗。
- **card window = 純顯示**：新 `card.html` / `card.ts` / `card.css`，收 main 推來的卡片資料渲染，點擊 → 回 main。
- **main = 視窗定位膠水**：持有 card window 生命週期，依寵物視窗 bounds 定位卡片（上方／下方），拖動時若卡片開著一起重定位。

## 4. 寵物視窗縮小

- `src/main/window.ts`：`PET_WIDTH 280→140`、`PET_HEIGHT 300→156`（sprite 顯示尺寸 134×146 + 徽章紅點溢出餘裕）。
- `src/renderer/index.html`：移除 `#cards`；保留 `#pet`、`#badge`。
- `src/renderer/styles.css`：`#pet` 仍 `right/bottom` 貼視窗；`#badge` 紅點移到視窗右上角（`top`/`right` 定位），不再依賴卡片區高度（移除 `#cards` 相關樣式）。
- 縮小後寵物視窗無上方死空間 → 拖到主螢幕最上方 sprite 貼選單列下緣（收尾 #1）。`clampToValidPosition`（啟動）與 walk 既有邏輯沿用新尺寸（讀 `getSize()`，常數即新值）。

## 5. 卡片視窗

### 5.1 `src/main/card-window.ts`
- `createCardWindow()`：frameless、transparent、resizable:false、skipTaskbar、alwaysOnTop('floating')、`hasShadow:false`、`focusable:false`（不搶焦點，但仍可點擊——macOS 上 `focusable:false` 視窗仍接收滑鼠點擊）。延遲建立、show/hide 復用（不每次 new）。
- 尺寸固定：`CARD_W 240`、`CARD_H 96`（與現有卡片 2 行截斷視覺一致；body 仍 2 行 clamp）。

### 5.2 定位（純函式，可測）
- `src/core/card-position.ts`：
  ```ts
  export interface Rect { x: number; y: number; width: number; height: number }
  export function cardPosition(
    pet: Rect,            // 寵物視窗 bounds
    card: { width: number; height: number },
    workArea: Rect,       // 寵物所在 display 的 workArea
    gap: number,          // 卡片與寵物間距
  ): { x: number; y: number }
  ```
  - 右對齊寵物：`x = pet.x + pet.width - card.width`，再夾進 workArea 水平範圍。
  - 預設上方：`y = pet.y - card.height - gap`；若 `y < workArea.y` → 改下方 `y = pet.y + pet.height + gap`。
- main 用寵物所在 display（`screen.getDisplayMatching(petBounds)`）的 workArea 餵入。

### 5.3 IPC（走既有 contract）
- pet renderer → main：
  - Command `show-card`（payload：要顯示的事件資料，型別見下）
  - Command `hide-card`（void）
- main → card renderer：
  - Push `card-data`（事件資料）
- card renderer → main：
  - Command `card-clicked`（void）
- main → pet renderer：
  - Push `card-dismissed`（void）——pet renderer 收到後 markRead + 清 currentEvent + 送 hide-card + refreshBadge

卡片資料型別（contract 用）：沿用既有事件顯示欄位，定義
```ts
interface CardView {
  id: string
  type: NotifyType
  label: string        // 由 type 對應（done→完成…），pet renderer 端算好傳入
  body: string         // 已 stripMarkdown
  source: string       // title || source.name || source.kind（含 session 短碼）
}
```
（pet renderer 已有 LABEL、stripMarkdown、source/session 組裝邏輯，組好 CardView 傳給 main → card renderer，card renderer 純顯示，不需再 import core。）

### 5.4 生命週期與定位流程
- pet renderer 收 `onPetEvent`：照常 applyEvent（sprite 反應）、設 currentEvent、startReplay、refreshBadge、清互動狀態；**改為** `show-card(cardView)`（取代原 renderCard DOM）。
- main 收 `show-card`：若無 card window 則建立；`card-data` 推資料；依 `cardPosition(petBounds, {CARD_W,CARD_H}, workArea, gap)` setPosition；show。記 `cardVisible=true`。
- pet renderer 收 `onDndOn`：清 currentEvent、stopReplay、refreshBadge、`hide-card`。
- card 點擊：card renderer `card-clicked` → main 轉 `card-dismissed` 給 pet renderer + hide card window、`cardVisible=false`。pet renderer markRead + 清 currentEvent + refreshBadge。
- 新事件覆蓋：pet renderer 再次 `show-card` → main 更新 card-data + 重定位。
- 拖動：main `drag-move` 時若 `cardVisible` → 依新 petBounds 重新 `cardPosition` 並 setPosition 卡片視窗。
- 關閉寵物時一併關 card window。

## 6. 走動暫停與中斷

- **暫停自走（有卡片不走）**：pet renderer 走動 gate 加條件 `&& !currentEvent`（`shouldWalkNow(...)` 為真且無 currentEvent 才 walkStart）。
- **hover 中斷走動**：pet renderer `petEl` 的 `mouseenter` → 若 `walking` 為真，立即 `window.petBridge.walkCancel()`（寵物停下、改播 hover 反應）。
- **點擊中斷走動**：pointerdown 已觸發 `drag-start → main endWalk`，走動即刻停止；本 spec 明確驗收此行為（不需改碼，已成立）。

## 7. 既有程式調整

**修改**
- `src/main/window.ts`：PET 尺寸常數；`drag-move` 拖動時若卡片開著重定位卡片視窗（需可查詢 cardVisible / card window ref——由 index.ts 持有，window.ts 經回呼或 bus 通知；見實作計畫）。
- `src/main/index.ts`：card window 生命週期（lazy 建立、show/hide）、`show-card`/`hide-card`/`card-clicked` handlers、轉送 `card-dismissed`、關窗清理；拖動重定位的協調（main 端集中）。
- `src/renderer/main.ts`：移除 DOM 卡片渲染，改 `show-card`/`hide-card` IPC；走動 gate 加 `!currentEvent`；`mouseenter` 走動中 `walkCancel`；onPetEvent / onDndOn / 卡片關閉路徑改用 IPC。
- `src/renderer/index.html`：移除 `#cards`。
- `src/renderer/styles.css`：移除 `#cards`／`.card*` 樣式（移到 card.css）、`#badge` 改右上角定位。
- `src/ipc/contract.ts` + `preload`：show-card / hide-card / card-clicked / card-data / card-dismissed。
- `electron.vite.config.ts`：新增 `card: 'src/renderer/card.html'` 入口。

**新增**
- `src/main/card-window.ts`、`src/core/card-position.ts`、`src/renderer/card.html` / `card.ts` / `card.css`
- 測試：`tests/core/card-position.test.ts`

## 8. 測試策略

**核心 TDD**
- `card-position.ts`：上方有空間 → 上方、右對齊；上方不足（寵物貼頂）→ 下方；水平超出 workArea → 夾邊；第二螢幕（負原點）座標正確。

**整合 / 手動驗收**
1. 發 notify → 卡片浮在寵物上方、內容正確（label/body/source）。
2. 拖動寵物（卡片開著）→ 卡片跟著移動、上下方自動切換。
3. 寵物拖到該螢幕最上方 → 卡片改浮下方。
4. 點卡片 → 關閉並標已讀、徽章更新。
5. 有卡片時 → 寵物不自走。
6. 走動中 hover → 立即停走動並揮手；走動中點擊 → 立即停。
7. DND → 不顯示卡片（訊息仍進歷史 + 紅點）。
8. **拖到主螢幕最上方 → 寵物 sprite 貼到選單列下緣（#1 收尾）**。
9. e2e：pet:// 與基本鏈路不壞。

## 9. v1 範圍 vs 之後

**v1**：卡片獨立視窗、寵物縮窗（#1 收尾）、上下方定位、跟隨拖動、走動暫停 + hover/click 中斷、徽章留寵物角落。

**之後**：點擊卡片顯示全部內容（展開卡片視窗或轉開通知中心）、卡片進出過場、走動中卡片跟隨。

## 10. 檔案清單

**新增**：`src/core/card-position.ts`(+test)、`src/main/card-window.ts`、`src/renderer/card.html`/`card.ts`/`card.css`
**修改**：`src/main/window.ts`、`src/main/index.ts`、`src/renderer/main.ts`、`src/renderer/index.html`、`src/renderer/styles.css`、`src/ipc/contract.ts`、`src/preload/index.ts`、`src/preload/api.d.ts`、`electron.vite.config.ts`
