# Pomodoro Timer — Design Spec

Date: 2026-06-04  
Updated: 2026-06-04（兩輪 Codex review 後定稿）

## Overview

在 desktop-notify 桌面寵物 app 中加入蕃茄鐘功能。功能以 **per-channel opt-in** 方式整合。蕃茄鐘是內建通知來源——**繞過 HTTP ingest pipeline 與 MessageStore**，由 `pomodoro-driver` 直接呼叫 `showInternalCard()` 顯示即時 card，不走 `autoDetectChannel`，不進通知中心，不污染 channel/source 管理系統。

同時擴充 card 系統支援 **auto-dismiss**（自動消失），作為蕃茄鐘提醒的前置需求。

另包含一個獨立 UX 修正：**清空按鈕語意對齊**（見末節）。

---

## Scope

### 功能 1：Card auto-dismiss

`CardView`（`src/core/card-view.ts`）加選用欄位 `autoDismissMs?: number`。

- `undefined` → persistent（現有行為，所有現有通知不變）
- `> 0` → card renderer `setTimeout` 倒數後自動關閉

**不動 `AppEvent.ttlMs`**（其預設 5000，語意是訊息存活時間，與 auto-dismiss 無關）。零回歸風險。

實作注意（card renderer，`src/renderer/card.ts`）：
- 每次 render 新 view 時清掉舊 timer，捕捉 render 當下的 card `id`，避免舊 timer 關掉新 card
- 蕃茄鐘 card 不進 MessageStore → 無已讀概念，timeout 直接走 card 關閉路徑（不需 markRead）

### 功能 2：蕃茄鐘

使用者啟用後，在選定 pet 上 hover 顯示控制列（倒數 + 按鈕），phase 結束時 card 提醒，5 秒自動消失。**即時性訊息：不存 MessageStore、不進通知中心、無未讀 badge。**

---

## Architecture

```
src/core/pomodoro-timer.ts     ← pure reducer，平台中立，unit testable
src/main/pomodoro-driver.ts    ← setInterval 驅動 reducer；showInternalCard；IPC handler
src/main/prefs.ts              ← Prefs 加 PomodoroPrefs
src/renderer/main.ts           ← 接 pomodoro-changed push，渲染 hover bar
src/ipc/contract.ts            ← 新增 Commands + Pushes
src/renderer/settings.html/ts  ← 新增「蕃茄鐘」設定區段
src/core/card-view.ts          ← CardView 加 autoDismissMs
src/renderer/card.ts           ← auto-dismiss timer
```

### 資料流

```
用戶按 ▶
  → renderer IPC Command: pomodoro-start
  → pomodoro-driver dispatch(START)
  → setInterval 每秒 TICK
  → phase 切換 → push pomodoro-changed { phase, paused, startedAt, durationMs, elapsedMs }
  → renderer 用 elapsedMs + startedAt 算剩餘秒，自行 setInterval 更新顯示
  → reducer 回傳 effect notify-work-end / notify-break-end
  → driver 呼叫 showInternalCard({ title, body, autoDismissMs: 5000 })
  → card 顯示 → 5s 後自動關閉（不標已讀——本來就不在 store）
```

---

## Core Module：`src/core/pomodoro-timer.ts`

純函式，不依賴 Electron / Node。

### State

```typescript
type PomodoroPhase = 'idle' | 'work' | 'break'

interface PomodoroState {
  phase: PomodoroPhase
  startedAt: number       // phase 開始的 now()（由 caller 注入）
  elapsedMs: number       // 已計時 ms，paused 時凍結
  paused: boolean
  workMs: number
  breakMs: number
  afterBreak: 'loop' | 'pause'
}
```

### Actions

```typescript
type PomodoroAction =
  | { type: 'START';     now: number }
  | { type: 'PAUSE';     now: number }
  | { type: 'RESUME';    now: number }
  | { type: 'STOP' }
  | { type: 'TICK';      now: number }   // driver 每秒呼叫
  | { type: 'CONFIGURE'; prefs: PomodoroPrefs }
```

