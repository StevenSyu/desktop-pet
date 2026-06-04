// 蕃茄鐘核心狀態機：純函式、now 由 caller 注入（與 walk-session/pet-fsm 同模式）。

export type PomodoroPhase = 'idle' | 'work' | 'break'

/** 持久化的蕃茄鐘偏好（存於 Prefs.pomodoro）。 */
export interface PomodoroPrefs {
  enabled: boolean
  workMs: number
  breakMs: number
  afterBreak: 'loop' | 'pause'
  showOnAll: boolean
}

export const DEFAULT_POMODORO_PREFS: PomodoroPrefs = {
  enabled: false,
  workMs: 25 * 60 * 1000,
  breakMs: 5 * 60 * 1000,
  afterBreak: 'loop',
  showOnAll: true,
}

export interface PomodoroState {
  phase: PomodoroPhase
  /** 當前計時段開始時間（paused/idle 時無意義）。 */
  startedAt: number
  /** 已完成計時段的累計；運行中的當前段另以 now - startedAt 計。 */
  elapsedMs: number
  paused: boolean
  /** phase 開始時鎖定的總長；運行中改設定不影響當前 phase。idle 為 0。 */
  phaseDurationMs: number
  workMs: number
  breakMs: number
  afterBreak: 'loop' | 'pause'
}

export type PomodoroAction =
  | { type: 'START'; now: number }
  | { type: 'PAUSE'; now: number }
  | { type: 'RESUME'; now: number }
  | { type: 'STOP' }
  | { type: 'TICK'; now: number }
  | { type: 'CONFIGURE'; prefs: Pick<PomodoroPrefs, 'workMs' | 'breakMs' | 'afterBreak'> }

export type PomodoroEffect = { type: 'notify-work-end' } | { type: 'notify-break-end' } | { type: 'none' }

/** 推給 renderer 的快照（pomodoro-changed push payload）。 */
export interface PomodoroSnapshot {
  phase: PomodoroPhase
  paused: boolean
  startedAt: number
  durationMs: number
  elapsedMs: number
}

const NONE: PomodoroEffect = { type: 'none' }

export function initialPomodoroState(prefs: PomodoroPrefs): PomodoroState {
  return {
    phase: 'idle',
    startedAt: 0,
    elapsedMs: 0,
    paused: false,
    phaseDurationMs: 0,
    workMs: prefs.workMs,
    breakMs: prefs.breakMs,
    afterBreak: prefs.afterBreak,
  }
}

export function toSnapshot(s: PomodoroState): PomodoroSnapshot {
  return { phase: s.phase, paused: s.paused, startedAt: s.startedAt, durationMs: s.phaseDurationMs, elapsedMs: s.elapsedMs }
}

export function pomodoroReducer(
  state: PomodoroState,
  action: PomodoroAction,
): { state: PomodoroState; effect: PomodoroEffect } {
  switch (action.type) {
    case 'START': {
      if (state.phase !== 'idle') return { state, effect: NONE }
      return {
        state: { ...state, phase: 'work', startedAt: action.now, elapsedMs: 0, paused: false, phaseDurationMs: state.workMs },
        effect: NONE,
      }
    }
    case 'PAUSE': {
      if (state.phase === 'idle' || state.paused) return { state, effect: NONE }
      return {
        state: { ...state, paused: true, elapsedMs: state.elapsedMs + (action.now - state.startedAt) },
        effect: NONE,
      }
    }
    case 'RESUME': {
      if (state.phase === 'idle' || !state.paused) return { state, effect: NONE }
      return { state: { ...state, paused: false, startedAt: action.now }, effect: NONE }
    }
    case 'STOP': {
      if (state.phase === 'idle') return { state, effect: NONE }
      return {
        state: { ...state, phase: 'idle', startedAt: 0, elapsedMs: 0, paused: false, phaseDurationMs: 0 },
        effect: NONE,
      }
    }
    case 'TICK': {
      if (state.phase === 'idle' || state.paused) return { state, effect: NONE }
      const total = state.elapsedMs + (action.now - state.startedAt)
      if (total < state.phaseDurationMs) return { state, effect: NONE }
      if (state.phase === 'work') {
        return {
          state: { ...state, phase: 'break', startedAt: action.now, elapsedMs: 0, phaseDurationMs: state.breakMs },
          effect: { type: 'notify-work-end' },
        }
      }
      // break 結束
      if (state.afterBreak === 'loop') {
        return {
          state: { ...state, phase: 'work', startedAt: action.now, elapsedMs: 0, phaseDurationMs: state.workMs },
          effect: { type: 'notify-break-end' },
        }
      }
      return {
        state: { ...state, phase: 'idle', startedAt: 0, elapsedMs: 0, phaseDurationMs: 0 },
        effect: { type: 'notify-break-end' },
      }
    }
    case 'CONFIGURE': {
      const { workMs, breakMs, afterBreak } = action.prefs
      if (workMs === state.workMs && breakMs === state.breakMs && afterBreak === state.afterBreak) {
        return { state, effect: NONE }
      }
      // 只改未來 phase 的參數；phaseDurationMs 不動（行為決策：下一 phase 生效）
      return { state: { ...state, workMs, breakMs, afterBreak }, effect: NONE }
    }
  }
}
