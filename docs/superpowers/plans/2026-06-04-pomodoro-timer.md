# Pomodoro Timer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 蕃茄鐘功能（global timer + per-pet hover 控制列 + transient card 提醒）＋ transient card 機制 ＋ 清空按鈕語意對齊。

**Architecture:** Pure reducer（`src/core/pomodoro-timer.ts`）持有全部 phase 邏輯，main process driver（`src/main/pomodoro-driver.ts`）以 `setInterval` 驅動並透過現有 card pipeline 顯示 transient 提醒。Renderer 收 `pomodoro-changed` snapshot 自行倒數，無秒級 IPC。蕃茄鐘繞過 ingest/MessageStore——即時通知不留歷史。

**Tech Stack:** Electron + electron-vite、TypeScript ESM、Vitest。

**Spec:** `docs/superpowers/specs/2026-06-04-pomodoro-timer-design.md`

**重要偏離 spec 說明（清空按鈕）:** spec 寫「`clear-messages` 加 `channelId`、main 算 channel match」。但 codebase 實況：「全部已讀」按鈕（`center.ts:259`）是 renderer 算 `centerView(state).items`（當前分頁＋session/type 篩選後可見項）的 ids → `markReadIds(ids)`。要與它語意一致，清空也應由 renderer 送同一批可見 ids。因此本 plan 採 **`clear-messages: string[]`（ids）** 方案——更精確對齊「全部已讀」的實際範圍。

---

## File Structure

```
建立：
  src/core/pomodoro-timer.ts        ← PomodoroPrefs/State/Action/Effect/Snapshot 型別 + pomodoroReducer + initialPomodoroState
  tests/core/pomodoro-timer.test.ts ← reducer 單元測試
  src/main/pomodoro-driver.ts       ← initPomodoro(deps)：interval、IPC handlers、prefs 訂閱、showInternalCard fan-out

修改：
  src/core/card-view.ts             ← CardView 加 transient?: { dismissMs: number }
  src/renderer/card.ts              ← transient auto-dismiss timer
  src/core/channel.ts               ← Channel 加 pomodoroEnabled + sanitize
  tests/core/channel.test.ts        ← sanitize 測試
  src/core/message-store.ts         ← removeByIds(ids)
  tests/core/message-store.test.ts  ← removeByIds 測試
  src/main/prefs.ts                 ← Prefs.pomodoro + DEFAULTS + loadPrefs sanitize
  src/ipc/contract.ts               ← pomodoro Commands/Pushes、set-pomodoro-prefs、clear-messages 改 string[]
  src/preload/index.ts              ← pomodoro 方法、clearMessages(ids)
  src/preload/api.d.ts              ← 對應型別
  src/main/index.ts                 ← clear-messages handler 改 ids、initPomodoro 接線
  src/renderer/index.html           ← #pomodoro-bar DOM
  src/renderer/styles.css           ← hover bar 樣式
  src/renderer/main.ts              ← hover bar 邏輯 + 倒數
  src/renderer/settings.html        ← 蕃茄鐘設定區段
  src/renderer/settings.ts          ← 讀寫 pomodoro prefs
  src/renderer/center.ts            ← 清空按鈕送可見 ids
  src/renderer/channels.tsx         ← per-channel 🍅 toggle
```

依賴順序：Task 1（core reducer）→ Task 2（transient card）→ Task 3（清空 ids）→ Task 4（prefs/channel）→ Task 5（IPC + preload）→ Task 6（driver）→ Task 7（hover bar）→ Task 8（settings UI）→ Task 9（channels toggle）→ Task 10（整體驗證）。

---

### Task 1: Core reducer `pomodoro-timer.ts`

**Files:**
- Create: `src/core/pomodoro-timer.ts`
- Test: `tests/core/pomodoro-timer.test.ts`

設計重點：
- `elapsedMs` 只累積「已完成的計時段」；運行中的當前段用 `now - startedAt` 即時計算。PAUSE 時把當前段折進 `elapsedMs`。
- `phaseDurationMs` 在 phase 開始時從 prefs **鎖定**——運行中 CONFIGURE 改 workMs/breakMs 不影響當前 phase（spec 行為決策 2）。
- Reducer 純函式、now 全部由 action 注入，無 `Date.now()`。

- [ ] **Step 1: 寫失敗測試**