### Effects（side-effect signal）

```typescript
type PomodoroEffect =
  | { type: 'notify-work-end' }
  | { type: 'notify-break-end' }
  | { type: 'none' }
```

`pomodoroReducer(state, action): { state: PomodoroState; effect: PomodoroEffect }`

Reducer 處理所有 phase 邊界判斷，driver 只讀 effect，不自行判斷邊界。

### State Machine

```
idle ──START──→ work ──elapsedMs≥workMs──→ break ──elapsedMs≥breakMs──→ work (loop)
                                                                      └──→ idle (pause mode)
work / break ──PAUSE──→ paused（phase 不變，elapsedMs 凍結）
paused ──RESUME──→ 繼續計時
any ──STOP──→ idle
```

---

## Prefs 擴充（`src/main/prefs.ts`）

```typescript
interface PomodoroPrefs {
  enabled:    boolean               // 全域開關，預設 false
  workMs:     number                // 預設 25 * 60 * 1000
  breakMs:    number                // 預設 5 * 60 * 1000
  afterBreak: 'loop' | 'pause'     // 預設 'loop'
  showOnAll:  boolean               // 「全部」channel pet 顯示控制列，預設 true
}

interface Prefs {
  // ...現有欄位...
  pomodoro: PomodoroPrefs
}
```

持久化：`DEFAULTS` 補預設值、`loadPrefs()` 對舊資料補 fallback（沿用現有 sanitize 模式）。

**Per-channel opt-in（自訂 channel）：**  
`Channel`（`src/core/channel.ts`）加 `pomodoroEnabled: boolean`，預設 `false`；`sanitizeChannels()` 對舊資料補預設。

**顯示規則：**
- 「全部」pet：`PomodoroPrefs.enabled && PomodoroPrefs.showOnAll`
- 自訂 channel pet：`PomodoroPrefs.enabled && channel.pomodoroEnabled`

---

## IPC Contract 新增（`src/ipc/contract.ts`）

Timer 為 global（單一實例），Commands 不帶 `channelId`。

```typescript
// Commands（renderer → main）
'pomodoro-start':  void
'pomodoro-pause':  void
'pomodoro-resume': void
'pomodoro-stop':   void

// Pushes（main → renderer）
'pomodoro-changed': {
  phase:      'idle' | 'work' | 'break'
  paused:     boolean
  startedAt:  number   // phase 開始的 ms timestamp
  durationMs: number   // 當前 phase 總長
  elapsedMs:  number   // 已計時 ms（paused 狀態下正確計算剩餘需要此值）
}
```

Contract 改動需同步更新 preload bridge（`src/preload/`）及 `api.d.ts`。

---

## Main Driver：`src/main/pomodoro-driver.ts`

- App 啟動時 init，從 prefs 建初始 `PomodoroState`
- `setInterval(1000)` 每秒 `dispatch({ type: 'TICK', now: Date.now() })`
- Effect 處理：
  - `notify-work-end` → `showInternalCard({ title: '🍅 休息一下！', body: '工作時間結束，好好休息。', autoDismissMs: 5000 })`
  - `notify-break-end` → `showInternalCard({ title: '⏰ 繼續工作！', body: '休息結束，下一個蕃茄開始。', autoDismissMs: 5000 })`
- Phase 切換時 push `pomodoro-changed` 給所有 pet windows
- 監聽 Commands → 對應 dispatch
- `PomodoroPrefs.enabled = false` 時不啟動 driver，不建 interval

### `showInternalCard()`

抽現有 `show-card` handler 核心：`ensureCard(channelId)` + `dispatchCard(channelId, { kind: 'show', view })`。

- Target fan-out：計算 pomodoro-enabled 的 channelIds（「全部」依 `showOnAll`、自訂依 `pomodoroEnabled`），逐一呼叫
- 組裝 `CardView`（含 `autoDismissMs`），**不寫入 MessageStore**
- DND：走同一條 `dispatchCard` 路徑，自然套用現有 DND 行為（不加特例）
- 單一共用 fn；未來有第二個內建通知 use case 時再考慮提取 interface（YAGNI）

