# desktop pet — 桌面寵物通知工具

一隻常駐桌面的像素風寵物，把 Claude Code／Codex 等 coding agent 的事件用精靈動畫＋色彩編碼卡片「演」給你看。所有訊息進通知中心，零遺失。

## 功能

- **桌面寵物**：透明置頂、可拖動、可縮放（hover 右下把手）、idle 自走、3 隻內建造型（may／maruko／oil-king-penguin）＋自製造型。
- **事件演出**：agent 事件 → 寵物反應動畫＋浮動卡片（色彩編碼狀態、點開看全文）；同一訊息的多張卡片關一張全關。
- **通知中心**：歷史、已讀/未讀、狀態與 session 篩選、頻道分頁、單則 Markdown 詳情；可拖曳並記住位置。
- **頻道（來源分群）**：把來源拖拉編組、可跨專案合併；「全部來源」整類項一拖即涵蓋整個 agent；新來源自動建頻道並跳出專屬寵物。
- **多寵物**：每個啟用頻道一隻，各自造型、卡片、位置、大小、未讀紅點。
- **勿擾模式**：訊息照進歷史，不彈卡不演動畫。
- **本機 only**：HTTP 端點僅 bind 127.0.0.1，token 驗證（`endpoint.json`，0600）。
- **平台**：macOS 主力；Windows／Linux 可用 `npm run` 跑（詳見 [docs/CROSS_PLATFORM.md](docs/CROSS_PLATFORM.md)）。

## 快速開始

需求：**Node.js 20+**。

```bash
git clone https://github.com/StevenSyu/desktop-pet.git
cd desktop-pet
npm install
npm run dev        # 寵物出現在桌面右下角
```

> **懶人法**：把這句貼給 Claude Code（或任何能讀檔、執行指令的 AI agent）——
> 「讀取 `docs/AI-SETUP.md`，幫我安裝相依、跑起這個桌面寵物，並設定 Claude Code hook。」

### 接上 Claude Code

1. 確認 App 在跑（會寫出 userData 下的 `endpoint.json`）。
2. 印出 hook 設定並合併進 `~/.claude/settings.json`（或單一專案的 `.claude/settings.local.json`）：
   ```bash
   node hooks/print-config.mjs
   ```
3. 重啟 Claude Code 並核准新 hooks。

| Claude Code hook | 寵物反應 | 卡片 |
|---|---|---|
| `Stop`（回完一輪） | 慶祝 jumping | done（綠） |
| `Notification`／`permission_prompt`（需授權） | 招手 waving | attention（琥珀） |
| `StopFailure`（API 錯誤） | 沮喪 failed | error（紅） |

除錯：hook command 設 `DESKPET_HOOK_LOG=/tmp/deskpet-hook.log` 看觸發紀錄；詳見 `hooks/README.md`。

### 接上 Codex

見 [docs/CODEX-HOOKS.md](docs/CODEX-HOOKS.md)。介接契約是通用 HTTP（`POST /notify` + `X-Token`），CI／腳本／curl 都能發。

## 打包成 App

```bash
npm run dist        # macOS .dmg（Apple Silicon）
npm run dist:win    # Windows
npm run dist:linux  # Linux
```

macOS 產物在 `release/desktop-notify-<版本>-arm64.dmg`，拖進「應用程式」即可。

**從 GitHub Releases 下載的 dmg**（ad-hoc 簽名、未公證）：首次開啟會被 Gatekeeper 擋——右鍵 app →「開啟」，或到「系統設定 → 隱私權與安全性」按「強制打開」。若仍顯示「已損毀」（舊版 release），終端機執行：

```bash
xattr -cr /Applications/desktop-notify.app
```

跨平台注意事項見 [docs/CROSS_PLATFORM.md](docs/CROSS_PLATFORM.md)。

## 加新造型

一隻造型＝一個資料夾（`pet.json` ＋ `spritesheet.webp`）：

- 畫布 **1536×1872**、**8 欄 × 9 列**、每格 192×208。
- 列序固定：`0 idle / 1 running-right / 2 running-left / 3 waving / 4 jumping / 5 failed / 6 waiting / 7 running / 8 review`（每列影格數見 `src/core/sprite-format.ts`）。

```json
{ "id": "my-pet", "displayName": "我的寵物", "description": "說明文字", "spritesheetPath": "spritesheet.webp" }
```

**免改 code**：右鍵寵物 →「更換造型…」→「開啟造型資料夾」→ 把資料夾（名稱即 id，`^[a-z0-9_-]+$`）放進去 → ↻ 重新整理。內建造型放 `resources/pets/<id>/` 並在 `src/core/skins.ts` 登錄。

## 開發

```bash
npm test            # 單元測試（Vitest）
npm run typecheck   # 型別檢查（node + web 兩個 tsconfig）
npm run build       # 產出 out/
npm run e2e         # Playwright _electron 煙霧測試＋截圖
npm run hooks:config  # 印出 hooks 設定
```

### 架構

```
事件來源（Claude Code hooks / Codex / CI / curl）
   │  POST /notify   (X-Token, 127.0.0.1)
   ▼
[main] Ingest Server → MessageStore（歷史／已讀未讀）
   ├─ 'pet-event'         → [pet]    反應動畫＋即時卡片（每頻道一隻寵物）
   ├─ 'unread-count'      → [pet]    未讀徽章
   └─ 'messages-updated'  → [center] 通知中心
```

- **core**（`src/core/`）：純 TS 決策邏輯（事件正規化、頻道目錄、卡片幾何、FSM、走動…），全部 Vitest 單測。
- **main**（`src/main/`）：Electron 視窗、ingest、IPC——thin adapter，決策委派 core。
- **renderer**：`index.html`（寵物）／`card.html`（卡片）／`center.html`（通知中心）／`channels.html`（寵物設定，Preact）。
- **preload**：typed IPC contract（`src/ipc/contract.ts`，channel 與 payload 編譯期檢查）。
- **hooks**（`hooks/`）：Hook Kit（`notify.mjs`／`print-config.mjs`）。

架構詞彙見 [CONTEXT.md](CONTEXT.md)；設計與計畫文件在 `docs/superpowers/`；變更紀錄見 [CHANGELOG.md](./CHANGELOG.md)。
