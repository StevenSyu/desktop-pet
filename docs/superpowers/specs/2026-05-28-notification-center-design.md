# 通知系統強化（通知中心）— 設計文件

- 日期：2026-05-28
- 狀態：設計定案（待使用者最終審閱 → 進入實作計畫）
- 範圍代號：Spec ①（後續還有 ② 視窗行為、③ 動畫與效能）

---

## 1. 定位與動機

目前桌面寵物只顯示**單張即時卡片**，新訊息會替換舊的——連續事件（CI/多步驟）時，中間的訊息被靜默吃掉，使用者可能誤以為一切順利。這是唯一會讓工具失去信任的缺陷。

本 spec 在**保留**「單張即時卡片、持久到點關閉」的前提下，新增**通知中心**：所有訊息進入歷史佇列、可翻閱、零遺失，並提供**已讀/未讀**與**收到時間**以便快速掌握與過濾。同時順手處理**長訊息截斷/展開**。

對應改善項：B1（訊息不遺失）、B3（長訊息截斷展開）、C1（通知中心）。

## 2. 目標與非目標

**目標（v1）**
- 所有事件進入訊息庫（歷史佇列），上限約 50 則。
- 已讀/未讀狀態；寵物顯示未讀數徽章。
- 通知中心面板：狀態篩選、時間分組、相對時間、已讀/未讀視覺。
- 長訊息在即時卡片與中心皆截斷並可展開。

**非目標（v1，延後）**
- 歷史跨 App 重啟持久化（v1 存記憶體，重啟清空）。
- 搜尋、通知音、點訊息跳到對應 session。
- 卡片堆疊（已決定走「單張 + 通知中心」而非堆疊）。

## 3. 互動模型

- **即時卡片**：維持現狀——單張、持久顯示、點一下關閉。
- **開啟通知中心**：右鍵選單「通知中心」（原 disabled 佔位改為實作）。
- **已讀/未讀規則**：
  - 事件進來 → 加入訊息庫，標記**未讀**。
  - 使用者**點桌面即時卡片**關閉它 → 該則標記**已讀**。
  - 在通知中心**點某則** → 該則已讀；按**「全部已讀」** → 全部已讀。
  - 被新事件替換、來不及點的即時卡片 → 留在中心為**未讀**（零遺失）。
- **未讀徽章**：寵物右上角紅色數字徽章顯示未讀數；無未讀則不顯示。

## 4. 通知中心面板（UI）

沿用即時卡片的視覺語言：暖白卡面（#fffdf8）、SF Rounded 圓體字、狀態色彩編碼。

- **標頭**：「通知中心」＋未讀數；右側動作「全部已讀」「清空」。
- **狀態篩選 chips**：全部／完成／需要注意／錯誤／請檢視／工作中（點選只顯示該狀態；「全部」為預設）。
- **時間分組**：剛剛／今天稍早／更早（依 receivedAt 分組）。
- **每則項目**：左側狀態色條＋色標籤（完成/錯誤…）＋訊息＋來源（如「Claude Code · my-proj」）＋**相對時間**（剛剛／N 分鐘前／HH:mm）。
  - **未讀**：淡狀態色底＋右側實心點。
  - **已讀**：一般白底、整體淡化（opacity ~.72）。
- **長訊息（B3）**：訊息超過 2 行截斷（`-webkit-line-clamp`），顯示「展開」可展開全文；即時卡片同樣處理。
- **空狀態**：無訊息時顯示友善提示（例如「目前沒有通知」）。

## 5. 核心：MessageStore（純邏輯、可測）

把目前閒置的 `src/core/notification-queue.ts` 重做為訊息庫 `MessageStore`（沿用檔案或改名 `message-store.ts`）。純邏輯、時鐘注入、可單元測試。

```ts
import type { AppEvent, NotifyType } from './events'

export interface StoredMessage extends AppEvent {
  read: boolean
  receivedAt: number
}

export interface MessageStoreOptions {
  now?: () => number
  capacity?: number // 預設 50
}

export class MessageStore {
  push(event: AppEvent): StoredMessage   // 加入未讀、設 receivedAt=now()；超過 capacity 丟最舊
  markRead(id: string): void
  markAllRead(): void
  list(filter?: { type?: NotifyType }): StoredMessage[]  // 新到舊
  unreadCount(): number
  clear(): void
}
```

