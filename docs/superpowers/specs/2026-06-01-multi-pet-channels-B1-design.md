# 多寵物 子專案 B1：多寵物核心 設計文件

- 日期：2026-06-01
- 狀態：設計定案（待使用者最終審閱 → writing-plans）
- 範圍代號：多寵物 子專案 B1（B2 = 每寵物即時卡片 + 位置記憶 + 點寵物開中心，另案）

---

## 1. 定位與動機

A 已把通知分成可重疊的「頻道（group）」+ 通知中心分頁。B1 讓**每個啟用的 channel + 「全部」各長出一隻寵物視窗**，各自造型、各自反應事件、各自未讀紅點。channel 寵物**簡化**（不自走），「全部」維持完整行為。**B1 不做 per-pet 即時卡片**（channel 寵物只演反應動畫 + 紅點；卡片留 B2）。

決策（brainstorm）：
- channel 寵物簡化（有造型/反應動畫/紅點/可拖，**不自走**）；「全部」完整（走動/拖動/hover/卡片）。
- 訊息反應：**「全部」反應所有訊息 + 命中的 channel 寵物各自反應**（多屬來源 → 多隻都跳）；嫌吵用 `allEnabled` 關「全部」那隻。
- 初始擺放：從「全部」向左依序排開、可拖；**B1 不持久化位置**（重啟回堆疊，記憶留 B2）。

## 2. 範圍

**目標（B1）**
- 每啟用 channel + （`allEnabled` 時）「全部」各一隻寵物視窗，各自造型。
- 多寵物 IPC 路由（per-pet 命令帶 `channelId`）。
- `pet-event` 依命中路由到各寵物 → 反應動畫。
- 每寵物未讀紅點（該 channel 未讀數）。
- 生命週期 reconcile：啟用→生、停用/刪→收、`allEnabled`→「全部」。
- 初始向左堆疊定位（純函式）；channel 寵物可拖（不自走）。
- `window.ts` 由單寵物重構為多寵物管理。

**非目標（B1，→ B2）**
- per-pet 即時卡片視窗（channel 寵物先只有反應動畫 + 紅點）。
- 拖曳位置跨重啟持久化。
- 點寵物開通知中心對應分頁。
- channel 寵物自走 / hover 反應池差異化。

## 3. 身分與路由（核心）

所有寵物共用同一份 renderer（`index.html` / `main.ts`）。每隻寵物視窗載入時帶 **URL query `?c=<channelId>`**（`'all'` = 全部）：
- renderer 從 `location.search` 解出 `myChannel`。
- **gate 自走**：只有 `myChannel === 'all'` 跑自走 tick；channel 寵物不自走（其餘反應/拖動/hover 照常）。
- **per-pet 命令帶 channelId**：renderer 送 `set-interactive` / `drag-start` / `drag-move` / `drag-end` / `walk-start` / `walk-cancel` 時帶 `myChannel`；main 用它操作 `Map<channelId, petWindow>` 對應視窗（每隻自己的 grabOffset / walk 狀態）。
- main→renderer 的 push（`set-skin` / `unread-count` / `pet-event` / `walk-ended` / `walk-direction` / `auto-walk-changed` / `prefs-changed` / `dnd-on` / `dnd-changed`）一律 `pushTo(該視窗)`，**不改 payload**。

> 替代方案（否決）：main 用 `event.sender` 反查 channelId。但 renderer 本就需要知道自己身分來 gate 自走，故直接帶 channelId 較直接、且 typed contract 明確。

## 4. 視窗生成 / 回收（reconcile）

- main 維護 `petWindows: Map<channelId, BrowserWindow>`。
- `reconcilePets()`：算出「應存在的集合」= `(allEnabled ? ['all'] : [])` ∪ 啟用 channel 的 id。
  - 集合內、Map 無 → `createPetWindow(channelId)`。
  - Map 內、集合無 → 關閉該視窗 + 從 Map 移除。
- 觸發：app 啟動、`channel-upsert`/`channel-delete` 後（channels 變動）、`set-all-enabled` 後。
- **不變量：reconcile 後至少留 1 隻寵物**。若計算出的集合為空（`allEnabled=false` 且無啟用 channel）→ **強制保留「全部」寵物**。否則零寵物 = 沒有任何寵物可右鍵 = 開不了「頻道…」重新啟用 = 卡死。
- **右鍵選單為全域**：任一寵物右鍵都叫出同一份選單（更換造型/頻道…/自動走動/勿擾/進階設定/通知中心/關閉）；操作的是全域 prefs。「更換造型」改的是 `prefs.skin`（=「全部」寵物造型）；channel 寵物造型在「頻道…」視窗改。
- `createPetWindow(channelId)` 載入 `index.html?c=<channelId>`；`did-finish-load` 後 push 該寵物的 `set-skin`（`'all'`→`prefs.skin`；channel→該 channel.skin，失效退回 DEFAULT）。

## 5. 造型 / 未讀（per-pet）

