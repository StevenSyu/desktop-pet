# may — 桌面寵物通知工具

一隻常駐 macOS 桌面右下角的像素風寵物，把 Claude Code 等 coding agent 的事件用可愛的精靈動畫＋色彩編碼的卡片通知「演」給你看。所有訊息進通知中心歷史，零遺失。

## 特色

- 像素風寵物常駐桌面右下角：透明、無邊框、置頂、點擊穿透，**顯示在所有虛擬桌面 / Spaces**。
- 9 種動畫狀態（idle、jumping、waving、failed、review、waiting、running…），**3 隻可切換造型**（may 奶油博美／maruko 丸子貓／oil-king-penguin 厭世石油王），全部共用同精靈格式（1536×1872、8 欄×9 列）。
- **色彩編碼通知卡片**（左色條＋同色狀態標籤、無 emoji），暖白卡面、SF Rounded 圓體字。**持久顯示直到點關閉或被新訊息替換**。
- **通知中心**：所有訊息進歷史佇列（容量 50）、已讀/未讀、寵物未讀數徽章、狀態 chips 篩選、時間分組（剛剛／今天稍早／更早）、長訊息展開、全部已讀／清空、× 或 Esc 關閉。
- **Hook Kit**：Claude Code hooks（`Stop`／`Notification`（`permission_prompt`）／`StopFailure`）→ `notify.mjs` 讀 hook stdin →帶 `X-Token` POST 本機 127.0.0.1 HTTP 端點 → 寵物反應＋卡片。介接契約通用，Codex/CI/腳本也能 POST。
- 本機 only：HTTP 端點僅 bind 127.0.0.1，共用 token 寫入 `0600` 權限的 `endpoint.json`。
- 右鍵選單：更換造型、通知中心、關閉小幫手。
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

步驟：

1. 把資料夾放到 `resources/pets/<id>/`（內含 `pet.json` 與 `spritesheet.webp`）。
2. 在 `src/core/skins.ts` 的 `SKINS` 加上 `{ id, name }`。
3. 在 `src/renderer/main.ts` 加對應 `import` 並登錄到 `SHEET_URL[id]`。
4. `npm run build` 後就能從右鍵選單「更換造型」切換。

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
- **main**（`src/main/`）：`window` / `center-window` / `endpoint` / `ingest` / `bus` / `index` 串接。
- **renderer**：`index.html`（寵物＋即時卡片＋徽章）／`center.html`（通知中心面板）。
- **preload**（`src/preload/`）：`contextBridge` 暴露 `window.petBridge` API。
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

**已完成**：核心庫、Electron 外殼（透明置頂／點擊穿透／all-spaces）、3 隻可換造型、色彩編碼即時卡片、Hook Kit、通知中心（歷史／未讀徽章／篩選／分組／展開）。

**規劃中**：

- 拖動定位記憶
- idle 走動動畫
- 效能 / 耗電優化（rAF→CSS、視窗不可見時暫停）
- 多螢幕重新吸附、全螢幕層級處理
- 跨 App 重啟的歷史持久化
- tool-failure 偵測 → 自動觸發 error
- 打包與簽章（codesign / notarize）

## 變更紀錄

詳見 [CHANGELOG.md](./CHANGELOG.md)。