規則：`push` 標 `read:false`、`receivedAt:now()`，超過 capacity 移除最舊；`list` 由新到舊，可依 type 過濾；`unreadCount` 計未讀。時間分組與相對時間格式化屬 renderer 職責（依 receivedAt）。

## 6. 架構與資料流

```
事件 → ingest（main）
   │ store.push(event)                 ← MessageStore 為單一真實來源（main 持有）
   ├─ send 'pet-event'(event)          → 寵物 renderer：即時卡片 + 反應動畫
   ├─ send 'unread-count'(n)           → 寵物 renderer：未讀徽章
   └─ if 中心開啟 send 'messages-updated'(list) → 通知中心 renderer 重繪

通知中心 renderer ──IPC──▶ main：
   invoke 'get-messages'(filter) → list
   send 'mark-read'(id) / 'mark-all-read' / 'clear-messages'
寵物 renderer：即時卡片點擊 → send 'mark-read'(currentEvent.id) + 關閉

右鍵選單「通知中心」 → send 'open-center' → main 建立/顯示中心視窗
```

**模組職責**
| 模組 | 職責 | 行程 |
|---|---|---|
| `MessageStore` | 訊息庫：歷史、已讀/未讀、容量、過濾、未讀數 | main（核心庫，可測） |
| ingest 串接 | 事件 push 進 store、廣播給視窗 | main |
| Center Window | 建立/顯示/定位/失焦關閉 通知中心視窗 | main |
| 寵物 renderer | 即時卡片（現有）＋未讀徽章；卡片點擊→mark-read | renderer (pet) |
| 通知中心 renderer | 渲染清單、篩選、時間分組、長訊息展開、動作 | renderer (center) |
| preload | 擴充：未讀數、開中心、取訊息、標已讀/全部已讀/清空、訊息更新訂閱 | preload |

## 7. 視窗機制

- 通知中心為**獨立 BrowserWindow**（非透明、非點擊穿透，可互動可捲動），從右鍵選單開啟。
- 無邊框、圓角、暖白面板風格；約 300×440；定位在寵物附近（右下角、寵物上方/左側，並夾在工作區內）。
- **失焦自動關閉**（`blur`）或面板內關閉鈕；再次從選單開啟。
- 多渲染入口：electron-vite 新增 `center.html` + `src/renderer/center.ts`（與寵物 renderer 分開）。

## 8. 錯誤處理

- store 容量上限避免無限成長；超量丟最舊。
- 未知 type 仍可入庫（沿用 events 正規化的 info fallback）。
- 中心視窗重複開啟 → 聚焦既有視窗，不重建。
- 標記/清空對不存在 id → 無作用、不報錯。

## 9. 測試策略

- **MessageStore（TDD）**：push 標未讀+receivedAt、容量丟最舊、markRead/markAllRead、list 新到舊+type 過濾、unreadCount、clear。
- **整合（Playwright _electron + 截圖）**：事件→未讀數徽章；開中心渲染清單；點即時卡片→該則變已讀（未讀數 -1）；中心點項目/全部已讀/清空；狀態 chips 過濾；長訊息展開。

## 10. v1 範圍 vs 之後

**v1**：MessageStore（記憶體）、未讀徽章、通知中心視窗（篩選/時間分組/相對時間/已讀未讀/長訊息展開）、右鍵選單開啟、即時卡片點擊標已讀。
**之後**：跨重啟持久化、搜尋、通知音、點訊息跳到 session、卡片堆疊（若日後仍要）。

## 11. 待確認/未決（進實作計畫前）

1. 重做 `notification-queue.ts` vs 新增 `message-store.ts` 並移除舊檔（傾向重做/改名，舊的 ttl 模型已不用）。
2. 未讀徽章精確位置/樣式（寵物右上角紅底白字）。
3. 時間分組門檻（剛剛 < 1 分鐘？今天稍早＝同日？更早＝跨日）。
4. 中心視窗失焦即關 vs 需手動關（傾向失焦即關，但點 chips/捲動不應誤關）。
