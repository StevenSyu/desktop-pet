import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_POMODORO_PREFS, type PomodoroPrefs } from '../../src/core/pomodoro-timer'
import type { Channel } from '../../src/core/channel'

// ===== mocks：pomodoro-driver 的 main 端依賴 =====
const ipcMain = { on: vi.fn(), handle: vi.fn() }
vi.mock('electron', () => ({
  get ipcMain() {
    return ipcMain
  },
}))

const state = {
  prefs: {
    dnd: false,
    allEnabled: true,
    channels: [] as Channel[],
    pomodoro: { ...DEFAULT_POMODORO_PREFS } as PomodoroPrefs,
  },
  petWindows: new Set<string>(['all']),
}
const broadcastToPets = vi.fn()
vi.mock('../../src/main/prefs-store', () => ({
  getPrefs: () => state.prefs,
  updatePrefsStore: vi.fn(),
  subscribePrefs: vi.fn(),
}))
vi.mock('../../src/main/window', () => ({
  broadcastToPets: (...args: unknown[]) => broadcastToPets(...args),
  getPetWindow: (id: string) => (state.petWindows.has(id) ? ({ fake: id } as never) : undefined),
}))

import { initPomodoro } from '../../src/main/pomodoro-driver'

const ch = (id: string, over: Partial<Channel> = {}): Channel => ({
  id,
  name: id,
  skin: '',
  enabled: true,
  showPet: true,
  pomodoroEnabled: true,
  members: [{ kind: 'x' }],
  ...over,
})

function commandHandler(channel: string): (payload?: unknown) => void {
  // 多次 initPomodoro 會疊 handler（mock ipcMain 不去重）——取最後註冊的（當前 instance）
  const entry = ipcMain.on.mock.calls.findLast((c) => c[0] === channel)
  if (!entry) throw new Error(`no handler for ${channel}`)
  const h = entry[1] as (e: unknown, payload?: unknown) => void
  return (payload?: unknown) => h({}, payload)
}

beforeEach(() => {
  vi.useFakeTimers()
  ipcMain.on.mockClear()
  broadcastToPets.mockClear()
  state.prefs.dnd = false
  state.prefs.allEnabled = true
  state.prefs.channels = []
  state.prefs.pomodoro = { ...DEFAULT_POMODORO_PREFS, enabled: true, workMs: 60_000, breakMs: 60_000 }
  state.petWindows = new Set(['all'])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('pomodoro-driver fan-out（targets 編排）', () => {
  it('work 結束 → showCard 推給「全部」與 pomodoroEnabled 的頻道 pet；未啟用頻道排除', () => {
    state.prefs.channels = [ch('ch-on'), ch('ch-off', { pomodoroEnabled: false })]
    state.petWindows = new Set(['all', 'ch-on', 'ch-off'])
    const showCard = vi.fn()
    const playSound = vi.fn()
    initPomodoro({ showCard, playSound })

    commandHandler('pomodoro-start')()
    vi.advanceTimersByTime(61_000) // work 60s 結束

    const targets = showCard.mock.calls.map((c) => c[0])
    expect(targets).toContain('all')
    expect(targets).toContain('ch-on')
    expect(targets).not.toContain('ch-off')
    // 同一張 transient card：5 秒自動消失 + 不進通知中心（無 store 寫入可驗——view 形狀為證）
    const view = showCard.mock.calls[0][1]
    expect(view.transient).toEqual({ dismissMs: 5000 })
    expect(view.label).toContain('休息')
  })

  it('pet window 不存在的 target 過濾掉（showOnAll 但 all pet 已關）', () => {
    state.prefs.channels = [ch('ch-on')]
    state.petWindows = new Set(['ch-on']) // 無 all
    const showCard = vi.fn()
    const playSound = vi.fn()
    initPomodoro({ showCard, playSound })

    commandHandler('pomodoro-start')()
    vi.advanceTimersByTime(61_000)

    const targets = showCard.mock.calls.map((c) => c[0])
    expect(targets).toEqual(['ch-on'])
  })

  it('DND 開啟 → 卡片吞掉、timer 照走（之後 break 結束仍觸發下一次嘗試）', () => {
    state.prefs.dnd = true
    const showCard = vi.fn()
    const playSound = vi.fn()
    initPomodoro({ showCard, playSound })

    commandHandler('pomodoro-start')()
    vi.advanceTimersByTime(61_000) // work 結束：吞
    expect(showCard).not.toHaveBeenCalled()

    // timer 照走：phase 已切 break，snapshot 廣播仍發生
    const phases = broadcastToPets.mock.calls.filter((c) => c[0] === 'pomodoro-changed').map((c) => c[1].phase)
    expect(phases).toContain('break')
  })

  it('showOnAll=false → 「全部」pet 不收卡', () => {
    state.prefs.pomodoro.showOnAll = false
    state.prefs.channels = [ch('ch-on')]
    state.petWindows = new Set(['all', 'ch-on'])
    const showCard = vi.fn()
    const playSound = vi.fn()
    initPomodoro({ showCard, playSound })

    commandHandler('pomodoro-start')()
    vi.advanceTimersByTime(61_000)

    const targets = showCard.mock.calls.map((c) => c[0])
    expect(targets).toEqual(['ch-on'])
  })
})

describe('pomodoro-driver 音效', () => {
  it('phase 結束 → playSound 呼叫一次（與卡片同層）', () => {
    const showCard = vi.fn()
    const playSound = vi.fn()
    initPomodoro({ showCard, playSound })
    commandHandler('pomodoro-start')()
    vi.advanceTimersByTime(61_000)
    expect(playSound).toHaveBeenCalledOnce()
  })

  it('DND 開啟 → 卡片與音效一起被吞', () => {
    state.prefs.dnd = true
    const showCard = vi.fn()
    const playSound = vi.fn()
    initPomodoro({ showCard, playSound })
    commandHandler('pomodoro-start')()
    vi.advanceTimersByTime(61_000)
    expect(showCard).not.toHaveBeenCalled()
    expect(playSound).not.toHaveBeenCalled()
  })
})