```typescript
// tests/core/pomodoro-timer.test.ts
import { describe, it, expect } from 'vitest'
import {
  pomodoroReducer,
  initialPomodoroState,
  DEFAULT_POMODORO_PREFS,
  type PomodoroState,
} from '../../src/core/pomodoro-timer'

const PREFS = { ...DEFAULT_POMODORO_PREFS } // { enabled:false, workMs:1_500_000, breakMs:300_000, afterBreak:'loop', showOnAll:true }

function startedState(now = 1000): PomodoroState {
  return pomodoroReducer(initialPomodoroState(PREFS), { type: 'START', now }).state
}

describe('pomodoroReducer', () => {
  it('START：idle → work，鎖定 phaseDurationMs = workMs', () => {
    const { state, effect } = pomodoroReducer(initialPomodoroState(PREFS), { type: 'START', now: 1000 })
    expect(state.phase).toBe('work')
    expect(state.startedAt).toBe(1000)
    expect(state.elapsedMs).toBe(0)
    expect(state.paused).toBe(false)
    expect(state.phaseDurationMs).toBe(PREFS.workMs)
    expect(effect.type).toBe('none')
  })

  it('TICK 未達邊界：state 不變、effect none', () => {
    const s = startedState(1000)
    const { state, effect } = pomodoroReducer(s, { type: 'TICK', now: 1000 + PREFS.workMs - 1 })
    expect(state).toBe(s) // 同一參照：無變化不產生新物件
    expect(effect.type).toBe('none')
  })

  it('work 結束 → 切 break + effect notify-work-end', () => {
    const s = startedState(1000)
    const { state, effect } = pomodoroReducer(s, { type: 'TICK', now: 1000 + PREFS.workMs })
    expect(state.phase).toBe('break')
    expect(state.startedAt).toBe(1000 + PREFS.workMs)
    expect(state.elapsedMs).toBe(0)
    expect(state.phaseDurationMs).toBe(PREFS.breakMs)
    expect(effect.type).toBe('notify-work-end')
  })

  it("break 結束 + afterBreak:'loop' → 回 work + effect notify-break-end", () => {
    let s = startedState(0)
    s = pomodoroReducer(s, { type: 'TICK', now: PREFS.workMs }).state // → break
    const { state, effect } = pomodoroReducer(s, { type: 'TICK', now: PREFS.workMs + PREFS.breakMs })
    expect(state.phase).toBe('work')
    expect(state.phaseDurationMs).toBe(PREFS.workMs)
    expect(effect.type).toBe('notify-break-end')
  })

  it("break 結束 + afterBreak:'pause' → 回 idle + effect notify-break-end", () => {
    let s = pomodoroReducer(initialPomodoroState({ ...PREFS, afterBreak: 'pause' }), { type: 'START', now: 0 }).state
    s = pomodoroReducer(s, { type: 'TICK', now: PREFS.workMs }).state // → break
    const { state, effect } = pomodoroReducer(s, { type: 'TICK', now: PREFS.workMs + PREFS.breakMs })
    expect(state.phase).toBe('idle')
    expect(effect.type).toBe('notify-break-end')
  })

  it('PAUSE 折算 elapsedMs 並凍結；TICK 在 paused 下不前進', () => {
    let s = startedState(1000)
    s = pomodoroReducer(s, { type: 'PAUSE', now: 11_000 }).state // 跑了 10s
    expect(s.paused).toBe(true)
    expect(s.elapsedMs).toBe(10_000)
    const after = pomodoroReducer(s, { type: 'TICK', now: 999_999_999 })
    expect(after.state).toBe(s)
    expect(after.effect.type).toBe('none')
  })

  it('RESUME 重設 startedAt 繼續累計', () => {
    let s = startedState(1000)
    s = pomodoroReducer(s, { type: 'PAUSE', now: 11_000 }).state
    s = pomodoroReducer(s, { type: 'RESUME', now: 50_000 }).state
    expect(s.paused).toBe(false)
    expect(s.startedAt).toBe(50_000)
    expect(s.elapsedMs).toBe(10_000) // 已累計保留
    // 還差 workMs - 10s → 邊界在 50_000 + workMs - 10_000
    const { state } = pomodoroReducer(s, { type: 'TICK', now: 50_000 + PREFS.workMs - 10_000 })
    expect(state.phase).toBe('break')
  })

  it('STOP 任意狀態 → idle 歸零', () => {
    let s = startedState(1000)
    s = pomodoroReducer(s, { type: 'PAUSE', now: 2000 }).state
    const { state } = pomodoroReducer(s, { type: 'STOP' })
    expect(state.phase).toBe('idle')
    expect(state.elapsedMs).toBe(0)
    expect(state.paused).toBe(false)
    expect(state.phaseDurationMs).toBe(0)
  })

  it('運行中 CONFIGURE：當前 phase 邊界不變（phaseDurationMs 已鎖定），下一 phase 用新值', () => {
    let s = startedState(0)
    s = pomodoroReducer(s, { type: 'CONFIGURE', prefs: { workMs: 60_000, breakMs: 1_000, afterBreak: 'loop' } }).state
    expect(s.phaseDurationMs).toBe(PREFS.workMs) // 當前 work 仍是舊值
    // 邊界仍在舊 workMs
    const r1 = pomodoroReducer(s, { type: 'TICK', now: PREFS.workMs })
    expect(r1.state.phase).toBe('break')
    expect(r1.state.phaseDurationMs).toBe(1_000) // 下一 phase 用新 breakMs
  })

  it('PAUSE/RESUME 在 idle 是 no-op；START 在非 idle 是 no-op', () => {
    const idle = initialPomodoroState(PREFS)
    expect(pomodoroReducer(idle, { type: 'PAUSE', now: 1 }).state).toBe(idle)
    expect(pomodoroReducer(idle, { type: 'RESUME', now: 1 }).state).toBe(idle)
    const s = startedState(1000)
    expect(pomodoroReducer(s, { type: 'START', now: 2000 }).state).toBe(s)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/core/pomodoro-timer.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/pomodoro-timer'`

- [ ] **Step 3: 實作 reducer**

