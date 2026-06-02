# 多寵物 子專案 B2：每寵物即時卡片 + 位置記憶 設計文件

- 日期：2026-06-02
- 狀態：設計定案（自走：直接進 writing-plans）
- 範圍代號：多寵物 子專案 B2（接續 B1）

---

## 1. 定位與動機

B1 讓每個啟用 channel + 「全部」各一隻寵物（各自造型/反應/紅點、可拖、點寵物開分頁）。B1 邊界：**只有「全部」寵物顯示即時卡片**、channel 寵物拖曳位置不持久化。B2 補上這兩塊：
- **每寵物自己的即時卡片視窗**：channel 寵物收到事件也彈自己的卡片（在它旁邊），多寵物可同時各自顯示。
- **每頻道拖曳位置持久化**：拖過的寵物位置跨重啟記住。

本質是「把 B1 對 pet 視窗做的多實例化，套用到 card 視窗 + window-state」。

## 2. 範圍

**目標（B2）**
- card 視窗單一 → **per-pet（`Map<channelId, cardWindow>`）**；每隻寵物的事件彈自己的卡片，定位在該寵物旁。
- card 視窗以 URL `?c=<channelId>` 辨識身分；卡片命令（show-card/hide-card/card-clicked/card-more）帶 channelId。
- 移除 B1 的「卡片只在『全部』」gate：**所有寵物都顯示卡片**。
- 卡片點擊/更多 → 對正確的 pet renderer 清狀態（card-dismissed 帶 channelId 路由回對應寵物）；card-more 開中心該則詳情 + 該頻道分頁。
- **每頻道位置持久化**：`window-state.json` 單一 → keyed map（`{ [channelId]: WindowState }`，向後相容舊單一檔→視為 `'all'`）；`createPetWindow` 有存檔用存檔、否則 stack；channel 寵物 drag-end 也存。

**非目標**
- 卡片進出過場大改、channel 寵物 hover 反應差異化（之後）。
- 多事件佇列（同一寵物快速多事件仍是後者覆蓋前者，沿用單卡片行為）。

## 3. per-pet 卡片視窗

- `index.ts`：`cardWindow: BrowserWindow|null` → `cardWindows: Map<channelId, BrowserWindow>`（+ 各自 `cardLoaded`/`pendingCard`/`activeCardId` 改為 per-channel map）。
- `createCardWindow(channelId)`：載入 `card.html?c=<channelId>`（card preload 不變）。
- show-card 命令帶 channelId（pet renderer 送自己的 myChannel）：main ensure 該 channel 的 card window、推 card-data、定位在 `getPetWindow(channelId)` 旁（沿用 `cardPosition`）、showInactive + moveTop。
- card renderer（`card.ts`）讀 `?c=`，`cardClicked`/`cardMore` 帶 channelId。
- card-clicked({channelId,id})：main hide 該 card window、`card-dismissed({id})` 推回 `getPetWindow(channelId)`（該寵物 renderer 清 currentEvent + markRead）。
- card-more({channelId,id})：同上 + `openCenter(channelId)` 帶 pendingDetail（開中心該則詳情 + 該頻道分頁）。
- 拖動寵物時（drag-move）：若該寵物有可見 card window → 重定位它（`reposition` 改 per-channel；B1 只重定位 'all' 卡片，B2 每隻各自）。

## 4. renderer（main.ts）調整

- 移除 B1 的 `if (isAllPet)` 卡片 gate：onPetEvent 一律 `currentEvent=event; showCard(buildCardView(event)); startReplay; refreshBadge`（所有寵物都有卡片）。`showCard`/`hideCard` 帶 myChannel。
- 自走仍只 `isAllPet`（B1 不變，channel 寵物不自走）。
- onCardDismissed / onDndOn 不變（per renderer 已各自）。

## 5. 每頻道位置持久化

