# Pomodoro Timer — Design Spec

Date: 2026-06-04

## Overview

在 desktop-notify 桌面寵物 app 中加入蕃茄鐘功能。功能以 **per-channel opt-in** 方式整合，蕃茄鐘視為一種內建的 notification source，提醒走現有 card pipeline，不增加新架構複雜度。

同時擴充通知系統支援 **Toast TTL**（自動消失時間），作為蕃茄鐘提醒的前置需求。

---

## Scope

### 功能 1：Toast TTL（通知自動消失）

`AppEvent` 加選用 `ttl?: number`（毫秒）。

- `ttl` 未定義 → persistent（現有預設行為，backward compat 零破壞）
- `ttl: 5000` → 5 秒後 card 自動 dismiss
- Card renderer 收到有 `ttl` 的 event → `setTimeout(ttl)` 後自動關閉

### 功能 2：蕃茄鐘

使用者可啟用蕃茄鐘功能，在選定的 channel pet 上 hover 顯示控制列（倒數 + 按鈕），phase 結束時以 card 通知提醒。

---

## Architecture

```
src/core/pomodoro-timer.ts     ← pure reducer，平台中立，unit testable
src/main/pomodoro-driver.ts    ← setInterval 驅動 reducer；fire AppEvent；處理 IPC
src/renderer/main.ts           ← 接 push，渲染 hover bar
src/ipc/contract.ts            ← 新增 Commands + Pushes
src/renderer/settings.html/ts  ← 新增「蕃茄鐘」設定區段
src/core/events.ts             ← AppEvent 加 ttl 欄位
src/core/prefs.ts              ← Prefs 加 PomodoroPrefs
```

### 資料流

```
用戶按 ▶
  → renderer IPC Command: pomodoro-start
  → pomodoro-driver dispatch(START)
  → setInterval 每秒 TICK
  → phase 切換 → push pomodoro-changed { phase, paused, startedAt, durationMs }
  → renderer 計算剩餘秒，自行 setInterval 更新倒數顯示
  → phase elapsed 歸零 → reducer 回傳 effect
  → driver inject AppEvent (ttl:5000) → 現有 message-store → card
```

---

## Core Module：`src/core/pomodoro-timer.ts`

純函式，不依賴 Electron / Node。

### State

```typescript
type PomodoroPhase = 'idle' | 'work' | 'break'

interface PomodoroState {
  phase: PomodoroPhase
  startedAt: number       // phase 開始的 now()（by caller 注入）
  elapsed: number         // ms，paused 時凍結
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

Reducer 處理所有 phase 邊界判斷，driver 只讀 effect 決定是否發通知，不自行判斷邊界。

### State Machine

```
idle ──START──→ work ──elapsed≥workMs──→ break ──elapsed≥breakMs──→ work (loop)
                                                                  └──→ idle (pause mode)
work / break ──PAUSE──→ paused（phase 不變，elapsed 凍結）
paused ──RESUME──→ 繼續計時
any ──STOP──→ idle
```

---

## Prefs 擴充

```typescript
// src/core/prefs.ts
interface PomodoroPrefs {
  enabled: boolean               // 全域開關，預設 false
  workMs: number                 // 預設 25 * 60 * 1000
  breakMs: number                // 預設 5 * 60 * 1000
  afterBreak: 'loop' | 'pause'  // 預設 'loop'
}

interface Prefs {
  // ...現有欄位...
  pomodoro: PomodoroPrefs
}
```

Channel 設定（`src/core/channel.ts`）加 `pomodoroEnabled: boolean`。預設值依 channel 類型：「全部」(default channel) 預設 `true`，自訂 channel 預設 `false`。`PomodoroPrefs.enabled` 為全域開關，二者皆 true 才顯示 hover bar。

---

## IPC Contract 新增（`src/ipc/contract.ts`）

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
  startedAt:  number   // ms timestamp
  durationMs: number   // 當前 phase 總長
}
```

---

## Main Driver：`src/main/pomodoro-driver.ts`

- App 啟動時 init，從 prefs 建初始 `PomodoroState`
- `setInterval(1000)` 每秒 `dispatch({ type: 'TICK', now: Date.now() })`
- Effect 處理：
  - `notify-work-end` → inject `AppEvent { title: '🍅 休息一下！', body: '工作時間結束，好好休息。', ttl: 5000 }`
  - `notify-break-end` → inject `AppEvent { title: '⏰ 繼續工作！', body: '休息結束，下一個蕃茄開始。', ttl: 5000 }`
- Phase 切換時 `pushTo(win, 'pomodoro-changed', { phase, paused, startedAt, durationMs })`
- 監聽 Commands → 對應 dispatch
- `PomodoroPrefs.enabled = false` 時不啟動 driver

---

## Renderer Hover Bar（`src/renderer/main.ts`）

顯示條件：`PomodoroPrefs.enabled && channel.pomodoroEnabled`

**視覺：**
- 工作中：橘色倒數 `MM:SS` + ⏸ + ■
- 休息中：藍/綠色倒數 + ⏸ + ■
- 暫停中：灰色凍結倒數 + ▶ + ■
- Idle：顯示 ▶（讓用戶直接從 hover bar 啟動，不需進設定）

**倒數計算（無秒級 IPC）：**
收到 `pomodoro-changed` → 存 `{ startedAt, durationMs }`  
本地 `setInterval(1000)` → `remaining = durationMs - (Date.now() - startedAt) - elapsed`

---

## Settings UI（`src/renderer/settings.html`）

新增「蕃茄鐘」區段，位於走動設定下方：

```
蕃茄鐘設定
├── [toggle] 啟用蕃茄鐘         ← 全域開關，預設 off；off 時以下欄位 disabled
├── 工作時間：[25] 分鐘
├── 休息時間：[ 5] 分鐘
└── 休息結束後：● 自動開始下一輪  ○ 暫停等待
```

Channels 設定頁已有 per-channel UI，加一個 toggle：`顯示蕃茄鐘控制列`（`pomodoroEnabled`）。

---

## 通知狀態總表

| 狀態 | 觸發 | 通知 |
|------|------|------|
| idle | 初始 / 停止後 | 無 |
| 工作中 | 按 ▶ | hover bar 橘色倒數（視覺狀態） |
| **工作結束** | elapsed ≥ workMs | Card：「🍅 休息一下！」ttl=5s |
| 休息中 | 自動接續 | hover bar 藍色倒數 |
| **休息結束** | elapsed ≥ breakMs | Card：「⏰ 繼續工作！」ttl=5s |
| 暫停中 | 按 ⏸ | 無（hover bar 倒數靜止） |
| 停止 | 按 ■ | 無，回 idle |

---

## Testing

`tests/core/pomodoro-timer.test.ts`（Vitest）覆蓋：
- work phase 結束 → effect `notify-work-end` + 切 break
- break 結束 + `afterBreak:'loop'` → 切 work
- break 結束 + `afterBreak:'pause'` → 切 idle
- PAUSE 凍結 elapsed；RESUME 繼續
- STOP 任意 phase → idle
- CONFIGURE 更新 workMs/breakMs

---

## Out of Scope

- Rounds 計數（e.g., 4 個蕃茄後長休息）
- 音效
- 桌面寵物動畫與蕃茄鐘 phase 連動
- 多 channel 蕃茄鐘同步運行（目前單一 global timer）