```typescript
// src/core/pomodoro-timer.ts
// 蕃茄鐘核心狀態機：純函式、now 由 caller 注入（與 walk-session/pet-fsm 同模式）。

export type PomodoroPhase = 'idle' | 'work' | 'break'

/** 持久化的蕃茄鐘偏好（存於 Prefs.pomodoro）。 */
export interface PomodoroPrefs {
  enabled: boolean
  workMs: number
  breakMs: number
  afterBreak: 'loop' | 'pause'
  showOnAll: boolean
}

export const DEFAULT_POMODORO_PREFS: PomodoroPrefs = {
  enabled: false,
  workMs: 25 * 60 * 1000,
  breakMs: 5 * 60 * 1000,
  afterBreak: 'loop',
  showOnAll: true,
}

export interface PomodoroState {
  phase: PomodoroPhase
  /** 當前計時段開始時間（paused/idle 時無意義）。 */
  startedAt: number
  /** 已完成計時段的累計；運行中的當前段另以 now - startedAt 計。 */
  elapsedMs: number
  paused: boolean
  /** phase 開始時鎖定的總長；運行中改設定不影響當前 phase。idle 為 0。 */
  phaseDurationMs: number
  workMs: number
  breakMs: number
  afterBreak: 'loop' | 'pause'
}

export type PomodoroAction =
  | { type: 'START'; now: number }
  | { type: 'PAUSE'; now: number }
  | { type: 'RESUME'; now: number }
  | { type: 'STOP' }
  | { type: 'TICK'; now: number }
  | { type: 'CONFIGURE'; prefs: Pick<PomodoroPrefs, 'workMs' | 'breakMs' | 'afterBreak'> }

export type PomodoroEffect = { type: 'notify-work-end' } | { type: 'notify-break-end' } | { type: 'none' }

/** 推給 renderer 的快照（pomodoro-changed push payload）。 */
export interface PomodoroSnapshot {
  phase: PomodoroPhase
  paused: boolean
  startedAt: number
  durationMs: number
  elapsedMs: number
}

const NONE: PomodoroEffect = { type: 'none' }

export function initialPomodoroState(prefs: PomodoroPrefs): PomodoroState {
  return {
    phase: 'idle',
    startedAt: 0,
    elapsedMs: 0,
    paused: false,
    phaseDurationMs: 0,
    workMs: prefs.workMs,
    breakMs: prefs.breakMs,
    afterBreak: prefs.afterBreak,
  }
}

export function toSnapshot(s: PomodoroState): PomodoroSnapshot {
  return { phase: s.phase, paused: s.paused, startedAt: s.startedAt, durationMs: s.phaseDurationMs, elapsedMs: s.elapsedMs }
}

export function pomodoroReducer(
  state: PomodoroState,
  action: PomodoroAction,
): { state: PomodoroState; effect: PomodoroEffect } {
  switch (action.type) {
    case 'START': {
      if (state.phase !== 'idle') return { state, effect: NONE }
      return {
        state: { ...state, phase: 'work', startedAt: action.now, elapsedMs: 0, paused: false, phaseDurationMs: state.workMs },
        effect: NONE,
      }
    }
    case 'PAUSE': {
      if (state.phase === 'idle' || state.paused) return { state, effect: NONE }
      return {
        state: { ...state, paused: true, elapsedMs: state.elapsedMs + (action.now - state.startedAt) },
        effect: NONE,
      }
    }
    case 'RESUME': {
      if (state.phase === 'idle' || !state.paused) return { state, effect: NONE }
      return { state: { ...state, paused: false, startedAt: action.now }, effect: NONE }
    }
    case 'STOP': {
      if (state.phase === 'idle') return { state, effect: NONE }
      return {
        state: { ...state, phase: 'idle', startedAt: 0, elapsedMs: 0, paused: false, phaseDurationMs: 0 },
        effect: NONE,
      }
    }
    case 'TICK': {
      if (state.phase === 'idle' || state.paused) return { state, effect: NONE }
      const total = state.elapsedMs + (action.now - state.startedAt)
      if (total < state.phaseDurationMs) return { state, effect: NONE }
      if (state.phase === 'work') {
        return {
          state: { ...state, phase: 'break', startedAt: action.now, elapsedMs: 0, phaseDurationMs: state.breakMs },
          effect: { type: 'notify-work-end' },
        }
      }
      // break 結束
      if (state.afterBreak === 'loop') {
        return {
          state: { ...state, phase: 'work', startedAt: action.now, elapsedMs: 0, phaseDurationMs: state.workMs },
          effect: { type: 'notify-break-end' },
        }
      }
      return {
        state: { ...state, phase: 'idle', startedAt: 0, elapsedMs: 0, phaseDurationMs: 0 },
        effect: { type: 'notify-break-end' },
      }
    }
    case 'CONFIGURE': {
      const { workMs, breakMs, afterBreak } = action.prefs
      if (workMs === state.workMs && breakMs === state.breakMs && afterBreak === state.afterBreak) {
        return { state, effect: NONE }
      }
      // 只改未來 phase 的參數；phaseDurationMs 不動（行為決策：下一 phase 生效）
      return { state: { ...state, workMs, breakMs, afterBreak }, effect: NONE }
    }
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/core/pomodoro-timer.test.ts`
Expected: PASS（10 tests）

- [ ] **Step 5: Commit**

```bash
git add src/core/pomodoro-timer.ts tests/core/pomodoro-timer.test.ts
git commit -m "feat: add pomodoro timer core reducer"
```

---

### Task 2: Transient card（CardView + card renderer）

**Files:**
- Modify: `src/core/card-view.ts`
- Modify: `src/renderer/card.ts`

Renderer 無單元測試框架（card.ts 是 DOM 程式）；型別改動由 `npm run typecheck` 驗證，行為由 Task 10 e2e 驗證。

- [ ] **Step 1: CardView 加 transient 欄位**

`src/core/card-view.ts` 的 `CardView` interface 加一個欄位（在 `hasMore` 之後）：

```typescript
  /** 即時通知（transient notice）：自動消失毫秒數。undefined = 持久訊息（進通知中心那類）。 */
  transient?: { dismissMs: number }
```

- [ ] **Step 2: card.ts 加 auto-dismiss timer**

`src/renderer/card.ts` 修改：

頂部變數區（`let currentId` 之後）加：

```typescript
let dismissTimer: ReturnType<typeof setTimeout> | null = null
```

`render(view)` 函式開頭（`currentId = view.id` 之前）加：

```typescript
  // 換卡先清舊 timer，避免舊 transient timer 關掉新卡
  if (dismissTimer) {
    clearTimeout(dismissTimer)
    dismissTimer = null
  }
```

`render(view)` 函式結尾（`root.appendChild(close)` 之後）加：

```typescript
  if (view.transient) {
    const id = view.id // 捕捉 render 當下的 id
    dismissTimer = setTimeout(() => {
      dismissTimer = null
      window.cardBridge.cardClicked(myChannel, id) // 走現有點關路徑：dismissCardsById 連帶關所有同 id 卡
    }, view.transient.dismissMs)
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: 無錯誤

- [ ] **Step 4: Commit**

```bash
git add src/core/card-view.ts src/renderer/card.ts
git commit -m "feat: support transient (auto-dismiss) cards"
```

---

### Task 3: 清空按鈕語意對齊（removeByIds 全鏈）

**Files:**
- Modify: `src/core/message-store.ts`
- Test: `tests/core/message-store.test.ts`
- Modify: `src/ipc/contract.ts:31`（`'clear-messages': void` → `string[]`）
- Modify: `src/preload/index.ts:41`
- Modify: `src/preload/api.d.ts`
- Modify: `src/main/index.ts:304-308`
- Modify: `src/renderer/center.ts:264`

- [ ] **Step 1: 寫失敗測試**

`tests/core/message-store.test.ts` 末尾加（沿用該檔現有 import / helper 風格——先讀檔頂部確認 MessageStore 建構方式再貼）：

```typescript
describe('removeByIds', () => {
  it('只刪指定 ids，其他保留', () => {
    const store = new MessageStore({ now: () => 1 })
    store.push({ id: 'a', type: 'info', title: 't', body: '', source: { kind: 'x' }, ttlMs: 5000 } as never)
    store.push({ id: 'b', type: 'info', title: 't', body: '', source: { kind: 'x' }, ttlMs: 5000 } as never)
    store.push({ id: 'c', type: 'info', title: 't', body: '', source: { kind: 'x' }, ttlMs: 5000 } as never)
    store.removeByIds(['a', 'c', 'not-exist'])
    expect(store.list().map((m) => m.id)).toEqual(['b'])
  })

  it('空陣列為 no-op', () => {
    const store = new MessageStore({ now: () => 1 })
    store.push({ id: 'a', type: 'info', title: 't', body: '', source: { kind: 'x' }, ttlMs: 5000 } as never)
    store.removeByIds([])
    expect(store.list()).toHaveLength(1)
  })
})
```

注意：`push` 的實際參數型別以 `message-store.ts` 現況為準——實作者先讀該測試檔現有 `push` 呼叫寫法，照抄結構（上面 `as never` 只是示意，請改成與現有測試一致的合法物件）。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/core/message-store.test.ts`
Expected: FAIL — `store.removeByIds is not a function`

