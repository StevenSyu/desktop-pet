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

- `src/main/window.ts`：`PET_WIDTH 280→135`、`PET_HEIGHT 300→146`（= sprite 顯示尺寸 `ceil(192×0.7)=135` × `ceil(208×0.7)=146`）。
- `src/renderer/index.html`：移除 `#cards`；保留 `#pet`、`#badge`。
- `src/renderer/styles.css`：
  - `#pet` 改 **齊頂齊左**（`top:0; left:0`，移除 `right/bottom:8`），讓 sprite 頂端 = 視窗頂端，往上拖時 sprite 能貼到 `workArea.y`（**消除 Codex 指出的 ~2.4px 殘留 offset**）。
  - `#badge` 紅點疊在視窗**右上角內**（`top`/`right` 小位移），與 sprite 重疊不再依賴卡片區高度；移除 `#cards`／`.card*` 樣式（移到 `card.css`）。
- 縮小後寵物視窗無上方死空間 → 拖到主螢幕最上方 sprite 貼選單列下緣（收尾 #1）。`clampToValidPosition`（啟動）與 walk 既有邏輯沿用新尺寸（讀 `getSize()`，常數即新值）。
- **像素驗收**：拖到主螢幕最上方時 `getPosition().y ≈ workArea.y`、sprite 視覺貼選單列下緣。

## 5. 卡片視窗

### 5.1 `src/main/card-window.ts`
- `createCardWindow()`：frameless、transparent、resizable:false、skipTaskbar、alwaysOnTop('floating')、`hasShadow:false`。延遲建立、show/hide 復用（不每次 new）。
  - **不搶焦點但可點擊**：用 `showInactive()` 顯示（不 activate App、不搶 key focus），卡片仍接收滑鼠點擊。**不設** `focusable:false`（Codex 指出其僅改可聚焦性、與滑鼠命中無直接保證；`showInactive` 才是「不搶焦點」的正解）。實作驗收點擊有效，失效再評估 native panel。
  - **z-order**：兩個視窗都 `floating` 同層，z 序無保證。show/重定位後對 card window 呼叫 `moveTop()` 確保浮在寵物之上，並驗收 hover/drag 時不被蓋。
  - **跨 Spaces**：建立時呼叫一次 `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`（與 pet window 一致），避免反覆呼叫造成 macOS process-type 閃爍。
- 尺寸固定：`CARD_W 240`、`CARD_H 96`（與現有卡片 2 行截斷視覺一致；body 仍 2 行 clamp）。
- **窄版 preload**：card window 用獨立 `src/preload/card.ts`（→ `card.cjs`），只暴露 `onCardData(cb)` / `cardClicked()`；**不沿用** petBridge（避免卡片視窗拿到 walk/prefs/skin 等不需要的 API）。`electron.vite.config.ts` preload 段新增 card 入口。

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
  - Command `card-clicked`（payload `{ id }`）
- main → pet renderer：
  - Push `card-dismissed`（payload `{ id }`）——pet renderer 收到後**僅當 `id === currentEvent?.id`** 才 markRead + 清 currentEvent + refreshBadge（防舊卡片延遲 dismiss 誤標新訊息已讀，Codex must-fix #1）

**事件 id 防呆**：main 持有目前卡片的 `activeCardId`（最後一次 `show-card` 帶的 id）。`card-clicked` 進來時若 `id !== activeCardId` 則忽略（避免覆蓋後舊視窗殘留點擊）；轉送 `card-dismissed({ id })` 給 pet renderer 由其再比對 currentEvent。

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
- main 收 `show-card(cardView)`：若無 card window 則建立；記 `activeCardId = cardView.id`、`cardVisible=true`；`card-data` 推資料；`repositionCard()`；`showInactive()` + `moveTop()`。
- pet renderer 收 `onDndOn`：清 currentEvent、stopReplay、refreshBadge、`hide-card`。
- card 點擊：card renderer `card-clicked({ id })` → main（id 比對 activeCardId）hide card window、`cardVisible=false`、轉 `card-dismissed({ id })` 給 pet renderer。pet renderer 比對 currentEvent 後 markRead + 清 currentEvent + refreshBadge。
- 新事件覆蓋：pet renderer 再次 `show-card` → main 更新 activeCardId + card-data + repositionCard。
- **集中重定位 `repositionCard()`（Codex must-fix #2）**：main 端一個 helper——若 `cardVisible` 則讀寵物 `getBounds()` + 該 display workArea，算 `cardPosition` 並 `setPosition` 卡片視窗 + `moveTop()`。**所有會移動寵物的路徑結束後都呼叫它**：`drag-move`、`display-removed` 重吸附、`display-metrics-changed`（解析度/排列變更）。（walk step 不呼叫——有卡片時已暫停自走，見 §6；但 helper 本身對 walk 安全。）
- 關閉寵物時一併關 card window。

