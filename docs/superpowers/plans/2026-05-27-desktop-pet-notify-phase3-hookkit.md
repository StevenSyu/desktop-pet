# 桌面寵物通知工具 — Phase 3：Hook Kit（接上真實 Claude Code 事件）實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓真實的 Claude Code 事件（完成 / 需要你 / 出錯）透過 hook 驅動桌面寵物 may，而不再用 curl 模擬。

**Architecture:** Claude Code 的 `command` hook 執行一個小 notify 腳本（node，免 build、可獨立執行）；腳本讀 hook 的 stdin JSON 與 App 的 `endpoint.json`，把事件映射成 `/notify` 契約並帶 `X-Token` POST 給既有的 ingest server。不更動 server 或 `/notify` 契約。另提供一鍵印出 settings.json 設定的工具與安裝說明。

**Tech Stack:** Node（global fetch，Node 18+）、既有 Vitest。純邏輯以 vitest TDD，腳本 IO 與安裝以整合測試驗證。

**設計來源：** `docs/superpowers/specs/2026-05-27-desktop-pet-notify-design.md`（§6 契約、§8 事件對應）＋ claude-code-guide 查證的官方 hooks 規格（code.claude.com/docs/en/hooks）。

**前置：** Phase 2 已併入 main（App 可跑、`/notify` 端點＋`endpoint.json`＋token 就緒）。

**事件對應（v1，依官方 hook 語意）：**
| Claude Code hook | matcher | → type | 寵物反應 |
|---|---|---|---|
| `Stop` | `""` | `done` | 慶祝（Claude 回完一輪） |
| `Notification` | `permission_prompt` | `attention` | 招手（需你授權） |
| `StopFailure` | `""` | `error` | 沮喪（API 錯誤：rate_limit/auth/server…） |

> 註：`Stop` 每輪回應結束都會觸發（非僅「任務完成」）；不在使用者中斷時觸發。`Notification` 的 `idle_prompt`（完成並等待你輸入）與 `SubagentStop` 為日後可選來源，v1 先不接以免過於頻繁。

**範圍（Phase 3）：** notify 腳本（映射＋POST）、一鍵印出 settings.json 設定、安裝說明、整合驗證。
**不在 Phase 3：** 自動寫入使用者 settings.json（僅印出供貼上，避免擅改使用者設定）、tool-failure（build 失敗）偵測、idle_prompt/SubagentStop 來源。

**注意：**
- 所有 commit 訊息結尾附：`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- 需要網路的步驟由 Claude 執行；Codex 沙箱無 npm 網路（本 Phase 不需安裝新依賴）。

---

## File Structure

```
desktop-notify/
├── hooks/
│   ├── payload.mjs          # 純函式 buildHookPayload(type, stdinJson) → /notify body
│   ├── notify.mjs           # 讀 stdin + endpoint.json → POST /notify（hook command 目標）
│   ├── print-config.mjs     # 印出 settings.json hooks 區塊（含絕對路徑）
│   └── README.md            # 安裝與驗證說明
├── tests/hooks/
│   └── payload.test.ts      # buildHookPayload 單元測試（TDD）
└── package.json             # 加 scripts: hooks:config
```

`hooks/` 的 .mjs 為純 JS、由 node 直接執行（不經 electron-vite build），方便當 hook command。`payload.mjs` 的純邏輯以 vitest 測試。

---

## Task 1：payload.mjs — 事件 payload 建構（TDD）

**Files:**
- Create: `hooks/payload.mjs`
- Test: `tests/hooks/payload.test.ts`

對應 spec §6 契約。把「type ＋ hook stdin → /notify body」的純映射抽出來測試。

- [ ] **Step 1: 寫失敗測試**

Create `tests/hooks/payload.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildHookPayload } from '../../hooks/payload.mjs'

