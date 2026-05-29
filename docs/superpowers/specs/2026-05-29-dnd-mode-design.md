# 勿擾模式（DND） — 設計文件

- 日期：2026-05-29
- 狀態：設計定案（待使用者最終審閱 → 進入實作計畫）
- 範圍代號：Spec ⑤（前為 ④ 寵物互動深度）

---

## 1. 定位與動機

開會、簡報、專心寫 code 時，不想被 may 的卡片彈出與反應動畫打斷。需要一鍵「勿擾」：訊息照樣進歷史與徽章（資訊零遺失不變），但不彈卡片、不演反應動畫。

## 2. 範圍

**目標（v1）**
- 右鍵選單一鍵切換「勿擾模式」，狀態存 `prefs.json` 跨重啟記得。
- DND 開啟時：**所有 type 全 mute**（含 error / attention）——不彈卡片、不演反應動畫。
- 訊息仍進 `MessageStore`、仍更新未讀徽章、仍進通知中心。
- 通知中心 header 顯示「勿擾中」指示。

**非目標（v1，延後）**
- 時間排程（多時段、週幾、上班時段自動 mute）。
- 依 type 選擇性 mute（v1 一律全 mute）。
- 解除 DND 時補彈 missed 訊息（不補；要看去通知中心）。

## 3. 架構決策：Main 端 gate

DND 判斷集中在 main 的 ingest `onEvent`：歷史 / 徽章 / 通知中心照常更新，僅在「送 `pet-event` 給 pet renderer」前用 `prefs.dnd` 擋下。renderer / sprite / FSM / replay 對 DND 完全透明——沒收到 `pet-event` 自然不演。

理由：邏輯一處、與既有「自動走動」開關同 pattern、renderer 不需多處 if 檢查。

## 4. 狀態與儲存

- `Prefs` 新增 `dnd: boolean`，預設 `false`。
- `loadPrefs` 對 `dnd` sanitize（非 boolean → false）。
- `savePrefs` 寫 `~/Library/Application Support/desktop-notify/prefs.json`（既有路徑）。

## 5. 訊號流

`src/main/index.ts` ingest `onEvent`：

```ts
onEvent: (event) => {
  store.push(event)        // 既有：歷史照進
  broadcastUnread()        // 既有：徽章同步（紅點）
  broadcastMessages()      // 既有：通知中心同步
  if (prefs.dnd) return    // 新：DND 開 → 在此停，不彈卡片不演動畫
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet-event', event)
  }
}
```

切換 DND（main，與「自動走動」「進階設定」同一個 handlers 區塊）：

```ts
ipcMain.on('set-dnd', (_e, enabled: boolean) => {
  prefs = { ...prefs, dnd: enabled }
  savePrefs(app.getPath('userData'), prefs)
  if (!petWinRef || petWinRef.isDestroyed()) return
  if (enabled) petWinRef.webContents.send('dnd-on')      // renderer 清當前卡片 + replay
  petWinRef.webContents.send('dnd-changed', enabled)     // 供通知中心顯示「勿擾中」
})
ipcMain.handle('get-dnd', () => prefs.dnd)
```

注意：`prefs` 狀態目前持有在 `src/main/window.ts`（既有 autoWalk / walk / skin 都在那）。DND 沿用同一個 `prefs` 變數與 `savePrefs`。但 ingest `onEvent` 在 `src/main/index.ts`——兩邊需要讀到同一份 dnd 值。

**dnd 值如何讓 index.ts 的 onEvent 讀到**：window.ts 既有 `prefs` 是 module-level；index.ts 無法直接讀。解法：用既有的 `bus`（EventEmitter）廣播 dnd 變更，index.ts 訂閱後存一個本地 `let dndEnabled`；初始值由 index.ts 啟動時自己 `loadPrefs` 取得（與 window.ts 各讀一次，值一致因為同檔）。

