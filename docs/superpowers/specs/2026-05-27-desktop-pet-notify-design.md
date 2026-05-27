# 桌面寵物通知工具 — 設計文件

- 日期：2026-05-27
- 狀態：設計定案（待使用者最終審閱 → 進入實作計畫）
- 工作代號：`desktop-notify`（App 正式名稱待定；本文以此為 bundle / 設定目錄名）

---

## 1. 定位

一隻常駐桌面右下角的精靈寵物（預設「may」奶油博美），平常待機賣萌；當 Claude Code 等 coding agent 發生事件（任務完成、需要你回覆、出錯…）時，用對應的反應動畫＋卡片式對話框把訊息「演」給使用者看。

- **先 macOS**，技術選型保留跨平台後路。
- **最小可行**：先接 Claude Code，畫面行為維持最小（單寵物、顯示最近事件）。
- **資料驅動**：任何符合精靈格式的寵物資料夾丟進去就能用，不需改程式。
- **schema / 邊界先做對**：事件管線、訊息契約、狀態機現在就定義清楚，避免之後接多來源時重工（採納 Codex 第二意見）。

## 2. 目標與非目標

**目標（v1）**
- 常駐選單列 App，桌面右下角顯示一隻會待機動畫的寵物。
- 內建本機 HTTP 端點接收事件；Claude Code hooks 透過一行 curl 推送。
- 事件觸發寵物反應動畫＋卡片通知。
- 寵物可資料驅動切換（內建 3 隻：may / maruko / oil-king-penguin）。

**非目標（v1，延後）**
- MCP 深度整合（未來視為「另一個事件來源 adapter」）。
- 多寵物同時顯示、每 session 一隻、session 切換器。
- 動作按鈕（actions）、長期情緒值、音效。
- Windows / Linux 的打包與驗證（僅在技術選型上保留可能性）。

## 3. 使用者情境

1. 使用者開機 → App 常駐選單列，may 出現在右下角待機。
2. 在終端機跑 Claude Code，任務一輪結束（`Stop`）→ may 播 jumping（慶祝）＋卡片「✅ 任務完成」。
3. Claude Code 需要授權/輸入（`Notification`）→ may 播 waving（招手）＋卡片「❓ 需要你回覆」。
4. 短時間多則事件 → 卡片排隊依序顯示；寵物演當下優先級最高的事件。
5. 使用者從選單列切換顯示的寵物，或丟一個新寵物資料夾進 pets 目錄後即可選用。

## 4. 系統架構

```
Claude Code 事件 (Stop / Notification …)
        │  hook：command 觸發，事件 JSON 走 stdin
        ▼
  notify 腳本  ── 讀 endpoint.json (port,token) ──┐
        │                                          │
        └── 一行 curl POST /notify (X-Token) ──────▼
                          ┌───────────────────────────────────┐
                          │ Electron 主行程                     │
                          │  Ingest Server (127.0.0.1)          │
                          │     │ 正規化成內部 Event             │
                          │     ▼                               │
                          │  Event Store（依 sessionId 分組）    │
                          │     │                               │
                          │     ├─▶ Reaction Arbiter（挑優先級）─┼─IPC─▶ Sprite Engine（單一 active reaction）
                          │     └─▶ Notification Queue ─────────┼─IPC─▶ Notification UI（卡片排隊）
                          │  Window Controller / Tray Menu      │
                          └───────────────────────────────────┘
                                          ▼
                          桌面右下角：寵物動畫 + 卡片通知
```

## 5. 模組切分（各自單一職責、可獨立測試）

