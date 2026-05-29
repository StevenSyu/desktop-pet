# 點「更多」看全文 + 通知中心強化 — 設計文件

- 日期：2026-05-29
- 狀態：設計定案（待使用者最終審閱 → 進入實作計畫）
- 範圍代號：Spec ⑧（前為 ⑦ 即時卡片獨立視窗）

---

## 1. 定位與動機

即時卡片內文目前只 2 行截斷，看不到完整內容。Spec ⑦ 曾預留「點卡片展開」，但動態長高的浮動視窗顯示風險高，**改為**：即時卡片保持精簡，提供「更多」入口進**通知中心的單則詳情面板**看完整內容；同時強化通知中心的內容呈現（Markdown 排版、完整 metadata、詳情閱讀視圖）。詳細內容是 opt-in（不是每則都想細看）。

## 2. 範圍

**目標（v1）**
- 即時卡片：點卡片本體維持現狀（標已讀 + 關閉）；右下新增「更多」連結，**僅當內文被截斷時顯示**，點它 → 關卡片（走現有 dismiss）+ 開通知中心並直接進該則詳情面板。
- 即時卡片內文精簡：只顯示第一段（換行/句號切分），避免小卡片塞太多。
- 通知中心：新增「列表 ↔ 單則詳情面板」兩種檢視（同一視窗內，不開新視窗）。
- 詳情面板：Markdown 安全渲染的完整內文 + 完整 metadata + 返回。
- 最小安全 Markdown 渲染（換行、清單、粗體、行內/區塊程式碼；不含連結/圖片/raw HTML）。
- 通知中心改為**開在寵物所在螢幕、靠寵物那側**（不再固定主螢幕角落）。

**非目標（v1，延後）**
- 卡片原地展開（已否決：動態浮窗風險）。
- 訊息持久化、搜尋、通知音、點訊息跳到 session。
- 完整 Markdown（標題、連結、圖片、表格）。

## 3. 架構總覽

- **core 純函式（可測）**：`card-summary`（卡片精簡首段）、`markdown-render`（安全 Markdown→HTML）。
- **即時卡片（card renderer）**：點本體維持 dismiss；新增「更多」獨立連結 → `cardBridge.cardMore(id)`。
- **main**：`card-more` 共用現有 dismiss 副作用 + 記 `pendingDetailId` + 開中心 + 觸發中心重查。
- **通知中心（center renderer）**：列表/詳情兩態，詳情用 `renderMarkdown`；載入時 query pending detail；Esc 合併兩段式。
- **通知中心定位**：重用 ⑦ 的 `cardPosition`，開在寵物所在螢幕、靠寵物那側（§7.5）。

## 4. 卡片內文精簡（core）

### 4.1 `src/core/card-summary.ts`
```ts
export interface CardSummary { text: string; hasMore: boolean }
export function cardSummary(plain: string): CardSummary
```
- **輸入為已 `stripMarkdown` 的純文字**（呼叫端：`buildCardView` 先 `stripMarkdown(body)` 再 `cardSummary`），故首行不會是 ``` 或 `#`。
- 流程：正規化換行（`\r\n?`→`\n`）、trim → 取第一個非空行 `firstLine`。
  - 若 `firstLine.length > 60`：含「。」→ 切到第一個「。」（含），否則硬切 60 字 + 「…」。
  - `text` = 上述結果。
- `hasMore = text !== normalizedFull`（`normalizedFull` = 換行正規化 + trim 後全文）。涵蓋：多行（text 只取首行）、首行被長度/句號截短；單行短內容則 `hasMore=false`、不顯示「更多」。

### 4.2 `CardView` 與 `buildCardView`
- `src/core/card-view.ts` 的 `CardView` 加 `hasMore: boolean`。
- `src/renderer/main.ts` `buildCardView`：`const s = cardSummary(e.body ? stripMarkdown(e.body) : '')`；`body: s.text`、`hasMore: s.hasMore`。

## 5. Markdown 安全渲染（core）⚠️ 安全關鍵

### 5.1 `src/core/markdown-render.ts`
```ts
export function renderMarkdown(raw: string): string // 回傳安全 HTML 字串
```
**body 是外部 POST、不可信**。演算法（行為基礎 parser，避免 ReDoS）：
1. 正規化換行 `\r\n?`→`\n`。
2. **先處理 fenced code**：掃描 ```` ``` ```` 配對區塊，內容 **HTML escape**（`& < > " '`）後包成 `<pre><code>…</code></pre>`，並以佔位符抽離（內部不再套任何 inline 規則）。
3. 其餘文字逐行分塊：
   - 連續 `^\s*[-*]\s+` 行 → `<ul><li>inline(escape(rest))</li>…</ul>`。
   - 空行 → 段落分隔。
   - 其他 → 段落，行間 `<br>`，每行 `inline(escape(line))`。
