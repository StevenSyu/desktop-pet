# desktop pet — 桌面寵物通知工具

一隻常駐 macOS 桌面右下角的像素風寵物（預設造型 **may**），把 Claude Code 等 coding agent 的事件用可愛的精靈動畫＋色彩編碼的卡片通知「演」給你看。所有訊息進通知中心歷史，零遺失。

## 特色

- 像素風寵物常駐桌面右下角：透明、無邊框、置頂（`floating` 層級——別 App 全螢幕時自動退場）、點擊穿透，**顯示在所有虛擬桌面 / Spaces**。
- **可拖動定位、自動記憶**：左鍵拖動 may 到任意位置，下次啟動自動回到原處；外接螢幕拔掉等情況座標失效時自動退回主螢幕右下角。
- **idle 自走動畫**：閒置時隨機往左/右小走動，撞牆會自動反向；任何反應事件、使用者拖動、視窗不可見時立即取消。有即時卡片時暫停自走；走動中被 hover 或點擊立即中斷。
- **動畫核心改為 CSS `@keyframes`**：移除每幀 rAF 計算；視窗不可見時 `animation-play-state: paused` + FSM 輪詢暫停（省電）。
- 9 種動畫狀態（idle、jumping、waving、failed、review、waiting、running…），**3 隻可切換造型**（may 奶油博美／maruko 丸子貓／oil-king-penguin 厭世石油王），全部共用同精靈格式（1536×1872、8 欄×9 列）。
- **色彩編碼通知卡片**（左色條＋同色狀態標籤、無 emoji），暖白卡面、SF Rounded 圓體字。**持久顯示直到點關閉或被新訊息替換**。卡片為**獨立浮動小視窗**，浮在寵物上方（上方不足自動翻下方）、跟著寵物拖動移動；寵物視窗本身縮成 sprite 大小，可一路拖到主螢幕最上方貼到選單列。
- **通知中心**：所有訊息進歷史佇列（容量 50）、已讀/未讀、寵物未讀數徽章（**點一下徽章直接開通知中心**）、狀態 chips 篩選、時間分組（剛剛／今天稍早／更早）、長訊息展開、全部已讀／清空、× 或 Esc 關閉。
- **Hook Kit**：Claude Code hooks（`Stop`／`Notification`（`permission_prompt`）／`StopFailure`）→ `notify.mjs` 讀 hook stdin →帶 `X-Token` POST 本機 127.0.0.1 HTTP 端點 → 寵物反應＋卡片。介接契約通用，Codex/CI/腳本也能 POST。
- 本機 only：HTTP 端點僅 bind 127.0.0.1，共用 token 寫入 `0600` 權限的 `endpoint.json`。
- 右鍵選單：**更換造型…（掃描 pets/ 的造型選擇視窗）**、自動走動開關、勿擾模式、進階設定（走動間隔／秒數）、通知中心、關閉小幫手。
- **勿擾模式**：一鍵切換；開啟時訊息照進歷史 / 未讀紅點 / 通知中心，但不彈卡片、不演反應動畫；通知中心 header 顯示「勿擾中」。
- **使用者偏好持久化**：`prefs.json`（自動走動開關、走動間隔、走動秒數、上次選的造型、勿擾模式）寫在 `~/Library/Application Support/desktop-notify/`，跨重啟記得。
- **寵物互動 sprite 反應**：hover / 單擊隨機反應動畫（waving / jumping / review 三選一）；雙擊（< 300ms）直接開通知中心；拖動時 sprite 依累計位移方向（DIR_THRESHOLD=8px）切 `running-left` / `running-right`，剛拖起無方向時為 jumping。動畫優先級由純函式 `resolveAnimation` 仲裁：FSM reaction > drag > userAnim > walking > idle。
- 核心邏輯純 TypeScript＋Vitest TDD，UI 用 Playwright `_electron` 自動煙霧測試＋截圖驗證。

## 快速開始

需求：macOS、Node.js 20+。

```bash
npm install
npm run dev          # 開發模式啟動；may 會出現在右下角
```

建置 / 預覽：

```bash
npm run build
npm run start
```

## 接 Claude Code（Hook Kit）

讓 Claude Code 回完一輪、需要授權或 API 出錯時自動讓 may 反應。

1. 確認 App 在跑（會寫出 `~/Library/Application Support/desktop-notify/endpoint.json`）。
2. 產生 hook 設定：
   ```bash
   node hooks/print-config.mjs
   ```
3. 把輸出的 `hooks` 區塊合併進：
   - **全域**：`~/.claude/settings.json`，或
   - **單一專案**（建議測試用）：該專案的 `.claude/settings.local.json`（預設被 gitignore）。
4. 重啟 Claude Code 並核准新 hooks。

事件對應：

| Claude Code hook | 寵物反應 | 卡片狀態（顏色） |
|---|---|---|
| `Stop`（回完一輪） | 慶祝 jumping | done 完成（綠） |
| `Notification` / `permission_prompt`（需授權） | 招手 waving | attention 需要注意（琥珀） |
| `StopFailure`（API 錯誤） | 沮喪 failed | error 錯誤（紅） |