---

## Renderer Hover Bar（`src/renderer/main.ts`）

**顯示條件**（依上述顯示規則）

**視覺：**
- Idle：▶（讓用戶直接從 hover 啟動）
- 工作中：橘色倒數 `MM:SS` + ⏸ + ■
- 休息中：藍色倒數 + ⏸ + ■
- 暫停中：灰色凍結倒數 + ▶ + ■

**倒數計算（無秒級 IPC）：**
```
收到 pomodoro-changed → 存 { startedAt, durationMs, elapsedMs, paused }
本地 setInterval(1000)：
  if paused → 顯示凍結值 (durationMs - elapsedMs)
  else → remaining = durationMs - elapsedMs - (Date.now() - startedAt)
```

**視窗尺寸注意**：pet window 目前 135×146，CSS `overflow: hidden`。  
Hover bar 設計為 overlay（absolute 於 pet 下方），不撐大視窗；需確認與 resize handle、badge、label 無重疊。實作時確認 hover bar 高度與 window 底部邊界，必要時調整 window 高度。

---

## Settings UI（`src/renderer/settings.html`）

新增「蕃茄鐘」區段，位於走動設定下方：

```
蕃茄鐘設定
├── [toggle] 啟用蕃茄鐘         ← 全域開關，預設 off；off 時以下欄位 disabled
├── [toggle] 顯示於「全部」      ← showOnAll，預設 on
├── 工作時間：[25] 分鐘
├── 休息時間：[ 5] 分鐘
└── 休息結束後：● 自動開始下一輪  ○ 暫停等待
```

Channels 設定頁（已有 per-channel UI）加 toggle：`顯示蕃茄鐘控制列`（`channel.pomodoroEnabled`）。

Settings window 目前 340×400，新增區段後評估是否需加高或加 scroll。

---

## 通知狀態總表

| 狀態 | 觸發 | 通知 |
|------|------|------|
| idle | 初始 / 停止後 | 無 |
| 工作中 | 按 ▶ | hover bar 橘色倒數（視覺狀態） |
| **工作結束** | elapsedMs ≥ workMs | Card：「🍅 休息一下！」autoDismiss 5s，不進通知中心 |
| 休息中 | 自動接續 | hover bar 藍色倒數 |
| **休息結束** | elapsedMs ≥ breakMs | Card：「⏰ 繼續工作！」autoDismiss 5s，不進通知中心 |
| 暫停中 | 按 ⏸ | 無（hover bar 倒數靜止） |
| 停止 | 按 ■ | 無，回 idle |

---

## Testing

`tests/core/pomodoro-timer.test.ts`（Vitest）覆蓋：
- work phase 結束 → effect `notify-work-end` + 切 break
- break 結束 + `afterBreak:'loop'` → 切 work
- break 結束 + `afterBreak:'pause'` → 切 idle
- PAUSE 凍結 elapsedMs；RESUME 繼續累加
- STOP 任意 phase → idle
- CONFIGURE 更新 workMs/breakMs

---

## UX 修正：清空按鈕語意對齊

**現況**：通知中心「全部已讀」旁的清空按鈕為全清（`MessageStore.clear()`），與「全部已讀」的範圍（當前 channel）不一致。

**修正**：清空改為「僅清空當前 channel match 到的訊息」。

- `'clear-messages'` IPC command 加 `channelId` 參數
- `MessageStore` 新增按 ids（或 predicate）刪除——以當前 channel 的 source matching 結果為準
- **已知副作用（預期行為）**：訊息可能同時 match 多個 channel，清空當前 channel 會把該訊息從其他 channel 視圖一併移除

---

## Out of Scope

- Rounds 計數（e.g., 4 個蕃茄後長休息）
- 音效
- 桌面寵物動畫與蕃茄鐘 phase 連動
- 多 channel 獨立蕃茄鐘（目前 global single timer）
- Internal notification interface 抽象化（待第二個 use case 出現再提取）
- 蕃茄鐘事件寫入 MessageStore / 通知中心歷史
