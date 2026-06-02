#!/usr/bin/env node
import { join } from 'node:path'

const nodePath = process.execPath
const notifyPath = join(process.cwd(), 'hooks', 'codex-notify.mjs')

function command(type) {
  return `"${nodePath}" "${notifyPath}" ${type}`
}

console.log(JSON.stringify({
  hooks: {
    SessionStart: [
      {
        matcher: 'startup|resume|clear|compact',
        hooks: [
          {
            type: 'command',
            command: command('info'),
            commandWindows: command('info'),
            timeout: 10,
            statusMessage: 'Notifying desktop pet',
          },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: 'command',
            command: command('working'),
            commandWindows: command('working'),
            timeout: 10,
            statusMessage: 'Notifying desktop pet',
          },
        ],
      },
    ],
    PermissionRequest: [
      {
        matcher: '.*',
        hooks: [
          {
            type: 'command',
            command: command('attention'),
            commandWindows: command('attention'),
            timeout: 10,
            statusMessage: 'Notifying desktop pet',
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: 'command',
            command: command('done'),
            commandWindows: command('done'),
            timeout: 10,
            statusMessage: 'Notifying desktop pet',
          },
        ],
      },
    ],
  },
}, null, 2))