4. `inline(escapedText)`：在**已 escape** 的字串上套：行內 `` `code` ``→`<code>escape 已含</code>`、`**bold**`→`<strong>`。（`` ` `` 與 `*` 不受 escape 影響，故 pattern 可運作；使用者的 `<` 已成 `&lt;` 不會被誤判成標籤。）
5. 還原 fenced code 佔位符。
- **不支援**：連結、圖片、raw HTML、任何 attribute、`javascript:`。輸出只含 `<p><br><ul><li><strong><code><pre>` 這幾個無屬性標籤。
- 正則均為 bounded / 單行套用，避免貪婪跨全文回溯。

### 5.2 使用點
- 通知中心**詳情面板**：`bodyEl.innerHTML = renderMarkdown(m.body)`（唯一 innerHTML sink）。
- 通知中心**列表**與即時卡片：維持 `textContent` + `stripMarkdown`（純文字、零 XSS 風險）。

## 6. 通知中心：列表 ↔ 詳情面板（center renderer）

### 6.1 狀態與切換
- `src/renderer/center.ts` 加 `let detailId: string | null = null`。
- `render()`：若 `detailId` 且 `all.find(m=>m.id===detailId)` 存在 → 渲染詳情；否則（含 detailId 指向已淘汰/清空的 item）`detailId=null` 渲染列表。
- 進詳情前存 `listEl.scrollTop`；從詳情返回列表後還原 scrollTop 並對該則做短暫 highlight。

### 6.2 詳情面板內容
- 類型色標題（`LABEL[type]`）、完整內文（`renderMarkdown`）、完整 metadata：來源（`title || source.name || source.kind`）、完整 `sessionId`、絕對時間（`timestamp` 格式化）+ 收到時間（`receivedAt`）、type。
- 返回鈕（← 回列表）。
- 進入詳情：若該則未讀才 `markRead`（避免重複 broadcast）。

### 6.3 進入詳情的入口
- 列表點任一則 → `detailId = m.id; render()`。
- 從即時卡片「更多」進來 → 見 §7 路由。

### 6.4 Esc 合併（不新增 handler）
- 修改現有 `keydown` Escape handler：`if (detailId) { detailId=null; render() } else window.close()`。兩段式：詳情→列表→關窗。

## 7. IPC 與路由

### 7.1 新增 channel（`src/ipc/contract.ts`）
- Command `card-more`：`{ id: string }`（card renderer → main）。
- Query `get-pending-detail`：`{ args: void; result: { id: string | null } }`（center → main，一次性取並清）。
- Push `open-detail`：`void`（main → center，「請重查 pending detail」的觸發訊號）。

### 7.2 preload
- `cardBridge.cardMore(id)`（`src/preload/card.ts`，直接 `ipcRenderer.send('card-more',{id})`，與 cardClicked 同樣不依賴 preload-helpers 以免共用 chunk）。
- `petBridge`：`getPendingDetail(): Promise<{id:string|null}>`、`onOpenDetail(cb)`（`src/preload/index.ts` + `api.d.ts`）。

### 7.3 main `card-more` handler（`src/main/index.ts`）
共用現有 dismiss 副作用，再導向詳情：
1. `if (id !== activeCardId) return`（與 card-clicked 同 guard）。
2. `activeCardId = null`、`cardWindow?.hide()`、`pushTo(petWindow,'card-dismissed',{id})`（pet renderer 照常 markRead + 清 currentEvent/replay + refreshBadge）。
3. `pendingDetailId = id`、`openCenter()`。
4. `pushTo(centerWindow,'open-detail')`（若中心已開 → 觸發重查；新開窗則靠載入時 query，見 §7.4）。

### 7.4 統一兩路徑（消除 race，採 Codex ②）
- main 持 `let pendingDetailId: string | null`；`handleQuery('get-pending-detail', () => { const id = pendingDetailId; pendingDetailId = null; return { id } })`。
- center 載入流程（既有 `getMessages().then` 之後）加：`getPendingDetail().then(({id}) => { if (id) { detailId = id; render() } })`。
- center `onOpenDetail(() => getPendingDetail().then(({id}) => { if (id) { detailId = id; render() } }))`（已開窗時被 §7.3 step4 觸發）。
- 新開窗：openCenter 建窗 + 載入 → 載入時 query 拿到 pending → 開詳情。已開窗：focus + push 觸發重查。兩路徑都收斂到同一 query，不會於載入中遺失。

## 7.5 通知中心視窗定位（策略 A，重用 `cardPosition`）

現況：`center-window.ts` 永遠把中心開在**主螢幕**右側固定位置，不跟隨寵物所在螢幕——配上「更多→開中心」會在副螢幕點、中心卻彈到主螢幕，體驗跳 tone。

改為跟即時卡片同一套心智模型：開在**寵物所在螢幕、靠寵物那側、上方對齊**。

- **重用 `src/core/card-position.ts` 的 `cardPosition`**（⑦ 已有並測過），餵中心視窗尺寸即可：右對齊寵物、上方優先、上方不足翻下方、水平夾 workArea。
- **小幅擴充 `cardPosition`**：加 y 夾（`y` 夾進 `[workArea.y, workArea.y + workArea.height - card.height]`），避免中心視窗（較高，440px）翻到下方時超出螢幕底。此擴充對 ⑦ 既有 5 個案例**結果不變**（皆已在範圍內），另補 1 個「翻下方會超出底部 → 夾回」測試。
- `center-window.ts`：匯出 `CENTER_W`/`CENTER_H`、`createCenterWindow(pos?: {x,y})` 接受座標（移除固定 primary 計算）。
- `src/main/index.ts` `openCenter()`：每次開啟（新建或既有）都用 `cardPosition(petWindow.getBounds(), {width:CENTER_W,height:CENTER_H}, screen.getDisplayMatching(petBounds).workArea, gap)` 算位置並 `setPosition`，使中心永遠出現在寵物當前所在螢幕／那側（含從別台螢幕點「更多」時跟過去）。

## 8. 既有程式調整

**修改**
- `src/core/card-view.ts`：`CardView` 加 `hasMore`。
- `src/renderer/main.ts`：`buildCardView` 用 `cardSummary`。
- `src/renderer/card.ts`：`hasMore` 時渲染「更多」連結（獨立 element、`stopPropagation`、button/anchor），點擊 → `cardBridge.cardMore(currentId)`；卡片本體點擊維持 `cardClicked`。
- `src/renderer/card.css`：「更多」連結樣式（右下、低調）。
- `src/preload/card.ts`：加 `cardMore`。
- `src/preload/index.ts` + `api.d.ts`：`getPendingDetail`、`onOpenDetail`。
- `src/ipc/contract.ts`：`card-more` / `get-pending-detail` / `open-detail`。
- `src/main/index.ts`：`pendingDetailId`、`card-more` handler、`get-pending-detail` query。
- `src/renderer/center.ts`：`detailId` 狀態、詳情渲染、Esc 合併、scroll/highlight、載入時 query pending、`onOpenDetail`。
- `src/renderer/center.css`：詳情面板樣式、返回鈕、highlight。
- `src/core/card-position.ts`：`cardPosition` 加 y 夾（§7.5；既有 5 測試不變，+1 測試）。
- `src/main/center-window.ts`：匯出 `CENTER_W`/`CENTER_H`、`createCenterWindow(pos?)` 接受座標。
- `src/main/index.ts` `openCenter()`：用 `cardPosition` 依寵物所在螢幕定位（§7.5）。

**新增**
- `src/core/card-summary.ts`、`src/core/markdown-render.ts`
- 測試：`tests/core/card-summary.test.ts`、`tests/core/markdown-render.test.ts`

## 9. 測試策略

**核心 TDD**
- `card-summary`：單行短（hasMore=false）、多行（取首行、hasMore=true）、首行超長無句號（硬切+…、hasMore=true）、首行超長含句號（切到。、hasMore=true）、純空白/只有換行（text=''、hasMore=false）、CJK 長度。
- `markdown-render`：escape（`<`/`&`/`"`）、`**bold**`、行內 `` `code` ``、`-`/`*` 清單、fenced ```code```（內部 `**`/`-` 不被轉、內容有跳脫）、換行→`<br>`、**XSS：`<img src=x onerror=alert(1)>`、`<script>`、`[x](javascript:…)` 不產生可執行/連結**、實體不被二次誤判、長輸入無 ReDoS。

