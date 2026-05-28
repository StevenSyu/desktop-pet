// Playwright(_electron) 煙霧測試：啟動 App、攔截 renderer console/pageerror、
// 檢查 window.petBridge、idle 動畫（background-position 是否變動）、事件→卡片，並截圖。
// 用法：node scripts/e2e-smoke.mjs
import { _electron as electron } from 'playwright-core'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const SHOT = '/tmp/deskpet-shot.png'
const EP = join(homedir(), 'Library/Application Support/desktop-notify/endpoint.json')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const logs = []
let exitCode = 0
const app = await electron.launch({ args: ['.'] })
try {
  const win = await app.firstWindow()
  win.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
  win.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
  await win.waitForLoadState('domcontentloaded')
  await sleep(1500)

  const bridge = await win.evaluate(() => typeof window.petBridge)
  const petCount = await win.locator('#pet').count()
  const bg1 = await win.evaluate(() => getComputedStyle(document.querySelector('#pet')).backgroundPosition)
  await sleep(1200) // idle 為 0.8s/格，取樣間隔需 > 一格才能保證跨格
  const bg2 = await win.evaluate(() => getComputedStyle(document.querySelector('#pet')).backgroundPosition)
  const animating = bg1 !== bg2

  let cardCount = 0
  let cardText = ''
  if (existsSync(EP)) {
    const { port, token } = JSON.parse(readFileSync(EP, 'utf8'))
    await fetch(`http://127.0.0.1:${port}/notify`, {
      method: 'POST',
      headers: { 'X-Token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'done', title: 'Claude Code', body: '任務完成！', source: 'smoke' }),
    })
    await sleep(800)
    cardCount = await win.locator('#cards .card').count()
    cardText = await win.locator('#cards').innerText().catch(() => '')
  } else {
    logs.push('[warn] endpoint.json 不存在（main 可能沒寫）')
  }

  await win.screenshot({ path: SHOT })

  console.log('=== Playwright Electron 煙霧測試 ===')
  console.log('window.petBridge   :', bridge)
  console.log('#pet 元素數        :', petCount)
  console.log('idle 動畫(bg 變動) :', animating, `(${bg1} -> ${bg2})`)
  console.log('觸發 done 後卡片數 :', cardCount)
  console.log('卡片文字           :', JSON.stringify(cardText))
  console.log('截圖               :', SHOT)
  console.log('--- renderer console / errors ---')
  console.log(logs.join('\n') || '(none)')

  const ok = bridge !== 'undefined' && petCount === 1 && animating && cardCount >= 1
  console.log(ok ? 'SMOKE_RESULT: PASS' : 'SMOKE_RESULT: FAIL')
  exitCode = ok ? 0 : 1
} catch (e) {
  console.error('harness error:', e?.message ?? e)
  console.log(logs.join('\n'))
  exitCode = 2
} finally {
  await app.close()
}
process.exit(exitCode)
