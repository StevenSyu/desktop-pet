# 視窗行為強化 — 設計文件

- 日期：2026-05-28
- 狀態：設計定案（待使用者最終審閱 → 進入實作計畫）
- 範圍代號：Spec ②（前為 ① 通知中心，後為 ③ 動畫與效能）

---

## 1. 定位與動機

現在 may 永遠釘在桌面右下角、`alwaysOnTop` level 為 `'screen-saver'`——這會蓋在別 App 的全螢幕內容上（看影片、簡報、Keynote），體感很差；且使用者無法把寵物搬到自己想要的位置；外接螢幕拔掉時座標可能漂到不可見處；「關閉小幫手」誤觸成本高。

本 spec 處理 4 項視窗行為改善：A1 拖動定位記憶、D2 全螢幕層級、D3 多螢幕重吸附、C2 關閉確認。

## 2. 範圍

**目標（v1）**
- 拖動寵物到任意位置、重啟記得。
- `alwaysOnTop` 改 `'floating'`，別 App 全螢幕時 macOS 自動讓 may 退場。
- 多螢幕熱插拔時，已儲存座標若失效自動吸附回 primary。
- 「關閉小幫手」跳確認對話框，避免誤觸。

**非目標（v1，延後）**
- 「不要再問」設定。
- 拖動範圍記憶到下次視窗大小變更（與大小變更無關，定位用單一座標即可）。
- 拖動時的吸附（snap to edge）與磁吸動畫。

## 3. 拖動定位記憶（A1）

**互動**
- 在寵物本體（`#pet`）上以**左鍵拖動**移動視窗。右鍵不啟動拖動（保留給選單）。
- 拖動使用自寫的 `pointerdown/move/up` + IPC + `win.setPosition`，**不用 `-webkit-app-region: drag`**（後者會吃掉滑鼠事件，導致右鍵選單／hover hit-test 失效）。
- 點擊（無位移或位移小於閾值）不視為拖動，仍可作為未來「點寵物」事件保留。

**訊號流**
```
renderer pet:
  pointerdown(button=0)  → IPC 'drag-start' (送目前游標 screenX/Y)
  pointermove (drag 中)  → IPC 'drag-move'  (送新的 screenX/Y)
  pointerup              → IPC 'drag-end'

main:
  drag-start → 記錄 startScreen=(sx,sy), startWin=win.getPosition()
  drag-move  → win.setPosition(startWin.x + sx_new - sx, startWin.y + sy_new - sy)
               （頻率以 requestAnimationFrame / 節流避免過多 IPC）
  drag-end   → 保存目前 (displayId, x, y) 到 window-state.json
```

**持久化**
- 檔案：`~/Library/Application Support/desktop-notify/window-state.json`
- 內容：`{ displayId: number, x: number, y: number }`
- 啟動時讀檔→驗證→`clampToValidPosition`：
  - 若 `displayId` 存在於目前 displays 且 (x,y) 位於該 display `workArea` 內 → 用該座標。
  - 否則 → 回退到 primary display 的右下角預設位置（與目前一致）。

## 4. 全螢幕層級（D2）

- 把 `setAlwaysOnTop(true, 'screen-saver')` **改為 `setAlwaysOnTop(true, 'floating')`**（NSFloatingWindowLevel）。
- 對 **pet window 與 center window 都改**。
- 行為：寵物仍在一般視窗之上（瀏覽器、編輯器、IM…），但低於系統全螢幕層級——別 App 進全螢幕時 macOS 會自動把 may 隱藏、回桌面才顯示。**不需要自寫全螢幕偵測**。
- `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` 維持（all-spaces 行為不變；`visibleOnFullScreen: true` 對 floating 仍生效——意指「在自家全螢幕視窗時可見」，不影響別 App 全螢幕的隱藏行為）。

## 5. 多螢幕事件處理（D3）

- 於 main 啟動時註冊一次：
  - `screen.on('display-removed', () => reSnapIfInvalid())`
  - `screen.on('display-added', noop)`（不主動移動，保持使用者習慣）
