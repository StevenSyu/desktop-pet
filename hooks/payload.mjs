import { basename } from 'node:path'
import { extractLastAssistantText } from './transcript.mjs'

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
 *
 * - type=done 時，會嘗試從 `stdin.transcript_path` 抓 Claude 最後一段純文字回覆
 *   作為 body（卡片 CSS 2 行截斷、通知中心可展開看全文）。抓不到再退回固定字串。
 *
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

  let body = BODY[t]
  if (t === 'done') {
    const text = extractLastAssistantText(
      typeof stdinJson.transcript_path === 'string' ? stdinJson.transcript_path : undefined,
    )
    if (text) body = text
  }

  return {
    source: { kind: 'claude-code', name },
    sessionId,
    type: t,
    title: `Claude Code · ${name}`,
    body,
  }
}
