// 蕃茄鐘 hover 控制列 widget：倒數顯示規則、雙語意 ▶（idle=START、paused=RESUME）、
// 顯示條件（全域 enabled × 「全部」showOnAll／自訂 channel pomodoroEnabled）全在此。
// bridge 以窄面注入（與 main 的 card-manager deps 紀律一致）；DOM 元素自查（ids 為實作細節）。

import type { PomodoroSnapshot } from '../core/pomodoro-timer'

/** petBridge 中本 widget 需要的窄面（測試以 fake 滿足）。 */
export interface PomodoroBarBridge {
  getPomodoro: () => Promise<PomodoroSnapshot>
  onPomodoroChanged: (cb: (s: PomodoroSnapshot) => void) => void
  getPrefs: () => Promise<{ pomodoro: { enabled: boolean; showOnAll: boolean }; allEnabled: boolean }>
  onPrefsChanged: (cb: (p: { pomodoro: { enabled: boolean; showOnAll: boolean }; allEnabled: boolean }) => void) => void
  getChannels: () => Promise<{ id: string; enabled: boolean; pomodoroEnabled: boolean }[]>
  onChannelsUpdated: (cb: (chs: { id: string; enabled: boolean; pomodoroEnabled: boolean }[]) => void) => void
  pomodoroStart: () => void
  pomodoroPause: () => void
  pomodoroResume: () => void
  pomodoroStop: () => void
}

export interface PomodoroBar {
  /** hover 進出（bindHover 通知）：bar 只在 hover 中顯示。 */
  setHovering: (hovering: boolean) => void
}

export function initPomodoroBar(bridge: PomodoroBarBridge, channelId: string): PomodoroBar {
  const barEl = document.querySelector<HTMLDivElement>('#pomodoro-bar')!
  const timeEl = document.querySelector<HTMLSpanElement>('#pomo-time')!
  const toggleEl = document.querySelector<HTMLButtonElement>('#pomo-toggle')!
  const stopEl = document.querySelector<HTMLButtonElement>('#pomo-stop')!

  let snap: PomodoroSnapshot = { phase: 'idle', paused: false, startedAt: 0, durationMs: 0, elapsedMs: 0 }
  let enabledGlobal = false // prefs.pomodoro.enabled
  let showOnAll = true // prefs.pomodoro.showOnAll && allEnabled（「全部」pet 用）
  let channelOn = false // 此 channel 的 pomodoroEnabled（自訂 channel 用）
  let hovering = false
  let tickTimer: ReturnType<typeof setInterval> | null = null

  function visible(): boolean {
    if (!enabledGlobal) return false
    return channelId === 'all' ? showOnAll : channelOn
  }

  function remainingMs(): number {
    if (snap.phase === 'idle') return 0
    const run = snap.paused ? 0 : Date.now() - snap.startedAt
    return Math.max(0, snap.durationMs - snap.elapsedMs - run)
  }

  function fmtMmSs(ms: number): string {
    const s = Math.ceil(ms / 1000)
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }

  function render(): void {
    barEl.hidden = !(visible() && hovering)
    if (barEl.hidden) return
    barEl.dataset.phase = snap.phase
    barEl.dataset.paused = String(snap.paused)
    if (snap.phase === 'idle') {
      timeEl.textContent = '--:--'
      toggleEl.textContent = '▶'
      toggleEl.title = '開始'
      stopEl.disabled = true
    } else {
      timeEl.textContent = fmtMmSs(remainingMs())
      toggleEl.textContent = snap.paused ? '▶' : '⏸'
      toggleEl.title = snap.paused ? '繼續' : '暫停'
      stopEl.disabled = false
    }
  }

  function syncTicker(): void {
    const need = visible() && hovering && snap.phase !== 'idle' && !snap.paused
    if (need && !tickTimer) tickTimer = setInterval(render, 1000)
    if (!need && tickTimer) {
      clearInterval(tickTimer)
      tickTimer = null
    }
  }

  function update(): void {
    syncTicker()
    render()
  }

  // ===== 資料來源：snapshot push＋初查、prefs、channels =====
  void bridge.getPomodoro().then((s) => {
    snap = s
    update()
  })
  bridge.onPomodoroChanged((s) => {
    snap = s
    update()
  })

  const applyPrefs = (p: { pomodoro: { enabled: boolean; showOnAll: boolean }; allEnabled: boolean }): void => {
    enabledGlobal = p.pomodoro.enabled
    showOnAll = p.pomodoro.showOnAll && p.allEnabled // 對齊 driver targets()
    update()
  }
  void bridge.getPrefs().then(applyPrefs)
  bridge.onPrefsChanged(applyPrefs)

  const applyChannels = (chs: { id: string; enabled: boolean; pomodoroEnabled: boolean }[]): void => {
    channelOn = chs.some((c) => c.id === channelId && c.enabled && c.pomodoroEnabled)
    update()
  }
  void bridge.getChannels().then(applyChannels)
  bridge.onChannelsUpdated(applyChannels)

  // ===== 互動：pointerdown 不冒泡（防 pet 拖曳啟動）；▶ 雙語意；■ 停止 =====
  barEl.addEventListener('pointerdown', (e) => e.stopPropagation())
  toggleEl.addEventListener('click', (e) => {
    e.stopPropagation()
    if (snap.phase === 'idle') bridge.pomodoroStart()
    else if (snap.paused) bridge.pomodoroResume()
    else bridge.pomodoroPause()
  })
  stopEl.addEventListener('click', (e) => {
    e.stopPropagation()
    bridge.pomodoroStop()
  })

  return {
    setHovering: (h) => {
      hovering = h
      update()
    },
  }
}
