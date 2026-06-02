#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'

const type = process.argv[2] ?? 'info'
const knownTypes = new Set(['done', 'attention', 'error', 'review', 'working', 'info'])
const normalizedType = knownTypes.has(type) ? type : 'info'

const fallbackBody = {
  done: 'Codex turn finished.',
  attention: 'Codex needs attention.',
  error: 'Codex reported an error.',
  review: 'Codex has something to review.',
  working: 'Codex is working.',
  info: 'Codex session event.',
}

function userDataDir() {
  const home = homedir()
  if (process.platform === 'win32') return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'desktop-notify')
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'desktop-notify')
  return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'desktop-notify')
}

const endpointPath = join(userDataDir(), 'endpoint.json')

function trace(message) {
  const logPath = process.env.DESKPET_HOOK_LOG
  if (!logPath) return
  try {
    appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Hook logging should never block Codex.
  }
}

async function readStdinJson() {
  let raw = ''
  try {
    for await (const chunk of process.stdin) raw += chunk
  } catch {
    return {}
  }
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    trace('stdin-json-parse-failed')
    return {}
  }
}

function textField(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function sourceName(input) {
  const cwd = textField(input.cwd) || textField(input.working_directory) || process.cwd()
  return basename(cwd) || 'codex'
}

function sessionId(input) {
  return textField(input.session_id) || textField(input.sessionId) || textField(input.thread_id) || textField(input.threadId) || 'default'
}

function titleFor(input, name) {
  const event = textField(input.event) || textField(input.hook_event_name) || textField(input.hookEventName)
  return event ? `Codex - ${event} - ${name}` : `Codex - ${name}`
}

async function main() {
  const input = await readStdinJson()
  const name = sourceName(input)
  trace(`fired type=${normalizedType} session=${sessionId(input)} cwd=${input.cwd ?? process.cwd()}`)

  if (!existsSync(endpointPath)) {
    trace('app-not-running')
    return
  }

  let endpoint
  try {
    endpoint = JSON.parse(readFileSync(endpointPath, 'utf8'))
  } catch {
    trace('endpoint-read-failed')
    return
  }

  const payload = {
    source: { kind: 'codex', name },
    sessionId: sessionId(input),
    type: normalizedType,
    title: titleFor(input, name),
    body: textField(input.message) || textField(input.summary) || fallbackBody[normalizedType],
  }

  try {
    await fetch(`http://127.0.0.1:${endpoint.port}/notify`, {
      method: 'POST',
      headers: { 'X-Token': endpoint.token, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    trace(`posted 127.0.0.1:${endpoint.port}`)
  } catch {
    trace('post-failed')
  }
}

main()