```ts
// index.ts
import { loadPrefs } from './prefs'
let dndEnabled = loadPrefs(app.getPath('userData')).dnd
bus.on('dnd-changed', (enabled: boolean) => { dndEnabled = enabled })
// onEvent 內用 dndEnabled 取代 prefs.dnd
```

```ts
// window.ts set-dnd handler 內加：
bus.emit('dnd-changed', enabled)
```

## 6. UI 指示

- **右鍵選單**：加 checkbox「勿擾模式」，與「自動走動」並排（既有 `type: 'checkbox'` pattern）。
- **通知中心 header**：dnd 時標題旁加灰色小字「· 勿擾中」，靠 `onDndChanged` 同步；初次開啟用 `getDnd()` 拉初值。
- **寵物本身**：不變（不加紅斜線等遮罩，保持可愛）。

## 7. renderer 對 dnd-on 的處理

DND 開啟瞬間，若當前有卡片在顯示且在 replay，需清掉免得殘留卡片繼續 5 秒抽動畫：

```ts
window.petBridge.onDndOn(() => {
  currentEvent = null
  stopReplay()
  renderCard()
  refreshBadge()
})
```

## 8. 與既有行為的交互

| 場景 | 行為 |
|---|---|
| DND 中收新 event | 歷史 + 徽章紅點 + 通知中心更新；卡片不彈、動畫不演 |
| DND 中點徽章開通知中心 | 正常開、看得到所有未讀（含 DND 期間進來的） |
| DND 中 idle 自走 | 照舊（ambient 行為、不算打擾） |
| DND 開啟瞬間有卡片在 replay | 清 currentEvent + stopReplay |
| DND 中 hover / click 寵物 | 反應動畫照舊（使用者主動觸發 ≠ 外部打擾） |
| 解除 DND | 從那刻起新 event 才彈卡片；DND 期間 missed 不補彈 |

## 9. 架構與檔案

**修改：**
- `src/main/prefs.ts`：`Prefs` 加 `dnd: boolean` + sanitize。
- `src/main/window.ts`：選單加 DND checkbox；`set-dnd` / `get-dnd` IPC；`set-dnd` 內 `bus.emit('dnd-changed', enabled)`。
- `src/main/index.ts`：啟動 `loadPrefs` 取 dnd 初值；`bus.on('dnd-changed')` 更新本地 `dndEnabled`；`onEvent` 在 send `pet-event` 前檢查。
- `src/preload/index.ts` + `api.d.ts`：暴露 `setDnd(enabled)`、`getDnd()`、`onDndOn(cb)`、`onDndChanged(cb)`。
- `src/renderer/main.ts`：訂閱 `onDndOn` 清卡片。
- `src/renderer/center.ts` / `center.html` / `center.css`：header 加「勿擾中」標記。

**不新增 core 純函式**：邏輯全是 main 端條件 send 與 IPC 開關，沒有 worthwhile 抽出的純邏輯。dnd sanitize 併進既有 prefs 測試。

## 10. 測試策略

**單元（prefs.ts）**
- `loadPrefs` 預設含 `dnd: false`。
- `dnd` 非 boolean → false。
- `dnd: true` 正確讀回 / 寫回。

**整合（手動驗收）**
1. 右鍵→勿擾模式 → 通知中心 header 顯示「勿擾中」、選單 checkbox 打勾。
2. DND 中發 notify（curl 或 Claude hook）→ 卡片不彈、紅點亮起。
3. DND 中點紅點 → 通知中心開、看得到剛剛的訊息。
4. 解除 DND → 之後的新 event 卡片正常彈；重啟 App 後 DND 狀態保留。

既有 e2e（`npm run e2e`）確認 DND 關閉時 happy path（卡片彈出）不壞。

## 11. v1 範圍 vs 之後

**v1**：一鍵 toggle 全 mute、prefs 持久化、通知中心「勿擾中」指示。

**之後**：時間排程（上班時段／午休自動 mute）、依 type 選擇性 mute、解除時 missed 摘要。