| 模組 | 職責 | 行程 |
|---|---|---|
| **Ingest Server** | 綁 127.0.0.1 開 HTTP 埠、驗 token、解析並**正規化成內部 Event**（補預設欄位） | main |
| **Event Store** | 事件依 `sessionId` 分組保存；提供「最近事件」「當前最高優先級」查詢 | main |
| **Reaction Arbiter** | 依優先級挑出寵物當下要演的事件（`error > attention > done > review > working > info`，見 §11） | main |
| **Notification Queue** | 卡片排隊、各自 ttl、轉送畫面 | main |
| **Sprite Engine** | 讀共用精靈格式，跑待機迴圈；**同時只一個 active reaction**；狀態機與 fallback | renderer |
| **Notification UI** | 卡片渲染（圖示＋標題＋內文＋來源短名）、自動淡出、點寵物看最近 | renderer |
| **Window Controller** | 透明/無邊框/置頂/點擊穿透、hover 命中判定、多螢幕定位（存 displayId＋相對座標）、拖動 | main |
| **Tray Menu / Settings** | 選單列圖示：顯示/隱藏、切換寵物、開機自啟開關、結束 | main |
| **Pet Registry** | 掃描 pets 目錄、驗證格式、提供可選寵物清單 | main |
| **Hook Kit** | notify 腳本 ＋ 一鍵安裝 hook 設定的說明/指令 | 周邊 |

設計原則：**寵物狀態（單一 active reaction）與通知卡片（可排隊）徹底分離**，多事件、多來源時才不會互相干擾。

## 6. 訊息介面契約（HTTP）

```
POST /notify
Header: X-Token: <token>
Content-Type: application/json

{
  "id":        "uuid",        // 選填；缺則 server 產生。用於去重/更新同一則
  "source":    { "kind": "claude-code", "name": "my-project" },
                              // kind：來源類型（claude-code | codex | ci | script…）
                              // name：顯示短名（如工作目錄名）
  "sessionId": "abc123",      // 選填；多 session 分組，缺則歸入 "default"
  "type":      "done",        // done | attention | error | review | working | info
  "title":     "Claude Code",
  "body":      "建置完成",
  "priority":  null,          // 選填；缺則由 type 推導
  "timestamp": null,          // 選填；缺則 server 補 now
  "ttlMs":     5000,          // 選填；卡片停留時間，缺用預設
  "actions":   []             // 預留欄位；MVP renderer 忽略（避免日後 breaking change）
}
```

**回應**：`200 {ok:true,id}`；token 錯 `401`；格式錯 `400`。

**正規化規則（Ingest Server）**：缺 `id` → 產生 uuid；缺 `timestamp` → now；缺 `priority` → 由 type 對應（見 §11）；缺 `sessionId` → `"default"`；未知 `type` → `info`。

> 此契約讓未來接 Codex / CI / 腳本只是「換一個 `source.kind` 來 POST」，不必動既有管線。

## 7. 連接埠探索與安全

- **固定預設 port**（暫定 `8765`）。App 啟動時嘗試綁定；被占用則往後找可用埠。
- App 將實際 `{port, token}` 寫入 `~/Library/Application Support/desktop-notify/endpoint.json`。
- notify 腳本**讀 endpoint.json** 取得 port 與 token，再 curl。解決「hook 怎麼知道 port」的脆弱性。
- 端點僅 bind `127.0.0.1`；`X-Token` 共用密鑰（首次啟動產生、存於設定目錄）。token 不防本機惡意程式，但能擋誤打與網頁 CSRF 類低成本干擾。

## 8. 事件對應與 Claude Code hook 整合

**v1 自動綁定的 hook → type：**

| Claude Code hook | type | 寵物反應 | 卡片 |
|---|---|---|---|
| `Stop`（一輪回完） | `done` | jumping 慶祝 | ✅ 任務完成 |
| `Notification`（需授權/輸入） | `attention` | waving 招手 | ❓ 需要你回覆 |

- `error` / `review` / `working` 型別**端點本身即支援**（任何來源可直接 POST，可用 curl 測試）；但 v1 不自動從 Claude Code 偵測，`error` 規劃以 `PostToolUse` 偵測工具失敗於 v1.1 補上。
- hook 以 `command` 型別觸發，事件資料由 Claude Code 經 **stdin 傳入 JSON**；notify 腳本可從中取 `session_id`、工作目錄等填入 `sessionId` / `source.name`。