- [ ] **Step 3: 實作 removeByIds**

`src/core/message-store.ts` 的 `MessageStore` class 內（`clear()` 方法旁）加：

```typescript
  /** 刪除指定 ids 的訊息（不存在的 id 忽略）。 */
  removeByIds(ids: string[]): void {
    if (ids.length === 0) return
    const set = new Set(ids)
    this.items = this.items.filter((m) => !set.has(m.id))
  }
```

注意：若 `items` 是 `readonly` 或 private 命名不同，以實際欄位為準（`items` 在 `message-store.ts:15`）。

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/core/message-store.test.ts`
Expected: PASS

- [ ] **Step 5: IPC contract 改 payload**

`src/ipc/contract.ts:31`：

```typescript
  'clear-messages': string[]
```

- [ ] **Step 6: preload 改簽名**

`src/preload/index.ts:41`：

```typescript
  clearMessages: (ids: string[]) => sendCommand('clear-messages', ids),
```

`src/preload/api.d.ts` 對應行：

```typescript
      clearMessages: (ids: string[]) => void
```

- [ ] **Step 7: main handler 改 removeByIds**

`src/main/index.ts:304-308`：

```typescript
  handleCommand('clear-messages', (ids) => {
    store.removeByIds(ids)
    broadcastUnread()
    broadcastMessages()
  })
```

- [ ] **Step 8: center.ts 清空按鈕送可見 ids**

`src/renderer/center.ts:264` 改為（與 `#mark-all` 同語意：當前分頁＋篩選後可見項）：

```typescript
document.querySelector('#clear')!.addEventListener('click', () => {
  // 與「全部已讀」同範圍：只清當前分頁 + session/type 篩選後可見的訊息
  const ids = centerView(state).items.map((m) => m.id)
  if (ids.length) window.petBridge.clearMessages(ids)
})
```

- [ ] **Step 9: Typecheck + 全測試**

Run: `npm run typecheck && npm test`
Expected: 全 PASS

- [ ] **Step 10: Commit**

```bash
git add src/core/message-store.ts tests/core/message-store.test.ts src/ipc/contract.ts src/preload/index.ts src/preload/api.d.ts src/main/index.ts src/renderer/center.ts
git commit -m "fix: align clear button scope with mark-all-read (visible items only)"
```

---

### Task 4: Prefs 與 Channel 擴充

**Files:**
- Modify: `src/main/prefs.ts`
- Modify: `src/core/channel.ts`
- Test: `tests/core/channel.test.ts`

- [ ] **Step 1: Channel 加 pomodoroEnabled — 寫失敗測試**

`tests/core/channel.test.ts` 的 sanitizeChannels 相關 describe 內加（照該檔現有測試的 channel 物件寫法）：

```typescript
  it('sanitizeChannels：pomodoroEnabled 預設 false、保留明確 true', () => {
    const raw = [
      { id: 'c1', name: 'A', skin: '', enabled: true, showPet: true, members: [{ kind: 'x' }] },
      { id: 'c2', name: 'B', skin: '', enabled: true, showPet: true, pomodoroEnabled: true, members: [{ kind: 'y' }] },
    ]
    const out = sanitizeChannels(raw)
    expect(out[0].pomodoroEnabled).toBe(false)
    expect(out[1].pomodoroEnabled).toBe(true)
  })
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/core/channel.test.ts`
Expected: FAIL（型別/欄位不存在）

- [ ] **Step 3: 實作 Channel 欄位**

`src/core/channel.ts:3`：

```typescript
export interface Channel { id: string; name: string; skin: string; enabled: boolean; showPet: boolean; pomodoroEnabled: boolean; members: SourceMatch[] }
```

`sanitizeChannels`（`channel.ts:47-63`）內，`showPet` 行之後加：

```typescript
    const pomodoroEnabled = typeof o.pomodoroEnabled === 'boolean' ? o.pomodoroEnabled : false // 向後相容：舊檔無此欄 → 關閉
```

並把 `out.push` 改為：

```typescript
    out.push({ id, name, skin, enabled, showPet, pomodoroEnabled, members })
```

- [ ] **Step 4: 修其他建構 Channel 的地方**

`npm run typecheck` 會列出所有缺欄位的 object literal。已知至少：
- `src/renderer/channels.tsx:62`：`upsert({ id: '', name, skin: ..., enabled: false, showPet: true, pomodoroEnabled: false, members: [] })`

跑 typecheck，把所有報錯處補上 `pomodoroEnabled: false`。

- [ ] **Step 5: Prefs 加 pomodoro**

`src/main/prefs.ts`：

頂部 import 加：

```typescript
import { DEFAULT_POMODORO_PREFS, type PomodoroPrefs } from '../core/pomodoro-timer'
```

`Prefs` interface（`prefs.ts:11-20`）加：

```typescript
  pomodoro: PomodoroPrefs
```

`DEFAULTS`（`prefs.ts:23-32`）加：

```typescript
  pomodoro: { ...DEFAULT_POMODORO_PREFS },
```

新增 sanitize 函式（檔內其他 sanitize 函式旁）：

