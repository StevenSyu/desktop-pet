#!/usr/bin/env node
// Claude Code hook → 桌面寵物。用法：node hooks/notify.mjs <type>
// <type>：done | attention | error（由各 hook command 指定）
import { readFileSync, existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { buildHookPayload } from './payload.mjs'

const type = process.argv[2] ?? 'info'
const ENDPOINT = join(homedir(), 'Library', 'Application Support', 'desktop-notify', 'endpoint.json')

// env-gated 除錯追蹤：設了 DESKPET_HOOK_LOG 才寫；用於確認 hook 是否被觸發
function trace(msg) {
  const logPath = process.env.DESKPET_HOOK_LOG
  if (!logPath) return
  try {
    appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`)
  } catch {
    /* 追蹤失敗不可影響 hook */
  }
}

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
  trace(`fired type=${type} session=${stdinJson.session_id ?? '-'} cwd=${stdinJson.cwd ?? '-'}`)

  if (!existsSync(ENDPOINT)) {
    trace('app-not-running (endpoint.json 不存在)')
    return // App 沒開 → 靜默結束（exit 0）
  }

  let endpoint
  try {
    endpoint = JSON.parse(readFileSync(ENDPOINT, 'utf8'))
  } catch {
    trace('endpoint.json 解析失敗')
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
    trace(`posted → 127.0.0.1:${port}`)
  } catch {
    trace('post-failed (App 連不到)')
    /* App 剛關 / 連不到 → 靜默，不可讓 hook 失敗影響 Claude */
  }
}

main()
