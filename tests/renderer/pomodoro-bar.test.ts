// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { initPomodoroBar, type PomodoroBarBridge } from '../../src/renderer/pomodoro-bar'
import type { PomodoroSnapshot } from '../../src/core/pomodoro-timer'

const SNAP_IDLE: PomodoroSnapshot = { phase: 'idle', paused: false, startedAt: 0, durationMs: 0, elapsedMs: 0 }

function makeBridge(over: Partial<Record<keyof PomodoroBarBridge, unknown>> = {}): {
  bridge: PomodoroBarBridge
  pushSnap: (s: PomodoroSnapshot) => void
  pushPrefs: (p: { pomodoro: { enabled: boolean; showOnAll: boolean }; allEnabled: boolean }) => void
  pushChannels: (chs: { id: string; enabled: boolean; pomodoroEnabled: boolean }[]) => void
  commands: Record<'start' | 'pause' | 'resume' | 'stop', ReturnType<typeof vi.fn>>
} {
  let snapCb: ((s: PomodoroSnapshot) => void) | null = null
  let prefsCb: ((p: never) => void) | null = null
  let chCb: ((c: never) => void) | null = null
  const commands = { start: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn() }
  const bridge: PomodoroBarBridge = {
    getPomodoro: () => Promise.resolve(SNAP_IDLE),
    onPomodoroChanged: (cb) => {
      snapCb = cb
    },
    getPrefs: () => Promise.resolve({ pomodoro: { enabled: true, showOnAll: true }, allEnabled: true }),
    onPrefsChanged: (cb) => {
      prefsCb = cb as never
    },
    getChannels: () => Promise.resolve([]),
    onChannelsUpdated: (cb) => {
      chCb = cb as never
    },
    pomodoroStart: commands.start,
    pomodoroPause: commands.pause,
    pomodoroResume: commands.resume,
    pomodoroStop: commands.stop,
    ...(over as Partial<PomodoroBarBridge>),
  }
  return {
    bridge,
    pushSnap: (s) => snapCb?.(s),
    pushPrefs: (p) => prefsCb?.(p as never),
    pushChannels: (c) => chCb?.(c as never),
    commands,
  }
}

function dom(): { bar: HTMLDivElement; time: HTMLSpanElement; toggle: HTMLButtonElement; stop: HTMLButtonElement } {
  document.body.innerHTML = `
    <div id="pomodoro-bar" hidden>
      <span id="pomo-time">--:--</span>
      <button id="pomo-toggle">▶</button>
      <button id="pomo-stop">■</button>
    </div>`
  return {
    bar: document.querySelector('#pomodoro-bar')!,
    time: document.querySelector('#pomo-time')!,
    toggle: document.querySelector('#pomo-toggle')!,
    stop: document.querySelector('#pomo-stop')!,
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('pomodoro-bar widget', () => {
  it('未啟用 → hover 也不顯示', async () => {
    const { bar } = dom()
    const m = makeBridge({ getPrefs: () => Promise.resolve({ pomodoro: { enabled: false, showOnAll: true }, allEnabled: true }) })
    const w = initPomodoroBar(m.bridge, 'all')
    await flush()
    w.setHovering(true)
    expect(bar.hidden).toBe(true)
  })

  it('啟用 + hover → 顯示；idle 顯示 --:-- 且停止鈕 disabled', async () => {
    const els = dom()
    const m = makeBridge()
    const w = initPomodoroBar(m.bridge, 'all')
    await flush()
    w.setHovering(true)
    expect(els.bar.hidden).toBe(false)
    expect(els.time.textContent).toBe('--:--')
    expect(els.toggle.textContent).toBe('▶')
    expect(els.stop.disabled).toBe(true)
  })

  it('運行中顯示剩餘 MM:SS、data-phase=work；paused 切灰凍結', async () => {
    const els = dom()
    const m = makeBridge()
    const w = initPomodoroBar(m.bridge, 'all')
    await flush()
    w.setHovering(true)
    m.pushSnap({ phase: 'work', paused: false, startedAt: Date.now(), durationMs: 90_000, elapsedMs: 0 })
    expect(els.bar.dataset.phase).toBe('work')
    expect(els.time.textContent).toBe('01:30')
    m.pushSnap({ phase: 'work', paused: true, startedAt: 0, durationMs: 90_000, elapsedMs: 30_000 })
    expect(els.bar.dataset.paused).toBe('true')
    expect(els.time.textContent).toBe('01:00') // durationMs - elapsedMs，凍結值
    expect(els.toggle.textContent).toBe('▶')
  })

  it('▶ 雙語意：idle→start、paused→resume、running→pause；■→stop', async () => {
    const els = dom()
    const m = makeBridge()
    const w = initPomodoroBar(m.bridge, 'all')
    await flush()
    w.setHovering(true)

    els.toggle.click()
    expect(m.commands.start).toHaveBeenCalledOnce()

    m.pushSnap({ phase: 'work', paused: false, startedAt: Date.now(), durationMs: 60_000, elapsedMs: 0 })
    els.toggle.click()
    expect(m.commands.pause).toHaveBeenCalledOnce()

    m.pushSnap({ phase: 'work', paused: true, startedAt: 0, durationMs: 60_000, elapsedMs: 10_000 })
    els.toggle.click()
    expect(m.commands.resume).toHaveBeenCalledOnce()

    els.stop.click()
    expect(m.commands.stop).toHaveBeenCalledOnce()
  })

  it('自訂 channel：顯示依 channel.pomodoroEnabled（非 showOnAll）', async () => {
    const els = dom()
    const m = makeBridge()
    const w = initPomodoroBar(m.bridge, 'ch-1')
    await flush()
    w.setHovering(true)
    expect(els.bar.hidden).toBe(true) // 無 channel 資料 → off

    m.pushChannels([{ id: 'ch-1', enabled: true, pomodoroEnabled: true }])
    expect(els.bar.hidden).toBe(false)

    m.pushChannels([{ id: 'ch-1', enabled: true, pomodoroEnabled: false }])
    expect(els.bar.hidden).toBe(true)
  })

  it('「全部」pet：showOnAll && allEnabled 才顯示（對齊 driver targets）', async () => {
    const els = dom()
    const m = makeBridge()
    const w = initPomodoroBar(m.bridge, 'all')
    await flush()
    w.setHovering(true)
    expect(els.bar.hidden).toBe(false)

    m.pushPrefs({ pomodoro: { enabled: true, showOnAll: true }, allEnabled: false })
    expect(els.bar.hidden).toBe(true)
  })

  it('hover 離開 → 隱藏且 ticker 停（無漏跑 interval）', async () => {
    const els = dom()
    const m = makeBridge()
    const w = initPomodoroBar(m.bridge, 'all')
    await flush()
    w.setHovering(true)
    m.pushSnap({ phase: 'work', paused: false, startedAt: Date.now(), durationMs: 60_000, elapsedMs: 0 })
    expect(els.bar.hidden).toBe(false)

    w.setHovering(false)
    expect(els.bar.hidden).toBe(true)
    const before = els.time.textContent
    vi.advanceTimersByTime(5_000) // ticker 若還在會改 textContent（hidden early-return 也不會跑 interval）
    expect(els.time.textContent).toBe(before)
  })
})
