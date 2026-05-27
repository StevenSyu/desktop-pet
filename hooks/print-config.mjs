// 印出可貼進 ~/.claude/settings.json 的 hooks 設定（含絕對路徑）。
// 用法：node hooks/print-config.mjs（或 npm run --silent hooks:config）
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
