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
- **本機 HTTP Ingest**：127.0.0.1 + `X-Token`；事件契約通用，任何來源（Claude Code hook / Codex / CI / 腳本）皆可 POST `/notify`。
- **Hook Kit**：`notify.mjs`（讀 hook stdin + endpoint.json → 帶 token POST）、`payload.mjs` 事件映射、`print-config.mjs` 印出 settings.json hooks 區塊、README 與 env-gated 除錯日誌（`DESKPET_HOOK_LOG`）。
- **核心庫**（純 TypeScript + Vitest）：`events` 正規化、`sprite-format`、`message-store`、`time-format`、`pet-fsm`、`pet-validation`、`skins`、`window-position`。60 個單元測試。
- **e2e 工具**：Playwright `_electron` 煙霧測試（`scripts/e2e-smoke.mjs`）與 hook 鏈路驗證（`scripts/hook-e2e.mjs`）。
- **專案文件**：README、設計 spec（`docs/superpowers/specs/`）、實作計畫（`docs/superpowers/plans/`）。

### Changed

- **通知策略**：從「卡片 5 秒自動淡出」改為「單張即時卡片持久顯示，歷史進通知中心」——資訊零遺失。
- **卡片視覺**：移除 emoji，改為色彩編碼（綠／琥珀／紅／靛藍／青／暖灰）＋同色狀態標籤。
- **idle 動畫節奏**：放慢為每格 0.8 秒（fps 1.25），整體手感更平緩。
- **置頂層級**：`alwaysOnTop` 由 `'screen-saver'` 改為 `'floating'`（pet window 與 center window 一致）——別 App 進 macOS 全螢幕時系統自動讓寵物退場，回桌面才顯示，不再蓋住影片／簡報。
- **反應動畫尾段**：嘗試過「定格 3 秒」「末兩影格來回」皆被否決，最終採「持續循環 3 秒」自然回 idle。
- **核心儲存模型**：原 ttl 為主的 `NotificationQueue` 重做為 `MessageStore`（歷史／已讀未讀／容量上限），純函式 + 完整 TDD。

### Fixed

- **preload 載入失敗導致無動畫／無卡片**：`electron-vite` 在 `type:module` 下將 preload 輸出為 `.mjs`，但 sandbox 預設要 CJS；改強制輸出 `.cjs` 並對應引用。
- **通知卡片佇列時鐘域不一致**（早期實作）：`Date.now` 與 `performance.now` 混用導致卡片即時被判過期；後由 `MessageStore` 重設計時序解決。
- **通知中心無明確關閉方式**：新增 × 鈕＋Esc 鍵盤關閉（不再只依賴失焦關閉）。

### Security

- `endpoint.json` 以 owner-only `0600` 寫入（含 token），先移除舊檔避免殘留寬鬆權限；HTTP 端點僅 bind `127.0.0.1`。

### Removed

- 舊的 ttl-based `src/core/notification-queue.ts` 與其測試（已由 `MessageStore` 取代）。
- 卡片狀態 emoji（改為色彩編碼）。
