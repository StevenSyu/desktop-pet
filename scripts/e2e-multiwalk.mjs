// 多隻寵物自由走動驗證：3 隻 pet（all + 2 channels），縮短 walk 間隔，
// 觀察每隻視窗 x 位移 + 同時走動;另直接 walkStart 驗證 per-channel main wiring。
// 備份/還原真實 prefs.json 與 window-state.json。
import { _electron as electron } from 'playwright-core'
import { readFileSync, writeFileSync, existsSync, rmSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const UD = join(homedir(), 'Library/Application Support/desktop-notify')
const PREFS = join(UD, 'prefs.json')
const WSTATE = join(UD, 'window-state.json')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ===== 備份 =====
const backups = []
for (const f of [PREFS, WSTATE]) {
  if (existsSync(f)) {
    copyFileSync(f, f + '.e2e-bak')
    backups.push(f)
  }
}
const restore = () => {
  for (const f of [PREFS, WSTATE]) {
    if (backups.includes(f)) copyFileSync(f + '.e2e-bak', f)
    else rmSync(f, { force: true })
    rmSync(f + '.e2e-bak', { force: true })
  }
}

// ===== 測試 prefs:3 隻 pet、walk 間隔 1.5-3s =====
writeFileSync(
  PREFS,
  JSON.stringify({
    autoWalk: true,
    walk: { intervalMinMs: 1500, intervalMaxMs: 3000, durationMinMs: 1500, durationMaxMs: 3000 },
    skin: 'may',
    channelLabelMode: 'always',
    dnd: false,
    allEnabled: true,
    channels: [
      { id: 'alpha', name: 'Alpha', skin: 'may', enabled: true, showPet: true, members: [{ name: 'alpha-src' }] },
      { id: 'beta', name: 'Beta', skin: 'may', enabled: true, showPet: true, members: [{ name: 'beta-src' }] },
    ],
    knownSources: [],
  }),
)
rmSync(WSTATE, { force: true })

const logs = []
let exitCode = 0
const app = await electron.launch({ args: ['.'] })
try {
  // ===== 等 3 個 pet 視窗就緒 =====
  const deadline = Date.now() + 10_000
  let petPages = []
  while (Date.now() < deadline) {
    petPages = app.windows().filter((p) => {
      const u = p.url()
      return u.includes('index.html') && /[?&]c=/.test(u)
    })
    if (petPages.length >= 3) break
    await sleep(300)
  }
  const chanOf = (p) => new URLSearchParams(p.url().split('?')[1]).get('c')
  for (const p of petPages) {
    p.on('console', (m) => { if (m.type() === 'error') logs.push(`[${chanOf(p)}][console.error] ${m.text()}`) })
    p.on('pageerror', (e) => logs.push(`[${chanOf(p)}][pageerror] ${e.message}`))
  }
  const channels = petPages.map(chanOf).sort()
  await sleep(1500) // renderer 初始化

  // main process 端:channelId → window x 座標
  const getXs = () =>
    app.evaluate(({ BrowserWindow }) => {
      const out = {}
      for (const w of BrowserWindow.getAllWindows()) {
        const m = w.webContents.getURL().match(/[?&]c=([^&]+)/)
        if (m) out[decodeURIComponent(m[1])] = w.getBounds().x
      }
      return out
    })

  // ===== 測試 1:直接 walkStart x3 → 全部同時動(per-channel session 驗證)=====
  const before = await getXs()
  await Promise.all(
    petPages.map((p) =>
      p.evaluate((c) => window.petBridge.walkStart(c, { direction: 'right', distance: 120, duration: 2000 }), chanOf(p)),
    ),
  )
  await sleep(1000) // 走到一半
  const mid = await getXs()
  await sleep(1800) // 走完
  const after = await getXs()
  const movedMid = channels.filter((c) => mid[c] !== before[c])
  const movedAll = channels.filter((c) => after[c] !== before[c])

  // ===== 測試 2:auto-walk(間隔 1.5-3s)→ 12s 內每隻都自己走 =====
  const auto = Object.fromEntries(channels.map((c) => [c, false]))
  let prev = await getXs()
  let concurrent = 0
  for (let i = 0; i < 40; i++) {
    await sleep(300)
    const cur = await getXs()
    const moving = channels.filter((c) => cur[c] !== prev[c])
    for (const c of moving) auto[c] = true
    if (moving.length >= 2) concurrent++
    prev = cur
    if (channels.every((c) => auto[c]) && concurrent > 0) break
  }

  for (const p of petPages) await p.screenshot({ path: `/tmp/deskpet-multi-${chanOf(p)}.png` }).catch(() => {})

  console.log('=== 多隻寵物走動測試 ===')
  console.log('pet 視窗 channels      :', channels.join(', '))
  console.log('walkStart 後同時移動   :', movedMid.join(', ') || '(none)', `(${movedMid.length}/3 mid-walk)`)
  console.log('walkStart 後位移完成   :', movedAll.join(', ') || '(none)', `(${movedAll.length}/3)`)
  console.log('auto-walk 各自觸發     :', JSON.stringify(auto))
  console.log('≥2 隻同時走動取樣次數  :', concurrent)
  console.log('x 座標 before/after    :', JSON.stringify(before), '->', JSON.stringify(after))
  console.log('--- renderer errors ---')
  console.log(logs.join('\n') || '(none)')

  const ok =
    channels.length === 3 &&
    movedMid.length === 3 &&
    movedAll.length === 3 &&
    channels.every((c) => auto[c]) &&
    concurrent > 0 &&
    logs.length === 0
  console.log(ok ? 'MULTIWALK_RESULT: PASS' : 'MULTIWALK_RESULT: FAIL')
  exitCode = ok ? 0 : 1
} catch (e) {
  console.error('harness error:', e?.message ?? e)
  console.log(logs.join('\n'))
  exitCode = 2
} finally {
  await app.close()
  restore()
}
process.exit(exitCode)
