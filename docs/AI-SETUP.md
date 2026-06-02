# 給 AI Agent：跑起桌面寵物並接上 Claude Code

你（AI）讀到這份文件後，請直接照下列步驟把這個桌面寵物跑起來，並把使用者的 Claude Code 事件接到寵物身上。全程用 `npm run`，不需打包成 App。

> 主力平台 macOS；Windows / Linux 亦可用 `npm run` 跑（視窗置頂、endpoint 路徑已依平台自動處理；字體會退回系統字型）。

## 1. 安裝相依

```bash
npm install
```

## 2. 跑起寵物（背景執行）

```bash
npm run dev
```

- 右下角會出現寵物 `may`。
- 啟動後會把 `endpoint.json`（本機 HTTP 端點 port + token）寫到應用資料夾，hook 需要它。各平台位置：macOS `~/Library/Application Support/desktop-notify/`、Windows `%APPDATA%\desktop-notify\`、Linux `~/.config/desktop-notify/`。等檔出現再做下一步。

## 3. 設定 Claude Code hook

產生 hook 設定（已內嵌絕對 node / 腳本路徑）：

```bash
node hooks/print-config.mjs
```

它會輸出一段 `{ "hooks": { ... } }` JSON。把這段內容寫入**本專案**的 `.claude/settings.local.json`（此檔本機限定、預設被 gitignore，不動使用者全域設定）：

- 若 `.claude/settings.local.json` 不存在 → 直接建立，內容就是上面那段 JSON。
- 若已存在且已有 `hooks` → 把 `Stop` / `Notification` / `StopFailure` 三個事件的陣列合併進去（同名事件 append，不要覆蓋）。

## 4. 收尾

告訴使用者：**重新啟動 Claude Code，並在啟動時核准本專案的 hook**。之後：

| Claude Code 事件 | 寵物反應 |
|------------------|----------|
| `Stop`（回完一輪） | 慶祝 |
| `Notification`（需授權） | 招手 |
| `StopFailure`（API 錯誤） | 沮喪 |

## 驗證（可選）

App 開著時手動模擬一次，寵物應慶祝＋彈卡片（下為 bash；Windows PowerShell 語法略異，可請 AI 代為產生對應指令）：

```bash
echo '{"session_id":"demo","cwd":"'"$PWD"'"}' | node hooks/notify.mjs done
```

> App 沒開時 hook 會靜默結束，不影響 Claude Code。詳細運作見 `hooks/README.md`。