**整合 / 手動驗收**
1. 短內文卡片無「更多」；長/多行內文卡片右下出現「更多」。
2. 點卡片本體 → 關閉 + 標已讀（不變）。
3. 點「更多」→ 卡片關、通知中心開並直接顯示該則詳情；徽章更新。
4. 通知中心已開時再點「更多」→ 中心切到該則詳情（focus）。
5. 詳情 Markdown 正確（清單/粗體/程式碼/換行）、metadata 完整。
6. Esc：詳情→列表→關窗兩段式；列表點任一則進詳情。
7. 詳情中該則被「清空」→ 自動 fallback 回列表。
8. 返回列表後 scroll 位置還原 + 該則 highlight。
9. **通知中心定位**：把寵物拖到副螢幕 → 開中心（或點「更多」）→ 中心出現在副螢幕、靠寵物那側（不再跳回主螢幕）。
10. e2e：卡片→更多→中心詳情鏈路與既有鏈路不壞。

**核心 TDD（補）**
- `card-position`：新增「翻下方會超出底部 → y 夾回」案例；既有 5 案例仍綠。

## 10. 檔案清單

**新增**：`src/core/card-summary.ts`(+test)、`src/core/markdown-render.ts`(+test)
**修改**：`src/core/card-view.ts`、`src/core/card-position.ts`(+1 test)、`src/renderer/main.ts`、`src/renderer/card.ts`、`src/renderer/card.css`、`src/preload/card.ts`、`src/preload/index.ts`、`src/preload/api.d.ts`、`src/ipc/contract.ts`、`src/main/index.ts`、`src/main/center-window.ts`、`src/renderer/center.ts`、`src/renderer/center.css`
