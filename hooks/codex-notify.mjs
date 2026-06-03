#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { buildCodexPayload, normalizeCodexType, sessionId } from './codex-payload.mjs'

const type = process.argv[2] ?? 'info'
const normalizedType = normalizeCodexType(type)

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

async function main() {
  const input = await readStdinJson()
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

  const payload = buildCodexPayload(type, input)

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
