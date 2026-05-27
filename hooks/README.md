# Hook Kit — 把 Claude Code 事件接到桌面寵物

讓 Claude Code 的事件驅動桌面寵物 may：
- `Stop`（Claude 回完一輪）→ 慶祝
- `Notification / permission_prompt`（需要你授權）→ 招手
- `StopFailure`（API 錯誤）→ 沮喪

## 安裝

1. 先確定桌面寵物 App 有在執行（它會寫出 `~/Library/Application Support/desktop-notify/endpoint.json`）。
2. 產生設定（直接用 node 執行，避免 npm 的 banner 混入輸出而破壞 JSON）：
   ```bash
   node hooks/print-config.mjs
   ```
   （或 `npm run --silent hooks:config`）
3. 把輸出的 `"hooks"` 區塊合併進你的 `~/.claude/settings.json`（若已有其他 hooks，請手動合併同名事件的陣列）。
4. 重新啟動 Claude Code 讓設定生效。

> 設定中的 command 已內嵌絕對的 node 與腳本路徑，避免在 hook 的 `sh -c` 環境找不到 node。

> **只想在本專案測試**：可改放到專案的 `.claude/settings.local.json`（本機、預設被 gitignore），不必動全域 `~/.claude/settings.json`，內容相同。Claude Code 會在啟動時載入並要你核准專案 hook。

## 驗證

App 開著時，在任一專案跑一次 Claude Code，回應結束（`Stop`）應看到 may 慶祝＋卡片。
或手動模擬：
```bash
echo '{"session_id":"demo","cwd":"'"$PWD"'"}' | node hooks/notify.mjs done
```

## 運作

`notify.mjs <type>` 讀 hook 的 stdin JSON（取 `session_id`、`cwd`）與 `endpoint.json`（取 `port`、`token`），
組成 `/notify` 的 body 後帶 `X-Token` POST 給 App。App 沒開時靜默結束，不影響 Claude Code。

## 除錯

設環境變數 `DESKPET_HOOK_LOG` 後，notify.mjs 每次被觸發都會把時戳追加到該檔，可確認 hook 是否真的被 Claude Code 觸發（fired / posted / app-not-running）：
```bash
DESKPET_HOOK_LOG=/tmp/deskpet-hook.log node hooks/notify.mjs done
cat /tmp/deskpet-hook.log
```
未設此變數時完全不寫日誌。