describe('buildHookPayload', () => {
  it('maps a known type and derives source.name from cwd basename', () => {
    const body = buildHookPayload('done', { session_id: 's1', cwd: '/Users/x/work/my-proj' })
    expect(body).toEqual({
      source: { kind: 'claude-code', name: 'my-proj' },
      sessionId: 's1',
      type: 'done',
      title: 'Claude Code · my-proj',
      body: '這一輪完成了',
    })
  })

  it('falls back to info for an unknown type', () => {
    const body = buildHookPayload('wat', { session_id: 's1', cwd: '/a/b' })
    expect(body.type).toBe('info')
  })

  it('uses defaults when cwd / session_id are missing', () => {
    const body = buildHookPayload('attention', {})
    expect(body.source).toEqual({ kind: 'claude-code', name: 'claude-code' })
    expect(body.sessionId).toBe('default')
    expect(body.type).toBe('attention')
  })

  it('has a distinct body for error', () => {
    expect(buildHookPayload('error', { cwd: '/a/b' }).body).toBe('回應失敗（API 錯誤）')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/hooks/payload.test.ts`
Expected: FAIL（無法解析 `../../hooks/payload.mjs`）。

- [ ] **Step 3: 寫實作**

Create `hooks/payload.mjs`:
```js
import { basename } from 'node:path'

const KNOWN = ['done', 'attention', 'error', 'review', 'working', 'info']

const BODY = {
  done: '這一輪完成了',
  attention: '需要你回覆或授權',
  error: '回應失敗（API 錯誤）',
  review: '請看一下',
  working: '處理中…',
  info: '',
}

/**
 * 將 hook 事件（type 由 hook command 指定）＋ Claude Code 的 stdin JSON
 * 映射成桌面寵物 /notify 的 body。純函式、可測。
 * @param {string} type done|attention|error|review|working|info
 * @param {Record<string, unknown>} stdinJson Claude Code hook 的 stdin JSON
 */
export function buildHookPayload(type, stdinJson = {}) {
  const t = KNOWN.includes(type) ? type : 'info'
  const cwd = typeof stdinJson.cwd === 'string' ? stdinJson.cwd : ''
  const name = cwd ? basename(cwd) : 'claude-code'
  const sessionId =
    typeof stdinJson.session_id === 'string' && stdinJson.session_id.length > 0
      ? stdinJson.session_id
      : 'default'
  return {
    source: { kind: 'claude-code', name },
    sessionId,
    type: t,
    title: `Claude Code · ${name}`,
    body: BODY[t],
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/hooks/payload.test.ts`
Expected: PASS（4 tests）。

- [ ] **Step 5: Commit**

```bash
git add hooks/payload.mjs tests/hooks/payload.test.ts
git commit -m "feat(hooks): buildHookPayload 事件映射（純函式 + 測試）" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：notify.mjs — hook command 目標腳本

**Files:**
- Create: `hooks/notify.mjs`

讀 hook stdin 與 `endpoint.json`，組 payload 後 POST `/notify`。App 沒開或連不到時靜默結束（不可干擾 Claude Code）。

- [ ] **Step 1: 寫腳本**

Create `hooks/notify.mjs`:
```js
#!/usr/bin/env node
// Claude Code hook → 桌面寵物。用法：node hooks/notify.mjs <type>
// <type>：done | attention | error（由各 hook command 指定）
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { buildHookPayload } from './payload.mjs'

const type = process.argv[2] ?? 'info'
const ENDPOINT = join(homedir(), 'Library', 'Application Support', 'desktop-notify', 'endpoint.json')

async function readStdin() {
  let raw = ''
  try {
    for await (const chunk of process.stdin) raw += chunk
  } catch {
    /* 無 stdin 也無妨 */
  }
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

async function main() {
  const stdinJson = await readStdin()
  if (!existsSync(ENDPOINT)) return // App 沒開 → 靜默結束（exit 0）

  let endpoint
  try {
    endpoint = JSON.parse(readFileSync(ENDPOINT, 'utf8'))
  } catch {
    return
  }
  const { port, token } = endpoint
  const body = buildHookPayload(type, stdinJson)

  try {
    await fetch(`http://127.0.0.1:${port}/notify`, {
      method: 'POST',
      headers: { 'X-Token': token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    /* App 剛關 / 連不到 → 靜默，不可讓 hook 失敗影響 Claude */
  }
}

main()
```

- [ ] **Step 2: 手動煙霧（App 未開也不該報錯）**

Run:
```bash
echo '{"session_id":"t1","cwd":"/x/y/demo"}' | node hooks/notify.mjs done; echo "exit=$?"
```
Expected: exit=0（App 沒開時靜默結束，無例外輸出）。

- [ ] **Step 3: Commit**

```bash
git add hooks/notify.mjs
git commit -m "feat(hooks): notify.mjs（讀 stdin + endpoint.json → POST /notify）" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：print-config.mjs ＋ npm 指令（印出 settings.json 設定）

**Files:**
- Create: `hooks/print-config.mjs`
- Modify: `package.json`

印出可貼進 `~/.claude/settings.json` 的 hooks 區塊；command 內嵌**絕對的 node 路徑與腳本路徑**（避免 hook 在 `sh -c` 環境找不到 nvm 的 node）。

- [ ] **Step 1: 寫 print-config.mjs**

Create `hooks/print-config.mjs`:
```js
// 印出可貼進 ~/.claude/settings.json 的 hooks 設定（含絕對路徑）。
// 用法：npm run hooks:config
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const notify = join(here, 'notify.mjs')
const node = process.execPath
const cmd = (type) => `"${node}" "${notify}" ${type}`

const config = {
  hooks: {
    Stop: [{ matcher: '', hooks: [{ type: 'command', command: cmd('done'), timeout: 10 }] }],
    Notification: [
      { matcher: 'permission_prompt', hooks: [{ type: 'command', command: cmd('attention'), timeout: 10 }] },
    ],
    StopFailure: [{ matcher: '', hooks: [{ type: 'command', command: cmd('error'), timeout: 10 }] }],
  },
}

console.log(JSON.stringify(config, null, 2))
```

- [ ] **Step 2: 加 npm script**

Modify `package.json` — 在 scripts 加入（保留其餘）：
```json
    "hooks:config": "node hooks/print-config.mjs",
```
（加在 `"e2e"` 那行之後即可。）

- [ ] **Step 3: 驗證輸出**

Run: `npm run hooks:config`
Expected: 印出合法 JSON，內含 Stop/Notification/StopFailure 三個 hook，command 為 `"<abs-node>" "<abs>/hooks/notify.mjs" done|attention|error`。可用 `npm run hooks:config | node -e 'JSON.parse(require("fs").readFileSync(0))'` 確認為合法 JSON（exit 0）。

- [ ] **Step 4: Commit**

```bash
git add hooks/print-config.mjs package.json
git commit -m "feat(hooks): hooks:config 印出 settings.json 設定（絕對路徑）" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4：安裝與驗證說明

**Files:**
- Create: `hooks/README.md`

- [ ] **Step 1: 寫 README**

Create `hooks/README.md`:
```markdown
# Hook Kit — 把 Claude Code 事件接到桌面寵物

讓 Claude Code 的事件驅動桌面寵物 may：
- `Stop`（Claude 回完一輪）→ 慶祝
- `Notification / permission_prompt`（需要你授權）→ 招手
- `StopFailure`（API 錯誤）→ 沮喪

## 安裝

1. 先確定桌面寵物 App 有在執行（它會寫出 `~/Library/Application Support/desktop-notify/endpoint.json`）。
2. 產生設定：
   ```bash
   npm run hooks:config
   ```
3. 把輸出的 `"hooks"` 區塊合併進你的 `~/.claude/settings.json`（若已有其他 hooks，請手動合併同名事件的陣列）。
4. 重新啟動 Claude Code 讓設定生效。

> 設定中的 command 已內嵌絕對的 node 與腳本路徑，避免在 hook 的 `sh -c` 環境找不到 node。

## 驗證

App 開著時，在任一專案跑一次 Claude Code，回應結束（`Stop`）應看到 may 慶祝＋卡片。
或手動模擬：
```bash
echo '{"session_id":"demo","cwd":"'"$PWD"'"}' | node hooks/notify.mjs done
```

## 運作

`notify.mjs <type>` 讀 hook 的 stdin JSON（取 `session_id`、`cwd`）與 `endpoint.json`（取 `port`、`token`），
組成 `/notify` 的 body 後帶 `X-Token` POST 給 App。App 沒開時靜默結束，不影響 Claude Code。
```

- [ ] **Step 2: Commit**

```bash
git add hooks/README.md
git commit -m "docs(hooks): 安裝與驗證說明" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：整合驗證（模擬真實 hook 流程）

**Files:** 無（驗證）。由 Claude 執行（需啟動 App）。

- [ ] **Step 1: 單元測試與既有 e2e 仍綠**

Run: `npm test` → 全綠（含 Task 1 的 payload 測試）。
Run: `npm run typecheck` → 通過。

- [ ] **Step 2: 端到端模擬三個 hook（App 執行中）**

Run（啟動 App，依序用 notify.mjs 模擬 Stop/Notification/StopFailure 對應的 type，餵入擬真 stdin）：
```bash
EP="$HOME/Library/Application Support/desktop-notify/endpoint.json"; rm -f "$EP"
perl -e 'alarm 30; exec @ARGV' ./node_modules/.bin/electron . >/tmp/deskpet-hook.log 2>&1 &
node -e '
const fs=require("fs"),os=require("os"),path=require("path");
const EP=path.join(os.homedir(),"Library/Application Support/desktop-notify/endpoint.json");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {execFileSync}=require("child_process");
(async()=>{
  for(let i=0;i<40 && !fs.existsSync(EP);i++) await sleep(300);
  for (const t of ["done","attention","error"]) {
    execFileSync(process.execPath, ["hooks/notify.mjs", t], { input: JSON.stringify({session_id:"demo",cwd:process.cwd()}) });
    console.log("sent "+t); await sleep(5000);
  }
  console.log("HOOK_E2E_DONE");
})();
'
pkill -f "desktop-notify/node_modules/electron" 2>/dev/null
```
Expected: 三個 type 皆被 notify.mjs 送達；App 端 may 依序播 慶祝/招手/沮喪＋卡片（視覺由使用者確認）。`/tmp/deskpet-hook.log` 無致命錯誤。

- [ ] **Step 3: 確認工作樹乾淨**

Run: `git status --short`
Expected: 空。

---

## 驗收標準（Phase 3 完成定義）

- `npm test` 全綠（含 `buildHookPayload`）。
- `npm run typecheck` 通過。
- `node hooks/notify.mjs done`（App 未開）→ exit 0、靜默。
- `npm run hooks:config` → 合法 JSON、含三個 hook、command 為絕對路徑。
- 整合：App 開著時，notify.mjs 模擬的 done/attention/error 會讓 may 反應＋卡片。
- `hooks/README.md` 安裝步驟清楚。

## 待後續

- 自動合併進 `~/.claude/settings.json` 的安裝指令（目前僅印出供貼上）。
- tool-failure（build/測試失敗）偵測 → error（需 PostToolUse 解析工具結果）。
- `idle_prompt`（完成等待輸入）、`SubagentStop` 來源；多 session 卡片來源辨識的 UI 強化。
- 打包成可分發 App（codesign / notarize）後，endpoint.json 路徑與安裝流程的最終化。
```