除錯：在 hook command 設 `DESKPET_HOOK_LOG=/tmp/deskpet-hook.log`，`notify.mjs` 每次觸發會寫時戳紀錄（`fired` / `posted` / `app-not-running`）。詳見 `hooks/README.md`。

## 加新造型

每隻寵物＝一個資料夾，含 `pet.json` 與符合格式的 `spritesheet.webp`：

- 畫布 **1536 × 1872**、格子 **8 欄 × 9 列**、每格 **192 × 208**。
- 列序固定對應動畫：`0 idle` / `1 running-right` / `2 running-left` / `3 waving` / `4 jumping` / `5 failed` / `6 waiting` / `7 running` / `8 review`。
- 每列由左用前 N 格（影格數見 `src/core/sprite-format.ts`）。

`pet.json` 範例：

```json
{ "id": "my-pet", "displayName": "我的寵物", "description": "說明文字", "spritesheetPath": "spritesheet.webp" }
```

**使用者新增（免改 code）：** 右鍵選單「更換造型…」開選擇視窗 → 點「開啟造型資料夾」→ 把造型資料夾（資料夾名即 id，須 `^[a-z0-9_-]+$`）放進 `~/Library/Application Support/desktop-notify/pets/<id>/` → 回視窗按 ↻ 重新整理。合規造型即可選用；不符規範的會灰掉並標出原因。

**內建造型：** 放在 `resources/pets/<id>/` 並在 `src/core/skins.ts` 的 `SKINS` 登錄；與使用者造型一樣經 `pet://` protocol 載入，不需 static import。

## 架構

```
事件來源（Claude Code hooks / Codex / CI / curl）
   │  POST /notify   (X-Token, 127.0.0.1)
   ▼
[main] Ingest Server → MessageStore（歷史 / 已讀未讀 / 容量 50）
   ├─ send 'pet-event'         → [renderer pet]    即時卡片 + 反應動畫
   ├─ send 'unread-count'      → [renderer pet]    未讀徽章
   └─ send 'messages-updated'  → [renderer center] 通知中心面板
                                      │
   [center] getMessages / markRead / markAllRead / clearMessages（IPC）
```

模組：

- **核心庫**（`src/core/`）：`events` 正規化、`sprite-format`、`message-store`、`time-format`、`pet-fsm`、`pet-validation`、`skins`。純 TS、Vitest 單元測試。
- **main**（`src/main/`）：`window` / `center-window` / `card-window` / `endpoint` / `ingest` / `bus` / `index` 串接。
- **renderer**：`index.html`（寵物＋徽章）／`card.html`（即時卡片獨立視窗）／`center.html`（通知中心面板）。
- **preload**（`src/preload/`）：`contextBridge` 暴露 `window.petBridge`（主視窗）與窄版 `window.cardBridge`（卡片視窗）API。
- **hooks**（`hooks/`）：`payload.mjs` / `notify.mjs` / `print-config.mjs` / `README.md`。

設計與計畫文件在 `docs/superpowers/specs/` 與 `docs/superpowers/plans/`。

## 開發指令

```bash
npm test            # 單元測試（Vitest）
npm run typecheck   # 型別檢查（node + web 兩個 tsconfig）
npm run build       # 產出 out/
npm run e2e         # Playwright _electron 煙霧測試 + 截圖 /tmp/deskpet-shot.png
npm run hooks:config  # 印出 settings.json hooks 設定
```

## 專案結構

```
desktop-notify/
├── src/
│   ├── core/        # 純 TS、可測：events / sprite-format / message-store / pet-fsm / ...
│   ├── main/        # Electron main：視窗、ingest、IPC、MessageStore 持有者
│   ├── preload/     # contextBridge → window.petBridge
│   └── renderer/    # 兩個入口：index.html（寵物）、center.html（通知中心）
├── hooks/           # Hook Kit：notify.mjs / payload / print-config / README
├── resources/pets/  # 內建寵物資產（may / maruko / oil-king-penguin）
├── tests/           # Vitest 單元測試
├── scripts/         # Playwright e2e 工具（e2e-smoke / hook-e2e）
├── docs/            # spec、plan、設計紀錄
└── electron.vite.config.ts
```

## 狀態與規劃

**已完成**：核心庫、Electron 外殼（透明置頂／點擊穿透／all-spaces）、3 隻可換造型＋造型記憶、色彩編碼即時卡片、Hook Kit（含 Stop 抓 transcript 最後文字、cwd 過濾 retry 防 race）、通知中心（歷史／未讀徽章／篩選／分組／展開）、視窗行為（拖動記憶／floating 層級／多螢幕重吸附）、動畫與效能（idle 走動／撞牆反向／CSS-only sprite／不可見暫停／進階設定）、寵物互動（hover/click/dblclick/drag 方向 sprite 反應）、勿擾模式、造型掃描與選擇 UI（pet:// 動態載圖）、即時卡片獨立視窗＋寵物縮窗（拖到最上方貼選單列、走動暫停/中斷）。

**規劃中**：

- 跨 App 重啟的歷史持久化
- tool-failure 偵測 → 自動觸發 error
- 打包與簽章（codesign / notarize）

## 變更紀錄

詳見 [CHANGELOG.md](./CHANGELOG.md)。
