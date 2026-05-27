// Phase 3 整合：對真實 App 經 hooks/notify.mjs（真實 hook 路徑）觸發，檢查卡片並截圖。
// 用法：node scripts/hook-e2e.mjs
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const logs = []
let exitCode = 0
const app = await electron.launch({ args: ['.'] })
try {
  const win = await app.firstWindow()
  win.on('pageerror', (e) => logs.push('[pageerror] ' + e.message))
  await win.waitForLoadState('domcontentloaded')
  await sleep(2500) // 等 App 寫出 endpoint.json

  // 真實 App 是獨立行程，execFileSync 阻塞本行程不影響它回應
  execFileSync(process.execPath, ['hooks/notify.mjs', 'done'], {
    input: JSON.stringify({ session_id: 'demo', cwd: process.cwd() }),
  })
  await sleep(900)

  const cardCount = await win.locator('#cards .card').count()
  const cardText = await win.locator('#cards').innerText().catch(() => '')
  await win.screenshot({ path: '/tmp/deskpet-hook-shot.png' })

  console.log('經 notify.mjs done 後卡片數 :', cardCount)
  console.log('卡片文字                    :', JSON.stringify(cardText))
  console.log('pageerror                   :', logs.join(' | ') || '(none)')
  const ok = cardCount >= 1 && logs.length === 0
  console.log(ok ? 'HOOK_REALAPP: PASS' : 'HOOK_REALAPP: FAIL')
  exitCode = ok ? 0 : 1
} catch (e) {
  console.error('harness error:', e?.message ?? e)
  exitCode = 2
} finally {
  await app.close()
}
process.exit(exitCode)