```typescript
function sanitizePomodoro(raw: unknown): PomodoroPrefs {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const clampMin = (v: unknown, fallback: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback
    return Math.min(180 * 60_000, Math.max(60_000, n)) // 1–180 分鐘
  }
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_POMODORO_PREFS.enabled,
    workMs: clampMin(o.workMs, DEFAULT_POMODORO_PREFS.workMs),
    breakMs: clampMin(o.breakMs, DEFAULT_POMODORO_PREFS.breakMs),
    afterBreak: o.afterBreak === 'pause' ? 'pause' : 'loop',
    showOnAll: typeof o.showOnAll === 'boolean' ? o.showOnAll : DEFAULT_POMODORO_PREFS.showOnAll,
  }
}
```

`loadPrefs`（`prefs.ts:34-55`）三處 return 各加 pomodoro：
- 檔案不存在的 return：`pomodoro: { ...DEFAULTS.pomodoro },`
- try 內的 return：`pomodoro: sanitizePomodoro(parsed.pomodoro),`
- catch 的 return：`pomodoro: { ...DEFAULTS.pomodoro },`

- [ ] **Step 6: BridgePrefs 加 pomodoro**

`src/preload/api.d.ts` 的 `BridgePrefs` 加：

```typescript
  pomodoro: { enabled: boolean; workMs: number; breakMs: number; afterBreak: 'loop' | 'pause'; showOnAll: boolean }
```

（api.d.ts 是 ambient declaration 檔，避免新增 runtime import；inline 寫出結構。）

- [ ] **Step 7: Typecheck + 全測試**

Run: `npm run typecheck && npm test`
Expected: 全 PASS

- [ ] **Step 8: Commit**

```bash
git add src/core/channel.ts tests/core/channel.test.ts src/main/prefs.ts src/preload/api.d.ts src/renderer/channels.tsx
git commit -m "feat: add pomodoro prefs and per-channel pomodoroEnabled"
```

---

### Task 5: IPC contract + preload（pomodoro 通道）

**Files:**
- Modify: `src/ipc/contract.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/api.d.ts`

- [ ] **Step 1: contract 加 Commands/Pushes**

`src/ipc/contract.ts` 頂部 import 加：

```typescript
import type { PomodoroPrefs, PomodoroSnapshot } from '../core/pomodoro-timer'
```

`Commands` interface 內加：

```typescript
  'pomodoro-start': void
  'pomodoro-pause': void
  'pomodoro-resume': void
  'pomodoro-stop': void
  'set-pomodoro-prefs': Partial<PomodoroPrefs>
```

`Pushes` interface 內加：

```typescript
  'pomodoro-changed': PomodoroSnapshot
```

- [ ] **Step 2: preload/index.ts 加方法**

`petBridge` 物件內（`setWalkBounds` 附近）加：

```typescript
  pomodoroStart: () => sendCommand('pomodoro-start'),
  pomodoroPause: () => sendCommand('pomodoro-pause'),
  pomodoroResume: () => sendCommand('pomodoro-resume'),
  pomodoroStop: () => sendCommand('pomodoro-stop'),
  setPomodoroPrefs: (p: Partial<PomodoroPrefs>) => sendCommand('set-pomodoro-prefs', p),
  onPomodoroChanged: (cb: (s: PomodoroSnapshot) => void) => subscribePush('pomodoro-changed', cb),
```

頂部 import type 加 `PomodoroPrefs, PomodoroSnapshot`（from `'../core/pomodoro-timer'`）。

- [ ] **Step 3: api.d.ts 加宣告**

`petBridge` 宣告內加：

```typescript
      pomodoroStart: () => void
      pomodoroPause: () => void
      pomodoroResume: () => void
      pomodoroStop: () => void
      setPomodoroPrefs: (p: Partial<BridgePrefs['pomodoro']>) => void
      onPomodoroChanged: (
        cb: (s: { phase: 'idle' | 'work' | 'break'; paused: boolean; startedAt: number; durationMs: number; elapsedMs: number }) => void,
      ) => void
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: 無錯誤（handler 未實作不影響 typecheck——contract 是型別表）

- [ ] **Step 5: Commit**

```bash
git add src/ipc/contract.ts src/preload/index.ts src/preload/api.d.ts
git commit -m "feat: add pomodoro IPC contract and preload bridge"
```

---

### Task 6: Main driver `pomodoro-driver.ts`

**Files:**
- Create: `src/main/pomodoro-driver.ts`
- Modify: `src/main/index.ts`（接線）

- [ ] **Step 1: 實作 driver**

```typescript
// src/main/pomodoro-driver.ts
// 蕃茄鐘 main 端 driver：setInterval 驅動 core reducer，phase 結束以 transient card 提醒。
// 蕃茄鐘是內建即時通知——繞過 ingest/MessageStore，不進通知中心（spec：訊息二分法）。

import {
  pomodoroReducer,
  initialPomodoroState,
  toSnapshot,
  type PomodoroState,
  type PomodoroEffect,
} from '../core/pomodoro-timer'
import type { CardView } from '../core/card-view'
import { getPrefs, updatePrefsStore, subscribePrefs } from './prefs-store'
import { broadcastToPets, getPetWindow } from './window'
import { handleCommand } from '../ipc/main-helpers'

interface PomodoroDeps {
  /** 顯示一張卡片（index.ts 的 ensureCard + dispatchCard 包裝）。 */
  showCard: (channelId: string, view: CardView) => void
}

let state: PomodoroState
let timer: ReturnType<typeof setInterval> | null = null
let cardSeq = 0

function targets(): string[] {
  const p = getPrefs()
  const ids: string[] = []
  if (p.pomodoro.showOnAll && p.allEnabled) ids.push('all')
  for (const ch of p.channels) if (ch.pomodoroEnabled && ch.enabled && ch.showPet) ids.push(ch.id)
  return ids.filter((id) => getPetWindow(id) !== undefined)
}

function showInternal(deps: PomodoroDeps, view: Omit<CardView, 'id'>): void {
  if (getPrefs().dnd) return // 勿擾：與外部通知一致，吞掉（timer 照走）
  const id = `pomo-${++cardSeq}-${Date.now()}`
  for (const cid of targets()) deps.showCard(cid, { ...view, id })
}