- `reSnapIfInvalid()`：
  - 取 pet window 目前 `getPosition()` 與 `getBounds()`。
  - 用 `screen.getAllDisplays()` 找該座標是否在某 display 的 `workArea` 內。
  - 若否 → `win.setBounds` 移到 primary display 工作區右下角（預設）。
- 啟動時讀 `window-state.json` 也走同一條驗證路徑（共用 `clampToValidPosition` 純函式）。

## 6. 關閉確認對話框（C2）

- 右鍵選單「關閉小幫手」的 click handler 改為：
  ```ts
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['取消', '關閉'],
    defaultId: 0,        // Enter = 取消，避免誤觸
    cancelId: 0,
    title: '關閉 may？',
    message: '關閉 may？',
    detail: '關閉後 Claude Code hook 仍會觸發，但 may 不會顯示。',
  })
  if (response === 1) app.quit()
  ```
- 不做「不要再問」（YAGNI）。

## 7. 架構與檔案

**新增**
- `src/core/window-position.ts`（純函式，可測）
  - `defaultPosition(workArea, w, h, margin)` → 右下角座標。
  - `clampToValidPosition(saved, displays, win, margin)` → 已儲存的 `{displayId,x,y}` 若有效就回，否則回 default。
- `src/main/window-state.ts`（IO，main 側）
  - `loadWindowState(userDataDir)` → `{displayId,x,y} | null`。
  - `saveWindowState(userDataDir, state)` → 寫檔（`0644` 即可，不含敏感資料）。

**修改**
- `src/main/window.ts`：
  - `setAlwaysOnTop` 第二參數改 `'floating'`。
  - 註冊一次 `ipcMain.on('drag-start'|'drag-move'|'drag-end')` 拖動處理 + 結束時呼叫 `saveWindowState`。
  - 註冊一次 `screen.on('display-removed', reSnapIfInvalid)`。
  - 啟動時讀 `loadWindowState` + `clampToValidPosition` 決定初始 x/y。
  - 「關閉小幫手」改為 `dialog.showMessageBox` 確認。
- `src/main/center-window.ts`：`setAlwaysOnTop` 改 `'floating'`。
- `src/preload/index.ts`：暴露 `dragStart(sx, sy)`, `dragMove(sx, sy)`, `dragEnd()`。
- `src/preload/api.d.ts`：型別。
- `src/renderer/main.ts`：在 `#pet` 上加 pointerdown/move/up 處理，呼叫 bridge 的 drag API；click vs drag 以位移閾值區分（≥3px 視為拖動）。

## 8. 測試策略

**核心 TDD**（`src/core/window-position.ts`）
- `defaultPosition`：給 workArea 與寵物尺寸/邊距，回傳右下角座標。
- `clampToValidPosition`：
  - 存的 `displayId` 與座標都在某 display workArea → 回原值。
  - `displayId` 不存在 → 回 primary 預設。
  - `displayId` 存在但座標在 workArea 外 → 回 primary 預設。
  - 沒有儲存（saved=null）→ 回 primary 預設。

**整合驗證**（手動 + 局部 Playwright）
- 拖動：手動拖動，重啟確認位置記得。
- 全螢幕：另開一個 App 進 macOS 全螢幕 → may 應消失；退出全螢幕 → 顯示。
- 多螢幕：模擬 `display-removed`（程式或外接拔線）→ may 跑回 primary。
- 關閉確認：右鍵→「關閉小幫手」應跳對話框；按取消不關、按關閉才結束。

## 9. v1 範圍 vs 之後

**v1**：A1 拖動＋持久化（含失效退回）、D2 floating、D3 display-removed 重吸附、C2 確認對話框。

**之後**：吸附邊緣、磁吸動畫、多 display 喜好（記住「上次在哪台 display 的相對位置」）、「不要再問」設定、寵物視窗大小可調。

## 10. 待確認/未決（進實作計畫前）

1. 拖動 click 閾值（建議 3px）。
2. drag-move 節流方式（建議 `requestAnimationFrame` 合併，最壞每幀一次 IPC）。
3. `window-state.json` 與 `endpoint.json` 同目錄（`~/Library/Application Support/desktop-notify/`）。
