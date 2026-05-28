# Changelog

依 [Keep a Changelog](https://keepachangelog.com/zh-TW/) 形式記錄。本專案尚未發佈正式版本，所有變動列於下方未發佈區段。

## [Unreleased]

### Added

- **桌面寵物 App**：Electron、macOS-first；透明、無邊框、置頂、點擊穿透視窗，釘在桌面右下角；顯示在所有虛擬桌面（Spaces）。
- **3 隻可切換造型**：may（奶油博美）、maruko（丸子貓）、oil-king-penguin（厭世石油王）；共用 1536×1872、8 欄×9 列共用精靈格式；資料驅動，丟資料夾＋登錄即可換皮。
- **9 種動畫狀態**：idle、running-right/left、waving、jumping、failed、waiting、running、review。
- **寵物狀態機**：依優先級仲裁（error > attention > done > review > working > info），非迴圈反應播完後 hold 3 秒（持續循環）再回 idle。
- **色彩編碼通知卡片**：左色條＋同色狀態標籤，無 emoji；暖白卡面、SF Rounded 圓體字、彈入動畫；持久顯示直到點關閉或被新訊息替換。
- **長訊息截斷**：即時卡片 2 行截斷；通知中心提供「展開／收合」。
- **通知中心**：訊息歷史佇列（容量 50）、已讀／未讀、寵物未讀數徽章、狀態 chips 篩選、時間分組（剛剛／今天稍早／更早）、相對時間、全部已讀／清空、× 鈕＋Esc 關閉。
- **右鍵選單**：更換造型、通知中心、關閉小幫手。
- **拖動定位記憶**（Spec ②）：左鍵在寵物上拖動移動視窗（DRAG_THRESHOLD=3px 區分點擊／拖動、rAF 節流），位置寫入 `~/Library/Application Support/desktop-notify/window-state.json`，重啟自動還原；座標若無效（如 displayId 已不存在）自動退回 primary 螢幕右下角。
- **多螢幕重吸附**（Spec ②）：監聽 `display-removed`，若寵物座標不在任何螢幕 workArea 內，自動移回 primary 右下角。
- **關閉小幫手確認對話框**（Spec ②）：右鍵選單「關閉小幫手」改為 `dialog.showMessageBox`（預設按鈕「取消」，避免 Enter 誤觸）。
- **idle 自走動畫**（Spec ③）：閒置時依使用者設定的間隔範圍隨機觸發走動（往左或右），距離由秒數×固定速率（`WALK_SPEED_PX_PER_MS = 0.08`）內部換算；走動會被反應事件、使用者拖動、視窗不可見時立即取消，且走到工作區邊界時自動反向避免撞牆。走動位置不寫入 `window-state.json`，重啟仍回到最後一次手動拖動位置。
- **右鍵選單「自動走動」開關**（Spec ③）：可一鍵停用走動；關閉時若正在走動會立即停止。狀態存於 `prefs.json`。
- **右鍵選單「進階設定」面板**（Spec ③）：開設定視窗可調走動間隔（最短/最長秒）與走動秒數（最短/最長秒）；按「儲存」即時生效。
- **使用者偏好（`prefs.json`）**：寫於 `~/Library/Application Support/desktop-notify/`，sanitize 防呆（min/max 自動互換、無效型別退回預設、忽略未知欄位）。
- **點寵物未讀徽章直接開通知中心**：徽章 hover 放大、按下回彈微動畫；不必再透過右鍵選單。
- **寵物互動 sprite 反應**（Spec ④）：hover / 單擊隨機反應動畫（waving / jumping / review）；雙擊（< 300ms）直接開通知中心；拖動時 sprite 依累計位移方向（DIR_THRESHOLD=8px）切 `running-left` / `running-right`，剛拖起無方向時為 jumping。動畫優先級由純函式 `resolveAnimation` 仲裁：FSM reaction > drag > userAnim > walking > idle。新增 `src/core/anim-resolver.ts` + `src/core/click-dispatcher.ts` 兩個純函式（14 條測試）。
- **造型更換記憶**：右鍵選單「更換造型」選的造型寫入 `prefs.json`，重啟自動還原；選單以 radio 顯示當前造型。
- **Stop hook 抓 transcript 最後文字**：hook 觸發時讀取 transcript JSONL，把 Claude 該輪最後一個 text entry 當卡片 body；retry 機制（initialWait 300ms → emptyRetries 5×200ms → settleWait 400ms）解決 fsync race；turn 邊界以「使用者打字訊息」判定，避免跨輪抓到上一次的內容；sidechain（Task 子代理）排除。
- **本機 HTTP Ingest**：127.0.0.1 + `X-Token`；事件契約通用，任何來源（Claude Code hook / Codex / CI / 腳本）皆可 POST `/notify`。
- **Hook Kit**：`notify.mjs`（讀 hook stdin + endpoint.json → 帶 token POST）、`payload.mjs` 事件映射、`print-config.mjs` 印出 settings.json hooks 區塊、README 與 env-gated 除錯日誌（`DESKPET_HOOK_LOG`）。
- **核心庫**（純 TypeScript + Vitest）：`events` 正規化、`sprite-format`、`message-store`、`time-format`、`pet-fsm`、`pet-validation`、`skins`、`window-position`、`walk-planner`。76 個單元測試。
- **e2e 工具**：Playwright `_electron` 煙霧測試（`scripts/e2e-smoke.mjs`）與 hook 鏈路驗證（`scripts/hook-e2e.mjs`）。
- **專案文件**：README、設計 spec（`docs/superpowers/specs/`）、實作計畫（`docs/superpowers/plans/`）。

### Changed

- **通知策略**：從「卡片 5 秒自動淡出」改為「單張即時卡片持久顯示，歷史進通知中心」——資訊零遺失。
- **卡片視覺**：移除 emoji，改為色彩編碼（綠／琥珀／紅／靛藍／青／暖灰）＋同色狀態標籤。
- **idle 動畫節奏**：放慢為每格 0.8 秒（fps 1.25），整體手感更平緩。
- **置頂層級**：`alwaysOnTop` 由 `'screen-saver'` 改為 `'floating'`（pet window 與 center window 一致）——別 App 進 macOS 全螢幕時系統自動讓寵物退場，回桌面才顯示，不再蓋住影片／簡報。
- **動畫核心**：從 `requestAnimationFrame` 每幀推 `background-position` 改為 CSS `@keyframes` + `steps()`，JS 只透過 `setInterval(100ms)` 輪詢 FSM 並切換 `#pet[data-anim]`；視窗 `visibilitychange` hidden 時 `animation-play-state: paused` 並停止輪詢。
- **Skin 路徑統一**：repo 根層的 `may/`、`maruko/`、`oil-king-penguin/` 與 `resources/pets/*/` 重複且都被追蹤，code 只用後者；移除根層三份重複，整個 repo 僅剩 `resources/pets/<id>/` 一處 skin 路徑。
- **反應動畫尾段**：嘗試過「定格 3 秒」「末兩影格來回」皆被否決，最終採「持續循環 3 秒」自然回 idle。
- **核心儲存模型**：原 ttl 為主的 `NotificationQueue` 重做為 `MessageStore`（歷史／已讀未讀／容量上限），純函式 + 完整 TDD。

### Fixed

- **走動 sprite 被 idle 蓋掉**（Spec ③）：FSM 輪詢 setInterval 每 100ms 把 `data-anim` 重設為 'idle'，導致 running-{left,right} 只播一格就被覆蓋；改為走動期間僅當 FSM 回非 idle（反應事件）時才覆寫，左/右動畫得以完整播放。
- **走到底繼續往同方向撞牆**（Spec ③）：main 端 walk-start 若該方向 `available <= 0` 改試對向，並送 `walk-direction` 事件讓 renderer 即時切 CSS anim 對應方向。
- **preload 載入失敗導致無動畫／無卡片**：`electron-vite` 在 `type:module` 下將 preload 輸出為 `.mjs`，但 sandbox 預設要 CJS；改強制輸出 `.cjs` 並對應引用。
- **通知卡片佇列時鐘域不一致**（早期實作）：`Date.now` 與 `performance.now` 混用導致卡片即時被判過期；後由 `MessageStore` 重設計時序解決。
- **通知中心無明確關閉方式**：新增 × 鈕＋Esc 鍵盤關閉（不再只依賴失焦關閉）。

### Security

- `endpoint.json` 以 owner-only `0600` 寫入（含 token），先移除舊檔避免殘留寬鬆權限；HTTP 端點僅 bind `127.0.0.1`。

### Removed

- 舊的 ttl-based `src/core/notification-queue.ts` 與其測試（已由 `MessageStore` 取代）。
- 卡片狀態 emoji（改為色彩編碼）。
