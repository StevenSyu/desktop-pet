#!/usr/bin/env node
import { join } from 'node:path'

const nodePath = process.execPath
const notifyPath = join(process.cwd(), 'hooks', 'codex-notify.mjs')

function command(type) {
  return `"${nodePath}" "${notifyPath}" ${type}`
}

console.log(JSON.stringify({
  hooks: {
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
