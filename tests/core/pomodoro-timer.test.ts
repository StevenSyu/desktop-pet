import { describe, it, expect } from 'vitest'
import {
  pomodoroReducer,
  initialPomodoroState,
  DEFAULT_POMODORO_PREFS,
  type PomodoroState,
} from '../../src/core/pomodoro-timer'

const PREFS = { ...DEFAULT_POMODORO_PREFS } // { enabled:false, workMs:1_500_000, breakMs:300_000, afterBreak:'loop', showOnAll:true }

function startedState(now = 1000): PomodoroState {
  return pomodoroReducer(initialPomodoroState(PREFS), { type: 'START', now }).state
}

describe('pomodoroReducer', () => {
  it('START：idle → work，鎖定 phaseDurationMs = workMs', () => {
    const { state, effect } = pomodoroReducer(initialPomodoroState(PREFS), { type: 'START', now: 1000 })
    expect(state.phase).toBe('work')
    expect(state.startedAt).toBe(1000)
    expect(state.elapsedMs).toBe(0)
    expect(state.paused).toBe(false)
    expect(state.phaseDurationMs).toBe(PREFS.workMs)
    expect(effect.type).toBe('none')
  })

  it('TICK 未達邊界：state 不變、effect none', () => {
    const s = startedState(1000)
    const { state, effect } = pomodoroReducer(s, { type: 'TICK', now: 1000 + PREFS.workMs - 1 })
    expect(state).toBe(s) // 同一參照：無變化不產生新物件
    expect(effect.type).toBe('none')
  })

  it('work 結束 → 切 break + effect notify-work-end', () => {
    const s = startedState(1000)
    const { state, effect } = pomodoroReducer(s, { type: 'TICK', now: 1000 + PREFS.workMs })
    expect(state.phase).toBe('break')
    expect(state.startedAt).toBe(1000 + PREFS.workMs)
    expect(state.elapsedMs).toBe(0)
    expect(state.phaseDurationMs).toBe(PREFS.breakMs)
    expect(effect.type).toBe('notify-work-end')
  })

  it("break 結束 + afterBreak:'loop' → 回 work + effect notify-break-end", () => {
    let s = startedState(0)
    s = pomodoroReducer(s, { type: 'TICK', now: PREFS.workMs }).state // → break
    const { state, effect } = pomodoroReducer(s, { type: 'TICK', now: PREFS.workMs + PREFS.breakMs })
    expect(state.phase).toBe('work')
    expect(state.phaseDurationMs).toBe(PREFS.workMs)
    expect(effect.type).toBe('notify-break-end')
  })

  it("break 結束 + afterBreak:'pause' → 回 idle + effect notify-break-end", () => {
    let s = pomodoroReducer(initialPomodoroState({ ...PREFS, afterBreak: 'pause' }), { type: 'START', now: 0 }).state
    s = pomodoroReducer(s, { type: 'TICK', now: PREFS.workMs }).state // → break
    const { state, effect } = pomodoroReducer(s, { type: 'TICK', now: PREFS.workMs + PREFS.breakMs })
    expect(state.phase).toBe('idle')
    expect(effect.type).toBe('notify-break-end')
  })

  it('PAUSE 折算 elapsedMs 並凍結；TICK 在 paused 下不前進', () => {
    let s = startedState(1000)
    s = pomodoroReducer(s, { type: 'PAUSE', now: 11_000 }).state // 跑了 10s
    expect(s.paused).toBe(true)
    expect(s.elapsedMs).toBe(10_000)
    const after = pomodoroReducer(s, { type: 'TICK', now: 999_999_999 })
    expect(after.state).toBe(s)
    expect(after.effect.type).toBe('none')
  })

  it('RESUME 重設 startedAt 繼續累計', () => {
    let s = startedState(1000)
    s = pomodoroReducer(s, { type: 'PAUSE', now: 11_000 }).state
    s = pomodoroReducer(s, { type: 'RESUME', now: 50_000 }).state
    expect(s.paused).toBe(false)
    expect(s.startedAt).toBe(50_000)
    expect(s.elapsedMs).toBe(10_000) // 已累計保留
    // 還差 workMs - 10s → 邊界在 50_000 + workMs - 10_000
    const { state } = pomodoroReducer(s, { type: 'TICK', now: 50_000 + PREFS.workMs - 10_000 })
    expect(state.phase).toBe('break')
  })

  it('STOP 任意狀態 → idle 歸零', () => {
    let s = startedState(1000)
    s = pomodoroReducer(s, { type: 'PAUSE', now: 2000 }).state
    const { state } = pomodoroReducer(s, { type: 'STOP' })
    expect(state.phase).toBe('idle')
    expect(state.elapsedMs).toBe(0)
    expect(state.paused).toBe(false)
    expect(state.phaseDurationMs).toBe(0)
  })

  it('運行中 CONFIGURE：當前 phase 邊界不變（phaseDurationMs 已鎖定），下一 phase 用新值', () => {
    let s = startedState(0)
    s = pomodoroReducer(s, { type: 'CONFIGURE', prefs: { workMs: 60_000, breakMs: 1_000, afterBreak: 'loop' } }).state
    expect(s.phaseDurationMs).toBe(PREFS.workMs) // 當前 work 仍是舊值
    // 邊界仍在舊 workMs
    const r1 = pomodoroReducer(s, { type: 'TICK', now: PREFS.workMs })
    expect(r1.state.phase).toBe('break')
    expect(r1.state.phaseDurationMs).toBe(1_000) // 下一 phase 用新 breakMs
  })

  it('PAUSE/RESUME 在 idle 是 no-op；START 在非 idle 是 no-op', () => {
    const idle = initialPomodoroState(PREFS)
    expect(pomodoroReducer(idle, { type: 'PAUSE', now: 1 }).state).toBe(idle)
    expect(pomodoroReducer(idle, { type: 'RESUME', now: 1 }).state).toBe(idle)
    const s = startedState(1000)
    expect(pomodoroReducer(s, { type: 'START', now: 2000 }).state).toBe(s)
  })

  it('STOP 保留 workMs/breakMs/afterBreak 設定（重 START 沿用）', () => {
    let s = startedState(0)
    s = pomodoroReducer(s, { type: 'CONFIGURE', prefs: { workMs: 60_000, breakMs: 1_000, afterBreak: 'pause' } }).state
    s = pomodoroReducer(s, { type: 'STOP' }).state
    expect(s.workMs).toBe(60_000)
    expect(s.breakMs).toBe(1_000)
    expect(s.afterBreak).toBe('pause')
    const restarted = pomodoroReducer(s, { type: 'START', now: 5000 }).state
    expect(restarted.phaseDurationMs).toBe(60_000)
  })

  it('CONFIGURE 相同值回同參照（no-op fast path）', () => {
    const s = startedState(0)
    const r = pomodoroReducer(s, { type: 'CONFIGURE', prefs: { workMs: s.workMs, breakMs: s.breakMs, afterBreak: s.afterBreak } })
    expect(r.state).toBe(s)
  })
})