function handleEffect(deps: PomodoroDeps, effect: PomodoroEffect): void {
  if (effect.type === 'notify-work-end') {
    showInternal(deps, {
      type: 'done',
      label: '🍅 休息一下！',
      body: '工作時間結束，好好休息。',
      source: '蕃茄鐘',
      hasMore: false,
      transient: { dismissMs: 5000 },
    })
  } else if (effect.type === 'notify-break-end') {
    showInternal(deps, {
      type: 'attention',
      label: '⏰ 繼續工作！',
      body: '休息結束，下一個蕃茄開始。',
      source: '蕃茄鐘',
      hasMore: false,
      transient: { dismissMs: 5000 },
    })
  }
}

function dispatch(deps: PomodoroDeps, action: Parameters<typeof pomodoroReducer>[1]): void {
  const prev = state
  const r = pomodoroReducer(state, action)
  state = r.state
  handleEffect(deps, r.effect)
  // phase/paused/startedAt 任一變化 → 推快照（TICK 未達邊界回同參照，不會誤推）
  if (prev !== state) broadcastToPets('pomodoro-changed', toSnapshot(state))
}

function startInterval(deps: PomodoroDeps): void {
  if (timer) return
  timer = setInterval(() => dispatch(deps, { type: 'TICK', now: Date.now() }), 1000)
}