## 6. 走動暫停與中斷

- **暫停自走（有卡片不走）**：pet renderer 走動 gate 加條件 `&& !currentEvent`（`shouldWalkNow(...)` 為真且無 currentEvent 才 walkStart）。
- **hover 中斷走動**：pet renderer `petEl` 的 `mouseenter` → 若 `walking` 為真，立即 `window.petBridge.walkCancel()`（寵物停下、改播 hover 反應）。
- **點擊中斷走動**：pointerdown 已觸發 `drag-start → main endWalk`，走動即刻停止；本 spec 明確驗收此行為（不需改碼，已成立）。

## 7. 既有程式調整

**修改**
- `src/main/window.ts`：PET 尺寸常數（135×146）；`drag-move`、`display-removed`、`display-metrics-changed` 結束後呼叫集中 `repositionCard()`（cardVisible / card window ref 由 index.ts 持有，window.ts 經回呼或 bus 通知；見實作計畫）。
- `src/main/index.ts`：card window 生命週期（lazy 建立、showInactive/hide、moveTop）、`activeCardId` 狀態、`show-card`/`hide-card`/`card-clicked` handlers（id 比對）、轉送 `card-dismissed({ id })`、`repositionCard()` 協調、關窗清理。
- `src/renderer/main.ts`：移除 DOM 卡片渲染，改 `show-card(cardView)`/`hide-card` IPC；走動 gate 加 `!currentEvent`；`mouseenter` 走動中 `walkCancel`；onPetEvent / onDndOn / `onCardDismissed`（比對 currentEvent）改用 IPC。
- `src/renderer/index.html`：移除 `#cards`。
- `src/renderer/styles.css`：移除 `#cards`／`.card*` 樣式（移到 card.css）、`#pet` 齊頂齊左、`#badge` 改右上角定位。
- `src/ipc/contract.ts`：show-card(CardView) / hide-card / card-clicked({id}) / card-data(CardView) / card-dismissed({id})；新增 `CardView` 型別。
- `src/preload/index.ts` + `src/preload/api.d.ts`：pet renderer 端新增 `onCardDismissed`（show-card/hide-card 走既有 sendCommand）。
- `electron.vite.config.ts`：renderer 段新增 `card: 'src/renderer/card.html'` 入口；preload 段新增 `card: 'src/preload/card.ts'` 入口。

**新增**
- `src/main/card-window.ts`、`src/core/card-position.ts`、`src/renderer/card.html` / `card.ts` / `card.css`、`src/preload/card.ts`（窄版 bridge：`onCardData` / `cardClicked`）
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
8. **拖到主螢幕最上方 → 寵物 sprite 貼到選單列下緣（#1 收尾）**，像素確認 `getPosition().y ≈ workArea.y`。
9. 卡片點擊不搶焦點（`showInactive`）、且永遠浮在寵物之上（`moveTop`，hover/drag 時不被蓋）。
10. 縮窗後 hit-test：sprite / badge / 透明邊界各測 hover / click / drag 仍正常（穿透與互動切換不壞）。
11. display-removed（拔螢幕）/ 解析度變更時，卡片仍跟寵物對齊不分離。
12. 舊卡片延遲 dismiss：連發兩則事件後點舊卡 → 不誤標新訊息已讀（id 比對）。
13. 跨 Spaces / 全螢幕 App：pet 與 card 同時出現。
14. e2e：pet:// 與基本鏈路不壞。

## 9. v1 範圍 vs 之後

**v1**：卡片獨立視窗、寵物縮窗（#1 收尾）、上下方定位、跟隨拖動、走動暫停 + hover/click 中斷、徽章留寵物角落。

**之後**：點擊卡片顯示全部內容（展開卡片視窗或轉開通知中心）、卡片進出過場、走動中卡片跟隨。

## 10. 檔案清單

**新增**：`src/core/card-position.ts`(+test)、`src/main/card-window.ts`、`src/renderer/card.html`/`card.ts`/`card.css`、`src/preload/card.ts`
**修改**：`src/main/window.ts`、`src/main/index.ts`、`src/renderer/main.ts`、`src/renderer/index.html`、`src/renderer/styles.css`、`src/ipc/contract.ts`、`src/preload/index.ts`、`src/preload/api.d.ts`、`electron.vite.config.ts`