- 造型：`set-skin` push 給各視窗（`'all'`=`prefs.skin`、channel=該 channel.skin）。更換造型選單仍改 `prefs.skin` → 只 push 給 `'all'`；channel 造型在頻道管理視窗改 → channel-upsert → reconcile/重 push 該寵物。
- 未讀：用 `unreadByChannel(messages, channels)` 算，push `unread-count` 給各視窗（`'all'`=總未讀、channel=該 channel 未讀）。事件進來 / mark-read / clear 後重算重推。

## 6. 事件反應路由

ingest `onEvent`：`store.push` → 算 `targets = (allEnabled ? ['all'] : []) ∪ matchingChannels(event.source, channels)` → 對每個 target 的視窗 `pushTo(win, 'pet-event', event)`（DND 時全部跳過，比照現行）→ 各 renderer 演反應動畫。未讀重推。

## 7. 定位

- 純函式 `src/core/pet-layout.ts`：`stackPosition(index, petSize, workArea, margin, gap) → {x,y}`：`'all'` 為 index 0（右下角，沿用既有 defaultPosition）；channel 寵物 index 1,2,… 向左 `index×(寬+gap)`，夾進 workArea。
- reconcile 生新視窗時給堆疊位（index 依穩定順序：`'all'` 先、channel 依 channels 陣列序）。
- channel 寵物可拖（drag 命令帶 channelId → main 移該視窗）。**B1 不持久化**（重啟重新堆疊）；「全部」沿用既有 window-state。

## 8. window.ts 重構（單 → 多）

- `petWinRef: BrowserWindow | null` → `petWindows: Map<channelId, BrowserWindow>`；`getSkinSheetPath` 等不變。
- drag 狀態 `dragGrabOffset` → `Map<channelId, offset>`；walk 狀態（`WalkSession`/timer）只給 `'all'`（channel 不自走，main 也不接受非 'all' 的 walk-start，多一層保險）。
- handlers 仍註冊一次（`handlersRegistered`），但每個 per-pet 命令用 payload 的 channelId 取 `petWindows.get(channelId)` 操作。
- `set-interactive`：對該 channelId 視窗 `setIgnoreMouseEvents`。
- `display-removed`：對所有寵物各自重吸附（沿用邏輯，逐視窗）。
- `createPetWindow(channelId)` 取代原 `createPetWindow()`；`index.ts` reconcile 呼叫。

## 9. IPC 變更（`src/ipc/contract.ts`）

Commands 加 `channelId`（每個 per-pet 命令；payload 由原值改為含 channelId 的物件）：
- `set-interactive`: `{ channelId: string; interactive: boolean }`
- `drag-start` / `drag-move`: `{ channelId: string; sx: number; sy: number }`
- `drag-end` / `walk-cancel`: `{ channelId: string }`
- `walk-start`: `{ channelId: string; direction; distance; duration }`

preload `petBridge`：上述方法簽名加 `channelId`（renderer 傳 `myChannel`）。`api.d.ts` 同步。

> 註：`show-context-menu` / `open-center` 等非 per-pet 行為命令不變（仍全域）。右鍵選單由任一寵物觸發皆可（選單操作的是全域 prefs / 開中心）。

## 10. 既有程式調整 / 檔案清單

**新增**：`src/core/pet-layout.ts`（+ `tests/core/pet-layout.test.ts`）
**修改**：
- `src/main/window.ts`（單→多寵物管理、createPetWindow(channelId)、per-pet drag/hover、walk 限 all、reconcile 用的匯出）
- `src/main/index.ts`（`reconcilePets`、pet-event 路由到多寵物、unread per-pet、reconcile 觸發點、channels/allEnabled 變動接線）
- `src/ipc/contract.ts`（per-pet 命令加 channelId）
- `src/preload/index.ts` + `api.d.ts`（petBridge 命令加 channelId）
- `src/renderer/main.ts`（讀 `?c=` 取得 myChannel、命令帶 channelId、自走 gate `myChannel==='all'`）
- `src/renderer/index.html`（無變動或微調）

## 11. 測試策略

**核心 TDD**：`pet-layout.stackPosition`（index 0 右下、index 1+ 向左、夾 workArea、負原點螢幕）。
**整合 / 手動**：
1. 啟用 2 個 channel + 全部 → 出現 3 隻寵物、各自造型、向左排不重疊。
2. 發命中 channelA 的事件 → 全部 + channelA 寵物各演反應；channelB 不動。
3. 多屬來源（在 A、B 兩 channel）→ 全部 + A + B 都演。
4. 各寵物未讀紅點數正確（該 channel 未讀）。
5. 停用/刪 channel → 該寵物消失；`allEnabled` 關 → 全部寵物消失（只剩 channel 寵物）。
6. 拖動某 channel 寵物 → 只動它；channel 寵物不自走、全部仍自走。
7. e2e：多寵物啟動、pet:// 與既有鏈路不壞。

## 12. B2 預告（不在 B1）
每寵物自己的即時卡片視窗（多事件同時各自顯示、card-window per channel）；拖曳位置持久化（per-channel window-state）；點寵物開中心對應分頁；channel 寵物 hover 反應。