function stopInterval(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function initPomodoro(deps: PomodoroDeps): void {
  state = initialPomodoroState(getPrefs().pomodoro)
  if (getPrefs().pomodoro.enabled) startInterval(deps)

  handleCommand('pomodoro-start', () => dispatch(deps, { type: 'START', now: Date.now() }))
  handleCommand('pomodoro-pause', () => dispatch(deps, { type: 'PAUSE', now: Date.now() }))
  handleCommand('pomodoro-resume', () => dispatch(deps, { type: 'RESUME', now: Date.now() }))
  handleCommand('pomodoro-stop', () => dispatch(deps, { type: 'STOP' }))
  handleCommand('set-pomodoro-prefs', (partial) => {
    const next = { ...getPrefs().pomodoro, ...partial }
    updatePrefsStore({ pomodoro: next }) // prefs-changed broadcast 由 subscribePrefs 統一處理
  })

  subscribePrefs((p, changed) => {
    if (!changed.has('pomodoro')) return
    if (p.pomodoro.enabled) {
      startInterval(deps)
      dispatch(deps, { type: 'CONFIGURE', prefs: { workMs: p.pomodoro.workMs, breakMs: p.pomodoro.breakMs, afterBreak: p.pomodoro.afterBreak } })
    } else {
      // 行為決策：關全域開關 → 立即停止回 idle
      dispatch(deps, { type: 'STOP' })
      stopInterval()
    }
  })
}

/** 新 pet window 載入後補推當前快照（renderer 初始化用）。 */
export function pushPomodoroSnapshot(): void {
  broadcastToPets('pomodoro-changed', toSnapshot(state))
}
```

注意：
- `updatePrefsStore` / `subscribePrefs` 的實際簽名以 `src/main/prefs-store.ts` 為準（`subscribePrefs((p, changed) => ...)` 模式見 `index.ts:49`）。
- `window.ts` 的 `subscribePrefs`（`window.ts:31`）以 `PET_PREFS_KEYS` 過濾後 broadcast `prefs-changed`；確認 `'pomodoro'` 在 `PET_PREFS_KEYS` 內（renderer hover bar 靠 `prefs-changed` 更新顯示條件）。不在就加進去。

- [ ] **Step 2: index.ts 接線**

`src/main/index.ts`：

頂部 import 加：

```typescript
import { initPomodoro } from './pomodoro-driver'
```

在 app ready 後、IPC handlers 註冊的同一初始化區段（`handleCommand('show-card', ...)` 附近）加：

```typescript
  initPomodoro({
    showCard: (channelId, view) => {
      ensureCard(channelId)
      dispatchCard(channelId, { kind: 'show', view })
    },
  })
```

- [ ] **Step 3: Typecheck + 全測試**

Run: `npm run typecheck && npm test`
Expected: 全 PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/pomodoro-driver.ts src/main/index.ts src/main/window.ts
git commit -m "feat: add pomodoro main-process driver"
```

---

### Task 7: Renderer hover bar

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/main.ts`

- [ ] **Step 1: index.html 加 DOM**

`#pet-shell` 內（`#resize-handle` 之後）加：

```html
      <div id="pomodoro-bar" hidden>
        <span id="pomo-time">--:--</span>
        <button id="pomo-toggle" title="開始">▶</button>
        <button id="pomo-stop" title="停止">■</button>
      </div>
```

- [ ] **Step 2: styles.css 加樣式**

檔尾加：

```css
/* ===== 蕃茄鐘 hover 控制列 ===== */
#pomodoro-bar {
  position: absolute;
  left: 50%;
  bottom: 2px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 10px;
  background: rgba(20, 20, 30, 0.85);
  pointer-events: auto;
  z-index: 5;
  font-size: 11px;
}
#pomodoro-bar[hidden] { display: none; }
#pomo-time {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  min-width: 34px;
  text-align: center;
  color: #999; /* idle */
}
#pomodoro-bar[data-phase='work'] #pomo-time { color: #f97316; }   /* 工作：橘 */
#pomodoro-bar[data-phase='break'] #pomo-time { color: #38bdf8; }  /* 休息：藍 */
#pomodoro-bar[data-paused='true'] #pomo-time { color: #9ca3af; }  /* 暫停：灰 */
#pomodoro-bar button {
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.12);
  color: #ddd;
  font-size: 10px;
  line-height: 1;
  padding: 3px 6px;
  cursor: pointer;
}
#pomodoro-bar button:hover { background: rgba(255, 255, 255, 0.25); }
```

注意：`#pet-shell` 須為 positioning context——確認其 CSS 有 `position: relative`（或同等），沒有就加。

- [ ] **Step 3: main.ts 加 hover bar 邏輯**

`src/renderer/main.ts`：

元素引用區（`handleEl` 附近）加：

```typescript
const pomoBarEl = document.querySelector<HTMLDivElement>('#pomodoro-bar')!
const pomoTimeEl = document.querySelector<HTMLSpanElement>('#pomo-time')!
const pomoToggleEl = document.querySelector<HTMLButtonElement>('#pomo-toggle')!
const pomoStopEl = document.querySelector<HTMLButtonElement>('#pomo-stop')!
```

狀態變數區加：

```typescript
type PomoSnapshot = { phase: 'idle' | 'work' | 'break'; paused: boolean; startedAt: number; durationMs: number; elapsedMs: number }
let pomoSnap: PomoSnapshot = { phase: 'idle', paused: false, startedAt: 0, durationMs: 0, elapsedMs: 0 }
let pomoVisible = false // 由 prefs 算出：此 pet 是否顯示蕃茄鐘控制列
let pomoHovering = false
let pomoTickTimer: ReturnType<typeof setInterval> | null = null
```

函式區加：

```typescript
function pomoRemainingMs(): number {
  if (pomoSnap.phase === 'idle') return 0
  const run = pomoSnap.paused ? 0 : Date.now() - pomoSnap.startedAt
  return Math.max(0, pomoSnap.durationMs - pomoSnap.elapsedMs - run)
}

function fmtMmSs(ms: number): string {
  const s = Math.ceil(ms / 1000)
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function renderPomoBar(): void {
  pomoBarEl.hidden = !(pomoVisible && pomoHovering)
  if (pomoBarEl.hidden) return
  pomoBarEl.dataset.phase = pomoSnap.phase
  pomoBarEl.dataset.paused = String(pomoSnap.paused)
  if (pomoSnap.phase === 'idle') {
    pomoTimeEl.textContent = '--:--'
    pomoToggleEl.textContent = '▶'
    pomoToggleEl.title = '開始'
    pomoStopEl.disabled = true
  } else {
    pomoTimeEl.textContent = fmtMmSs(pomoRemainingMs())
    pomoToggleEl.textContent = pomoSnap.paused ? '▶' : '⏸'
    pomoToggleEl.title = pomoSnap.paused ? '繼續' : '暫停'
    pomoStopEl.disabled = false
  }
}

function syncPomoTicker(): void {
  const need = pomoVisible && pomoSnap.phase !== 'idle' && !pomoSnap.paused
  if (need && !pomoTickTimer) pomoTickTimer = setInterval(renderPomoBar, 1000)
  if (!need && pomoTickTimer) {
    clearInterval(pomoTickTimer)
    pomoTickTimer = null
  }
}

function applyPomoPrefs(p: { pomodoro: { enabled: boolean; showOnAll: boolean }; allEnabled: boolean; channels: { id: string; enabled: boolean; pomodoroEnabled: boolean }[] }): void {
  if (!p.pomodoro.enabled) pomoVisible = false
  else if (myChannel === 'all') pomoVisible = p.pomodoro.showOnAll
  else pomoVisible = p.channels.some((c) => c.id === myChannel && c.enabled && c.pomodoroEnabled)
  syncPomoTicker()
  renderPomoBar()
}
```

事件接線（初始化區，其他 `window.petBridge.on*` 附近）加：

```typescript
window.petBridge.onPomodoroChanged((s) => {
  pomoSnap = s
  syncPomoTicker()
  renderPomoBar()
})
window.petBridge.getPrefs().then(applyPomoPrefs)
window.petBridge.onPrefsChanged(applyPomoPrefs)

pomoToggleEl.addEventListener('click', (e) => {
  e.stopPropagation()
  if (pomoSnap.phase === 'idle') window.petBridge.pomodoroStart()
  else if (pomoSnap.paused) window.petBridge.pomodoroResume()
  else window.petBridge.pomodoroPause()
})
pomoStopEl.addEventListener('click', (e) => {
  e.stopPropagation()
  window.petBridge.pomodoroStop()
})
```

`bindHover()`（`main.ts:260-283`）的 mouseenter callback 內加：

```typescript
    pomoHovering = true
    renderPomoBar()
```

mouseleave callback 內（`if (!resizing)` 區塊內）加：

```typescript
      pomoHovering = false
      renderPomoBar()
```

注意：`onPrefsChanged` 既有 callback 若已存在訂閱，確認多次 subscribe 是否安全（`subscribePush` 模式允許多 listener 則直接加；否則整合進現有 callback）。

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: 無錯誤

- [ ] **Step 5: Commit**

```bash
git add src/renderer/index.html src/renderer/styles.css src/renderer/main.ts
git commit -m "feat: add pomodoro hover control bar on pet"
```

---

### Task 8: Settings UI

**Files:**
- Modify: `src/renderer/settings.html`
- Modify: `src/renderer/settings.ts`
- Modify: `src/renderer/settings.css`（如需）

- [ ] **Step 1: settings.html 加區段**

走動秒數 `</section>` 之後、`<footer>` 之前加：

```html
      <section class="group">
        <div class="g-title">蕃茄鐘</div>
        <div class="g-desc">啟用後，hover 寵物會顯示倒數與控制按鈕。</div>
        <div class="row">
          <label>啟用蕃茄鐘</label><input id="pomoEnabled" type="checkbox" />
        </div>
        <div class="row">
          <label>顯示於「全部」</label><input id="pomoShowOnAll" type="checkbox" />
        </div>
        <div class="row">
          <label>工作時間</label><input id="pomoWork" type="number" min="1" max="180" step="1" /><span class="unit">分</span>
        </div>
        <div class="row">
          <label>休息時間</label><input id="pomoBreak" type="number" min="1" max="180" step="1" /><span class="unit">分</span>
        </div>
        <div class="row">
          <label>休息結束後</label>
          <select id="pomoAfterBreak">
            <option value="loop">自動開始下一輪</option>
            <option value="pause">暫停等待</option>
          </select>
        </div>
      </section>
```

標題 `進階設定 · 走動參數` 改為 `進階設定`（區段不只走動了）。

- [ ] **Step 2: settings.ts 加讀寫**

元素引用區加：

```typescript
const pomoEnabled = $<HTMLInputElement>('pomoEnabled')
const pomoShowOnAll = $<HTMLInputElement>('pomoShowOnAll')
const pomoWork = $<HTMLInputElement>('pomoWork')
const pomoBreak = $<HTMLInputElement>('pomoBreak')
const pomoAfterBreak = $<HTMLSelectElement>('pomoAfterBreak')
```

加套用/讀取函式：

```typescript
type PomoPrefs = { enabled: boolean; workMs: number; breakMs: number; afterBreak: 'loop' | 'pause'; showOnAll: boolean }

function applyPomodoro(p: PomoPrefs): void {
  pomoEnabled.checked = p.enabled
  pomoShowOnAll.checked = p.showOnAll
  pomoWork.value = String(Math.round(p.workMs / 60_000))
  pomoBreak.value = String(Math.round(p.breakMs / 60_000))
  pomoAfterBreak.value = p.afterBreak
  syncPomoDisabled()
}

function readPomodoro(): PomoPrefs {
  const clampMin = (v: string): number => Math.min(180, Math.max(1, Math.round(Number(v) || 0)))
  return {
    enabled: pomoEnabled.checked,
    showOnAll: pomoShowOnAll.checked,
    workMs: clampMin(pomoWork.value) * 60_000,
    breakMs: clampMin(pomoBreak.value) * 60_000,
    afterBreak: pomoAfterBreak.value === 'pause' ? 'pause' : 'loop',
  }
}

function syncPomoDisabled(): void {
  const off = !pomoEnabled.checked
  for (const el of [pomoShowOnAll, pomoWork, pomoBreak, pomoAfterBreak]) el.disabled = off
}
pomoEnabled.addEventListener('change', syncPomoDisabled)
```

`getPrefs().then` 改為同時套用兩者：

```typescript
window.petBridge.getPrefs().then((p) => {
  applyBounds(p.walk)
  applyPomodoro(p.pomodoro)
})
```

`#save` click handler 改為：

```typescript
$('save').addEventListener('click', () => {
  window.petBridge.setWalkBounds(readForm())
  window.petBridge.setPomodoroPrefs(readPomodoro())
  window.close()
})
```

`#reset` click handler 加一行：

```typescript
  applyPomodoro({ enabled: false, workMs: 25 * 60_000, breakMs: 5 * 60_000, afterBreak: 'loop', showOnAll: true })
```

- [ ] **Step 3: 視窗高度**

設定視窗 340×400（`window-factory.ts:113-129`）。新增區段後內容變高——把該工廠的高度改為 620（或實測適合值；settings.css 若 `.panel` 有固定高也同步調）。

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: 無錯誤

- [ ] **Step 5: Commit**

```bash
git add src/renderer/settings.html src/renderer/settings.ts src/renderer/settings.css src/main/window-factory.ts
git commit -m "feat: add pomodoro section to settings window"
```

---

### Task 9: Channels 設定 🍅 toggle

**Files:**
- Modify: `src/renderer/channels.tsx`
- Modify: `src/renderer/channels.css`（如需樣式）

- [ ] **Step 1: 加 toggle 按鈕**

`channels.tsx:96` 眼睛按鈕（`class="eye"`）旁加蕃茄按鈕（同列、同 stopPropagation 模式）：

```tsx
        <button
          class={'pomo' + (ch.pomodoroEnabled ? ' on' : '')}
          disabled={!ch.enabled}
          title={!ch.enabled ? '頻道停用中' : ch.pomodoroEnabled ? '蕃茄鐘控制列顯示中（點按隱藏）' : '顯示蕃茄鐘控制列'}
          onClick={(e) => { stop(e); upsert({ ...ch, pomodoroEnabled: !ch.pomodoroEnabled }) }}
          aria-label="蕃茄鐘控制列切換"
        >🍅</button>
```

- [ ] **Step 2: channels.css 樣式**

照 `.eye` 既有樣式模式加 `.pomo`（実際樣式以 `.eye` 在 channels.css 的寫法為準）：

```css
.pomo { opacity: 0.35; }
.pomo.on { opacity: 1; }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: 無錯誤

- [ ] **Step 4: Commit**

```bash
git add src/renderer/channels.tsx src/renderer/channels.css
git commit -m "feat: add per-channel pomodoro toggle in channels UI"
```

---

### Task 10: 整體驗證

**Files:** 無新增（驗證）

- [ ] **Step 1: 全套自動驗證**

Run: `npm run typecheck && npm test`
Expected: 全 PASS

- [ ] **Step 2: e2e smoke**

Run: `npm run e2e`
Expected: PASS（截圖產出，可目視 pet window 正常）

- [ ] **Step 3: 手動驗證清單（dev 模式）**

Run: `npm run dev`，逐項確認：

1. 設定視窗：蕃茄鐘區段顯示、開關 off 時欄位 disabled
2. 啟用蕃茄鐘＋儲存 → hover「全部」pet → 控制列出現、顯示 `--:--` 與 ▶
3. 按 ▶ → 倒數開始（橘色）；⏸ → 凍結（灰）；再按 ▶ → 繼續；■ → 回 `--:--`
4. 把工作時間設 1 分鐘等 phase 結束 → transient card 彈出、5 秒自動消失、通知中心**無**該訊息、badge 不變
5. 休息倒數為藍色；`afterBreak=loop` 時自動接下一輪 work
6. DND 開啟時 phase 結束 → 無 card，timer 照走（hover 顏色變化可見）
7. channels 視窗：自訂頻道 🍅 toggle 可切換；開啟後該 channel pet hover 也有控制列、與「全部」同步倒數
8. 通知中心：切到某分頁 → 按清空 → 只有可見訊息被刪（其他分頁訊息保留，與「全部已讀」範圍一致）
9. 重啟 app → timer 回 idle

- [ ] **Step 4: Commit（如有修正）**

```bash
git add -A
git commit -m "fix: polish pomodoro implementation after manual verification"
```

---

## Self-Review 紀錄

- **Spec coverage**：訊息二分法（Task 2/6）、core reducer + 全行為決策（Task 1）、prefs/channel opt-in（Task 4）、IPC（Task 5）、driver + DND + targets（Task 6）、hover bar 含顏色/雙語意 ▶（Task 7）、settings 含 1–180 clamp（Task 4 sanitize + Task 8 UI）、channels toggle（Task 9）、清空對齊（Task 3）、重啟回 idle = 不持久化 timer state（driver 天然如此）。
- **偏離 spec**：清空按鈕採可見 ids 方案（見開頭說明）；settings 視窗加高（spec 已預告需評估）。
- **型別一致性**：`PomodoroPrefs`/`PomodoroSnapshot` 單一定義於 `src/core/pomodoro-timer.ts`，main/preload/contract 全部 import 同源；`api.d.ts` 為 ambient 檔採 inline 結構（與其 BridgePrefs 現有作法一致）。
