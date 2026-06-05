# 通知音效 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通知/蕃茄鐘彈卡時 `shell.beep()`，獨立總開關（右鍵選單 + 進階設定）。

**Architecture:** beep 全在 main（事件層、DND guard 後）；prefs 一欄 + 一個 IPC command；pomodoro-driver 以 deps 注入 playSound。

**Spec:** `docs/superpowers/specs/2026-06-05-notify-sound-design.md`

---

### Task 1: Prefs + helper + 呼叫點 + 測試

**Files:**
- Modify: `src/main/prefs.ts`（Prefs.soundEnabled + DEFAULTS + loadPrefs fallback）
- Modify: `src/preload/api.d.ts`（BridgePrefs.soundEnabled）
- Modify: `src/main/index.ts`（playNotifySound helper + onEvent 呼叫點 + initPomodoro deps）
- Modify: `src/main/pomodoro-driver.ts`（deps 加 playSound、showInternal 呼叫）
- Test: `tests/main/prefs.test.ts`、`tests/main/pomodoro-driver.test.ts`

- [ ] prefs.test.ts 加 soundEnabled round-trip + fallback 測試（TDD：先 FAIL）
- [ ] prefs.ts 實作欄位 + fallback → 測試 PASS
- [ ] pomodoro-driver.test.ts：phase 結束呼叫 playSound、soundEnabled 由呼叫端 guard（deps spy）
- [ ] index.ts：`playNotifySound()`（getPrefs().soundEnabled && shell.beep()）；onEvent 的 dnd check 後呼叫；initPomodoro deps 傳入
- [ ] pomodoro-driver.ts：`PomodoroDeps` 加 `playSound: () => void`；showInternal dnd return 後呼叫
- [ ] `npm run typecheck && npm test` 全 PASS → commit

### Task 2: IPC + 右鍵選單 + 設定頁

**Files:**
- Modify: `src/ipc/contract.ts`（'set-sound-enabled': boolean）
- Modify: `src/preload/index.ts` + `api.d.ts`（setSoundEnabled）
- Modify: `src/main/window.ts`（handler + context menu checkbox「通知音效」）
- Modify: `src/renderer/settings.html` / `settings.ts`（「通知」區段 checkbox）

- [ ] contract + preload + api.d.ts 三層加 set-sound-enabled
- [ ] window.ts：`handleCommand('set-sound-enabled', (v) => updatePrefsStore({ soundEnabled: v }))`；menu 勿擾旁加 checkbox item（checked 讀 getPrefs、click 直接 updatePrefsStore toggle）
- [ ] settings.html 加「通知」group（走動間隔 section 前）：`<input id="soundEnabled" type="checkbox">`；settings.ts 載入/儲存/reset 接線
- [ ] `npm run typecheck && npm test` → commit

### Task 3: 驗證

- [ ] `npm run build && npm run e2e` → SMOKE PASS
- [ ] Playwright 驗證設定頁 toggle 持久化（getPrefs round-trip）
- [ ] merge main + push