> **待規劃階段以官方文件核對**：各 hook 的精確名稱、觸發時機、stdin JSON 欄位（`session_id`、`transcript_path`、`cwd` 等）與 `settings.json` 的 hooks 設定 schema。

illustrative `settings.json`（待核對）：
```jsonc
{
  "hooks": {
    "Stop":         [{ "hooks": [{ "type": "command", "command": "<path>/deskpet-notify done" }] }],
    "Notification": [{ "hooks": [{ "type": "command", "command": "<path>/deskpet-notify attention" }] }]
  }
}
```

## 9. 共用精靈格式規格

所有寵物的 `spritesheet.webp` 遵守同一版面（已由 may / maruko / oil-king-penguin 三隻驗證一致）：

- 畫布：**1536 × 1872**
- 格子：**8 欄 × 9 列**，每格 **192 × 208**
- 每列從最左用前 N 格，其餘透明
- 列序固定對應動畫：

| 列 | 動畫名 | 影格數 | 用途 |
|---|---|---|---|
| 0 | `idle` 待機 | 6 | 預設待機迴圈 |
| 1 | `running-right` 向右跑 | 8 | （未來）走動 |
| 2 | `running-left` 向左跑 | 8 | （未來）走動 |
| 3 | `waving` 揮手 | 4 | attention |
| 4 | `jumping` 慶祝 | 5 | done |
| 5 | `failed` 失敗 | 8 | error |
| 6 | `waiting` 等待 | 6 | working |
| 7 | `running` 跑 | 6 | （未來）走動 |
| 8 | `review` 檢視 | 7 | review |

此規格以單一共用定義（程式常數或 `sprite-format.json`）描述，**不寫死在各 pet.json**。桌面顯示時等比縮小（預設約 50%，可調）。

## 10. 寵物資料夾與資料驅動

- App 啟動掃描 pets 目錄；每個含 `pet.json` ＋符合 §9 格式之 `spritesheet.webp` 的資料夾即為可選寵物。
- `pet.json` 維持極簡：`{ id, displayName, description, spritesheetPath }`（不含動畫 manifest）。
- 內建 3 隻（may / maruko / oil-king-penguin）隨 App 出貨；首次啟動複製到使用者目錄 `~/Library/Application Support/desktop-notify/pets/`，使用者亦可自行丟入新資料夾。
- **驗證**：尺寸/格數不符 → 不收，於選單列提示並跳過該寵物。
- **預設寵物**：`may`。選單列可切換。

## 11. 精靈狀態機與仲裁

**狀態機（Sprite Engine）**
- `idle`（預設）：跑 idle 迴圈，可偶爾插入待機小變化（未來再加走動）。
- 收到事件 → 播一次性 `reaction`（done→jumping / attention→waving / error→failed / review→review / working→waiting）→ 播畢回 `idle`。
- **同時僅一個 active reaction**。

**優先級與插隊（Reaction Arbiter）**
- 優先級：`error > attention > done > review > working > info`。
- 進行中的 reaction 可被**更高優先級**事件打斷；同級或更低 → 不打斷（卡片照常排隊，動畫不插隊）。
- active reaction 結束且無更高待演事件 → 回 idle。

**Fallback（資料驅動換皮的防線）**
- 未知 `type`、該寵物缺對應列、或影格數異常 → 退回 `idle`（仍照常顯示卡片）。

## 12. 通知 UI 行為

- 卡片式：圖示（依 type）＋標題＋內文＋**來源短名**（`source.name`，多 session 時用以辨別）。
- 預設停留 `ttlMs ≈ 5000` 後淡出；多則事件依序排隊顯示。
- 點寵物 → 叫出最近訊息（最近一則或近期清單）。
- 同 `id` 再次送達 → 更新既有卡片而非新增（去重）。

## 13. 視窗控制器

- 透明、無邊框、置頂、skip taskbar 的 BrowserWindow。
- **點擊穿透**：預設 `setIgnoreMouseEvents(true, {forward:true})`，僅當滑鼠 hover 到寵物/卡片命中區時切換為可互動（hover hit-test 集中於此模組，避免散落 UI 邏輯）。
- **多螢幕**：位置以 `displayId ＋ 相對座標` 記錄（非單純 x/y），切換螢幕/解析度變更時可正確還原；預設右下角。
- 可拖動重新定位。

