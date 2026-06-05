# 通知音效 — Design Spec

Date: 2026-06-05

## Overview

通知到達時播放系統提示音，獨立總開關（與頻道 enabled 解耦）。beep 全在 main process——零 renderer 參與、零 push。

## 行為決策（brainstorm 確認）

| 決策 | 結果 |
|------|------|
| 開關形式 | 獨立總開關（非 per-channel）——音效是「要不要吵我」維度，與頻道訂閱解耦 |
| 觸發範圍 | 所有彈卡事件：外部通知 + 蕃茄鐘提醒（看得到卡 = 聽得到聲） |
| 音效來源 | `shell.beep()` 系統提示音——零資產、main 一行、尊重系統音量 |
| 開關入口 | 右鍵選單（與勿擾並列）+ 進階設定 |
| 預設值 | `true`（通知工具的合理期待） |
| DND 互動 | beep 呼叫點皆在 DND guard 之後——DND 開 = 不彈卡也不響 |
| 多窗 fan-out | beep 在事件層（fan-out 前）——同一訊息多寵物窗只響一次 |

## 變更

### Prefs（`src/main/prefs.ts`）

- `Prefs` 加 `soundEnabled: boolean`；`DEFAULTS` 補 `true`
- `loadPrefs` 三路徑（檔案不存在 / parsed / catch）補 fallback：`typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : true`
- `src/preload/api.d.ts` 的 `BridgePrefs` 加 `soundEnabled: boolean`（getPrefs 回傳完整 Prefs）

### 播放 helper（main）

`index.ts`（或小 util）：

```typescript
function playNotifySound(): void {
  if (getPrefs().soundEnabled) shell.beep()
}
```

呼叫點：
1. `index.ts` `onEvent`——dnd check 後、卡片 target fan-out 前
2. `pomodoro-driver.ts` `showInternal`——dnd early-return 之後

pomodoro-driver 不重複實作 helper——deps 注入 `playSound: () => void`（與 showCard 同模式），index.ts 注入同一 helper。

### IPC（`src/ipc/contract.ts`）

Commands 加 `'set-sound-enabled': boolean`。preload（`src/preload/index.ts` + `api.d.ts`）加 `setSoundEnabled(v)`。main handler（`window.ts`，與 set-dnd 同 domain owner）：`updatePrefsStore({ soundEnabled: v })`。

### 右鍵選單（`src/main/window.ts`）

context menu「勿擾模式」旁加 checkbox item「通知音效」：`checked: getPrefs().soundEnabled`，click → `updatePrefsStore({ soundEnabled: !current })`（main 內直接寫，零 IPC）。

### 進階設定（`src/renderer/settings.html` / `settings.ts`）

新「通知」區段（走動間隔上方）一個 checkbox「通知音效」。載入 `getPrefs().soundEnabled` 套用；儲存時 `setSoundEnabled(checked)`；恢復預設 → checked = true。

## Testing

- `tests/main/prefs.test.ts`：soundEnabled round-trip + 缺欄/非 boolean fallback true
- `tests/main/pomodoro-driver.test.ts`：phase 結束 → `playSound` deps 被呼叫；DND 開 → 不呼叫
- beep 本體（shell.beep）不可自動驗聲——unit 驗呼叫即可

## Out of Scope

- 自訂音檔 / 音色選擇
- per-channel 靜音（需求出現再加，`pomodoroEnabled` 模式現成）
- 音量控制
