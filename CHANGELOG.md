# Changelog

依 [Keep a Changelog](https://keepachangelog.com/zh-TW/) 形式記錄。本專案尚未發佈正式版本，所有變動列於下方未發佈區段。

## [Unreleased]

### Added

- **多寵物（子專案 B1）**：每個**啟用的頻道** + 「全部」各長出**一隻寵物視窗**，各自造型、各自反應符合的事件、各自未讀紅點；從「全部」向左堆疊定位、channel 寵物可拖（不自走）；「全部」維持完整行為（走動/即時卡片）。事件反應：「全部」反應所有訊息、命中的頻道寵物額外反應（多屬來源→多隻一起跳），嫌吵可用「全部」開關關掉那隻。**點寵物開通知中心會切到該頻道分頁**。reconcile 生命週期（啟用→生、停用/刪→收、`allEnabled`→「全部」），保證至少 1 隻寵物以防鎖死。寵物以 URL `?c=<channelId>` 辨識身分、per-pet 命令帶 channelId 路由（`window.ts` 單→多寵物重構）。新增純函式 `pet-layout.stackPosition`。
- **多寵物 per-pet 即時卡片 + 位置記憶（子專案 B2）**：每隻寵物（含 channel 寵物）收到事件都彈**自己的即時卡片**（定位在該寵物旁、多寵物可同時各顯示），移除 B1「卡片只在『全部』」限制；卡片視窗 per-pet（`Map<channelId, cardWindow>`、URL `?c=`、show-card/hide-card/card-clicked/card-more 帶 channelId），點卡片 → 開該則詳情 + 切該頻道分頁、✕ 關該卡片、拖寵物時各自卡片跟著移動。**每頻道拖曳位置持久化**：`window-state.json` 單一 → keyed map（`{ [channelId]: WindowState }`，向後相容舊單一檔→視為 `'all'`）；啟動時有有效存檔（在某 display workArea 內）用之、否則 `'all'`→預設右下、channel→向左堆疊，每隻 drag-end 各自存。新增純函式 `migrateWindowStates`。
- **通知頻道 / 群組（多寵物 子專案 A）**：把通知依事件 `source`（kind/name）分成**可重疊的「頻道（group）」**。新增獨立「頻道管理」視窗（**Preact + @preact/signals**，僅此視窗用框架）：**左右兩欄**把「已知來源」拖拽或點擊加入頻道成員（**跨專案可合併到同一頻道**）、自動偵測新來源建「停用」頻道（成員預設含自己）、啟用/停用、刪除、改名、換造型；頂部**鎖定的「全部」頻道**（不可編輯、含開關，供未來多寵物關閉「全部」那隻）。通知中心加**頻道分頁**（全部 + 各啟用頻道、各自未讀、編輯即時回溯分類）。core 純函式 `channel`（matchesSource / channelMatches / matchingChannels / needsAutoChannel / filterByChannel / unreadByChannel / sanitize）。右鍵選單加「頻道…」。**A 不長新寵物**（每頻道一隻寵物為子專案 B）。
- **macOS 打包（electron-builder → .dmg）**：`npm run dist` 產出 Apple Silicon `.dmg`，可拖進「應用程式」雙擊啟動。內建造型以 `extraResources` 放到 `.app/Contents/Resources/resources/pets`（asar 外），`src/main/window.ts` 的 `builtinRoot()` 在 `app.isPackaged` 時改用 `process.resourcesPath`，使 `pet://` 在打包後仍讀得到內建 spritesheet。未做 Apple 簽章/公證（個人用，ad-hoc 簽章本機可直接開）。
- **點卡片看全文 + 通知中心詳情面板**（Spec ⑧）：即時卡片內文改為精簡首段（`cardSummary` 換行/句號切分）；**點卡片本體 → 關卡片 + 開通知中心並直接進該則單則詳情面板**，卡片右上角 ✕ 則只關閉（依使用回饋從「點卡片關閉」改為此互動）。詳情面板以安全 Markdown 渲染完整內文（`renderMarkdown`：escape-first + 無屬性標籤白名單，支援粗體/行內與區塊程式碼/清單/**表格 `<table>`**；不支援連結/圖片/raw HTML）+ 完整 metadata（來源/完整 sessionId/絕對時間 + 收到時間）。列表↔詳情兩態、Esc 兩段式（詳情→列表→關窗）、詳情該則被清空自動 fallback 回列表、返回列表還原捲動位置 + highlight。卡片/列表預覽（`stripMarkdown`）整列略過表格，不再出現 `|`／`---` 符號。新增純函式 `card-summary`、`markdown-render`（含 XSS/ReDoS 測試）。
- **即時卡片獨立視窗**（Spec ⑦）：即時卡片從寵物視窗的 DOM 抽成獨立浮動小視窗，浮在寵物上方（上方空間不足自動翻到下方）、右對齊、跟著寵物拖動移動；card renderer 純顯示（窄版 `cardBridge` preload，只 `onCardData`/`cardClicked`，不暴露 walk/prefs/skin）。卡片 IPC 帶事件 id，main 持 `activeCardId`、pet renderer 比對 `currentEvent`，防舊卡片延遲點擊誤標新訊息已讀。新增純函式 `card-position`（上方/下方 flip + 右對齊 + workArea 夾邊，5 測試）。卡片視窗 `showInactive` 不搶焦點、`moveTop` 確保浮在寵物之上、跨 Spaces。
- **走動暫停與中斷**（Spec ⑦）：有即時卡片時暫停自走；走動中被 hover 或點擊立即中斷走動。
- **造型掃描與選擇 UI**（Spec ⑥）：掃描 `~/Library/Application Support/desktop-notify/pets/<id>/`，合規造型（pet.json + 1536×1872 spritesheet）自動出現在右鍵「更換造型…」選擇視窗，顯示名稱／描述／來源、縮圖（idle 第一格），可選；無效造型灰掉並標分類原因（缺 json／JSON 格式錯／尺寸不符／路徑不安全／找不到圖）。視窗頂部提示造型資料夾位置 + 「開啟造型資料夾」按鈕。`prefs.skin` 失效時退回 may 並提示。新增純函式 `webp-size`（自寫 WebP header 尺寸解析，只讀檔頭 32 bytes，取代不可靠的 nativeImage）、`skin-scan`（驗證 + 路徑穿越防護），共 15 測試。
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
- **idle 自走動畫**（Spec ③）：閒置時依使用者設定的間隔範圍隨機觸發走動（往左或右），距離由秒數×固定速率（`WALK_SPEED_PX_PER_MS = 0.08`）內部換算；走動會被反應事件、使用者拖動、視窗不可見時立即取消，且走到工作區邊界時自動反向避免撞牆。走動位置不寫入 `window-state.json`，重啟仍回到最後一次手動拖動位置。
- **右鍵選單「自動走動」開關**（Spec ③）：可一鍵停用走動；關閉時若正在走動會立即停止。狀態存於 `prefs.json`。
- **右鍵選單「進階設定」面板**（Spec ③）：開設定視窗可調走動間隔（最短/最長秒）與走動秒數（最短/最長秒）；按「儲存」即時生效。
- **使用者偏好（`prefs.json`）**：寫於 `~/Library/Application Support/desktop-notify/`，sanitize 防呆（min/max 自動互換、無效型別退回預設、忽略未知欄位）。
- **點寵物未讀徽章直接開通知中心**：徽章 hover 放大、按下回彈微動畫；不必再透過右鍵選單。
- **勿擾模式**（Spec ⑤）：右鍵選單一鍵切換；開啟時所有訊息照進歷史 / 未讀紅點 / 通知中心，但不彈卡片、不演反應動畫。狀態存 `prefs.json` 跨重啟記得；通知中心 header 顯示「勿擾中」。實作為 main 端 gate（ingest onEvent 在 send pet-event 前用 dnd 旗標擋，經 bus 廣播給 index.ts）。
- **寵物互動 sprite 反應**（Spec ④）：hover / 單擊隨機反應動畫（waving / jumping / review）；雙擊（< 300ms）直接開通知中心；拖動時 sprite 依累計位移方向（DIR_THRESHOLD=8px）切 `running-left` / `running-right`，剛拖起無方向時為 jumping。動畫優先級由純函式 `resolveAnimation` 仲裁：FSM reaction > drag > userAnim > walking > idle。新增 `src/core/anim-resolver.ts` + `src/core/click-dispatcher.ts` 兩個純函式（14 條測試）。
- **造型更換記憶**：右鍵選單「更換造型」選的造型寫入 `prefs.json`，重啟自動還原；選單以 radio 顯示當前造型。
- **Stop hook 抓 transcript 最後文字**：hook 觸發時讀取 transcript JSONL，把 Claude 該輪最後一個 text entry 當卡片 body；retry 機制（initialWait 300ms → emptyRetries 5×200ms → settleWait 400ms）解決 fsync race；turn 邊界以「使用者打字訊息」判定，避免跨輪抓到上一次的內容；sidechain（Task 子代理）排除。
- **本機 HTTP Ingest**：127.0.0.1 + `X-Token`；事件契約通用，任何來源（Claude Code hook / Codex / CI / 腳本）皆可 POST `/notify`。
- **Hook Kit**：`notify.mjs`（讀 hook stdin + endpoint.json → 帶 token POST）、`payload.mjs` 事件映射、`print-config.mjs` 印出 settings.json hooks 區塊、README 與 env-gated 除錯日誌（`DESKPET_HOOK_LOG`）。
- **核心庫**（純 TypeScript + Vitest）：`events` 正規化、`sprite-format`、`message-store`、`time-format`、`pet-fsm`、`pet-validation`、`skins`、`window-position`、`walk-planner`。76 個單元測試。
- **e2e 工具**：Playwright `_electron` 煙霧測試（`scripts/e2e-smoke.mjs`）與 hook 鏈路驗證（`scripts/hook-e2e.mjs`）。
- **專案文件**：README、設計 spec（`docs/superpowers/specs/`）、實作計畫（`docs/superpowers/plans/`）。

### Changed

- **prefs 持久化合併寫入**（多寵物 A）：新增 `updatePrefs(dir, partial)`（讀最新→合併→寫），`window.ts` 與 `index.ts` 兩個寫入者各只更新自己欄位，避免互相覆蓋；`prefs` 新增 `channels` / `knownSources` / `allEnabled`（皆向後相容、含上限防外部來源放大）。
- **通知中心開在寵物所在螢幕那側**（Spec ⑧）：不再固定主螢幕角落；改用 `cardPosition`（依 `getDisplayMatching(寵物bounds)`、右對齊、上方不足翻下方、y 夾入工作區）定位，多螢幕下中心會出現在寵物當前所在螢幕。
- **寵物視窗縮成 sprite 大小**（Spec ⑦）：280×300 → 135×146、`#pet` 齊頂、未讀紅點移到 sprite 右上角；移除視窗內 `#cards` DOM（卡片改獨立視窗）。消除 sprite 上方的卡片預留死空間。
- **造型載入**（Spec ⑥）：renderer 從 build-time static import 改為執行期 `pet://<id>/sheet` 自訂 protocol；內建與使用者造型統一路徑，新增造型不再需要改 code 重建。右鍵「更換造型」submenu 改為「更換造型…」開選擇視窗。
- **通知策略**：從「卡片 5 秒自動淡出」改為「單張即時卡片持久顯示，歷史進通知中心」——資訊零遺失。
- **卡片視覺**：移除 emoji，改為色彩編碼（綠／琥珀／紅／靛藍／青／暖灰）＋同色狀態標籤。
- **idle 動畫節奏**：放慢為每格 0.8 秒（fps 1.25），整體手感更平緩。
- **置頂層級**：`alwaysOnTop` 由 `'screen-saver'` 改為 `'floating'`（pet window 與 center window 一致）——別 App 進 macOS 全螢幕時系統自動讓寵物退場，回桌面才顯示，不再蓋住影片／簡報。
- **動畫核心**：從 `requestAnimationFrame` 每幀推 `background-position` 改為 CSS `@keyframes` + `steps()`，JS 只透過 `setInterval(100ms)` 輪詢 FSM 並切換 `#pet[data-anim]`；視窗 `visibilitychange` hidden 時 `animation-play-state: paused` 並停止輪詢。
- **Skin 路徑統一**：repo 根層的 `may/`、`maruko/`、`oil-king-penguin/` 與 `resources/pets/*/` 重複且都被追蹤，code 只用後者；移除根層三份重複，整個 repo 僅剩 `resources/pets/<id>/` 一處 skin 路徑。
- **反應動畫尾段**：嘗試過「定格 3 秒」「末兩影格來回」皆被否決，最終採「持續循環 3 秒」自然回 idle。
- **核心儲存模型**：原 ttl 為主的 `NotificationQueue` 重做為 `MessageStore`（歷史／已讀未讀／容量上限），純函式 + 完整 TDD。
- **未讀徽章**：從顯示數字（「1」「99+」）改為純紅點——只提示「有未讀」不顯示精確數量，視覺更乾淨。

### Fixed

- **拖到主螢幕最上方 sprite 貼不到選單列**（#1，Spec ⑦ 收尾）：寵物視窗上方有卡片預留死空間，往上拖時視窗頂端先撞選單列、sprite 無法到頂。卡片獨立成視窗後寵物視窗縮成 sprite 大小、`#pet` 齊頂，sprite 得以貼到 `workArea.y`。
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