## 14. 多 session 處理（v1 僅資料層）

- 內部 Event 帶 `sessionId`；Event Store 依 session 分組。
- 卡片顯示 `source.name` 以辨別不同任務。
- 寵物（單隻）演 Reaction Arbiter 選出的當前最高優先級事件。
- **延後**：多寵物、每 session 一隻、session 切換器、群組視圖。底層 schema 不假設單 session。

## 15. 選單列與設定

- 選單列圖示選單：顯示/隱藏寵物、切換寵物、開機自啟（預設**關**）、結束。
- 設定存於 `~/Library/Application Support/desktop-notify/`（含 endpoint.json、token、選用寵物、視窗位置）。
- 音效：v1 **無**。

## 16. 錯誤處理

- token 錯/格式錯 → 回 4xx，不崩潰。
- 埠被占 → 往後找可用埠並改寫 endpoint.json。
- renderer 未就緒 → main 端先暫存事件，就緒後補送。
- 寵物格式不符 → 跳過並提示。
- 未知 type / 缺列 → 退回 idle（§11）。

## 17. 測試策略

- **HTTP 選型紅利**：用 `curl` 即可模擬所有事件型別與來源，手動驗收寵物反應。
- 單元測試：Ingest 正規化與驗證、Reaction Arbiter 優先級/插隊、Notification Queue 生命週期、Pet Registry 格式驗證、精靈格式列→影格對應。
- 狀態機測試：各 type → 正確 reaction → 回 idle；高優先級打斷；fallback 路徑。
- 手動/整合：curl 打端點看 may 反應；多 session 並發卡片來源辨識。

## 18. v1 範圍 vs 之後

**v1**
- 選單列常駐 App、右下角待機寵物（idle）。
- 本機 HTTP 端點 ＋ endpoint.json ＋ token。
- 完整內部 Event schema、Arbiter、Notification Queue（即使 UI 僅顯示最近）。
- 寵物反應：idle ＋ jumping(done) ＋ waving(attention) ＋ failed(error，可由 curl/任意來源觸發)。
- Claude Code hook 自動綁定：Stop→done、Notification→attention。
- 資料驅動寵物切換（內建 3 隻）。
- Hook Kit：notify 腳本 ＋ 安裝說明。

**之後**
- error/review/working 自動從 Claude Code 偵測（PostToolUse 等）。
- 走動動畫（running 系列）、待機小行為。
- MCP event source adapter；Codex / CI 來源。
- actions 按鈕、音效、多寵物/多 session 視圖、Windows/Linux 打包。

## 19. 待確認/未決（進實作計畫前）

1. App 正式名稱（影響 bundle id 與設定目錄名；本文暫用 `desktop-notify`）。
2. Claude Code hook 精確名稱、stdin JSON 欄位、settings.json hooks schema（以官方文件核對）。
3. 預設 port `8765` 是否合適、是否需可設定。
4. 內建寵物複製到使用者目錄 vs 直接掃描 App bundle（或兩者皆掃）的取捨。
5. 點選寵物的互動細節（看最近一則 vs 近期清單）。

## 20. 技術選型摘要

| 項目 | 決定 | 理由 |
|---|---|---|
| 平台 | macOS 先做，跨平台後路 | 最小版聚焦，技術不鎖死 |
| 框架 | **Electron**（Node + Chromium + TS） | 最好上手、生態最大、透明/置頂/點擊穿透成熟；取捨為常駐記憶體較重 |
| 接收 | 本機 **HTTP** 端點（127.0.0.1 ＋ token） | 最易實作/測試（curl）、多來源擴充無痛 |
| 來源(v1) | Claude Code **hooks** | 生命週期事件最自然 |
| 寵物 | **資料驅動**＋共用精靈格式 | 符合格式即可換皮，零改程式 |