- `window-state.ts`：`WindowState` 不變；檔案格式改 `Record<string, WindowState>`（key=channelId）。`loadWindowStates(dir) → Record<channelId, WindowState>`、`saveWindowState(dir, channelId, state)`（讀-改-寫該 key）。**向後相容**：舊檔是單一 `{displayId,x,y}` → 載入時視為 `{ all: 該物件 }`。
- `window.ts createPetWindow(channelId, skin, index)`：位置 = `savedStates[channelId]`（驗證在某 display workArea 內）若有 → 用之；否則 `stackPosition(index,…)`（channel）或 `clampToValidPosition`（all，沿用）。
- drag-end：`saveWindowState(dir, channelId, {displayId,x,y})`（每隻都存，不再限 'all'）。
- display-removed 重吸附後：更新該 channel 的存檔（或下次啟動重 stack）—— B2 簡化：重吸附只改視窗位置，不寫檔（下次拖才存）。

## 6. IPC 變更（`src/ipc/contract.ts`）

Commands 加/改 channelId：
- `show-card`: `{ channelId: string; view: CardView }`（原 `CardView`）
- `hide-card`: `{ channelId: string }`（原 void）
- `card-clicked`: `{ channelId: string; id: string }`（原 `{id}`）
- `card-more`: `{ channelId: string; id: string }`（原 `{id}`）

Pushes：`card-data`/`card-dismissed`/`open-detail` 不變（main `pushTo` 對特定視窗）。

preload：`cardBridge.cardClicked(id)`/`cardMore(id)` → 由 card renderer 帶自己的 channelId（card.ts 讀 `?c=`）：`cardClicked(channelId,id)`/`cardMore(channelId,id)`。`petBridge.showCard/hideCard` 加 channelId。`api.d.ts` 同步。

## 7. 既有程式調整 / 檔案清單

**修改**
- `src/main/window-state.ts`（單→keyed map + 向後相容 + per-channel save）
- `src/main/window.ts`（createPetWindow 用 per-channel 存檔位置、drag-end 每隻存）
- `src/main/card-window.ts`（`createCardWindow(channelId)` 載入帶 `?c=`）
- `src/main/index.ts`（cardWindows Map、show-card/hide-card/card-clicked/card-more per-channel、card 定位 per pet、drag-move 重定位各自卡片、card-more 開該頻道分頁）
- `src/ipc/contract.ts`（卡片命令加 channelId）
- `src/preload/index.ts` + `card.ts` + `api.d.ts`（showCard/hideCard/cardClicked/cardMore 帶 channelId）
- `src/renderer/main.ts`（移除卡片 gate、showCard/hideCard 帶 myChannel）
- `src/renderer/card.ts`（讀 `?c=`、cardClicked/cardMore 帶 channelId）

**新增（測試）**：`tests/main/window-state.test.ts` 補 keyed map + 向後相容（若已有則擴充）；或純函式化 window-state 的 migrate 邏輯 + 測試。

## 8. 測試策略

**核心 / 單元**：window-state 向後相容（舊單一檔→`{all:…}`）、keyed save/load round-trip（可純函式化 `migrateWindowStates(raw)` 測）。
**整合 / 手動 / 探針**：
1. 啟用 2 channel → 發 projA 事件 → 「全部」+ 專案A 寵物**各自彈卡片**（在各自旁邊），專案B 不彈。
2. 同時發 projA、projB → 兩隻 channel 寵物 + 全部 各自卡片同時顯示。
3. 點某 channel 寵物卡片本體 → 開中心該則詳情 + 切到該頻道分頁；✕ 關該卡片。
4. 拖某 channel 寵物 → 它的卡片跟著移動；重啟後該寵物回到拖過的位置。
5. e2e：既有單寵物鏈路不壞。

## 9. 風險 / 註記
- 視窗數量：N 寵物 + N 卡片 + 中心。多 channel 時視窗多，但延遲建立（show 時才建 card window）、hide 復用，可接受。
- card-more 的 `openCenter(channelId)` 同時帶 pendingDetail + pendingChannelTab —— 兩個 pending 機制並存（B1 已有 pending-detail、pending-channel-tab），確保不互卡（各自 query 清除）。
