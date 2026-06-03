import { basename } from 'node:path'

const knownTypes = new Set(['done', 'attention', 'error', 'review', 'working', 'info'])

const fallbackBody = {
  done: '這一輪完成了',
  attention: '需要你回覆或授權',
  error: '回應失敗（API 錯誤）',
  review: '請看一下',
  working: '處理中…',
  info: '',
}

function textField(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function sourceName(input) {
  const cwd = textField(input.cwd) || textField(input.working_directory) || process.cwd()
  return basename(cwd) || 'codex'
}

export function sessionId(input) {
  return textField(input.session_id) || textField(input.sessionId) || textField(input.thread_id) || textField(input.threadId) || 'default'
}

function titleFor(input, name) {
  const event = textField(input.event) || textField(input.hook_event_name) || textField(input.hookEventName)
  return event ? `Codex - ${event} - ${name}` : `Codex - ${name}`
}

export function normalizeCodexType(inputType) {
  return knownTypes.has(inputType) ? inputType : 'info'
}

export function buildCodexPayload(inputType, input = {}) {
  const t = normalizeCodexType(inputType)
  const name = sourceName(input)
  return {
    source: { kind: 'codex', name },
    sessionId: sessionId(input),
    type: t,
    title: titleFor(input, name),
    body: textField(input.message) || textField(input.summary) || fallbackBody[t],
  }
}
