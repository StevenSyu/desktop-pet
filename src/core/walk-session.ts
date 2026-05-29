// ============================================================================
// WalkSession — idle 自走的「一次走動」狀態機（確定性、可測）
// ============================================================================
//
// 原本走動的方向決定（含撞牆翻向）、逐幀位置推進、完成判定全埋在 window.ts 的
// setTimeout 閉包裡，要測得 mock 整個 BrowserWindow。這裡把它抽成不依賴 Electron、
// 不自持時鐘的狀態機：
//
//   start(input, now)  決定方向（撞牆則試對向）並開始；回 { ok, flippedTo? }
//   step(now)          回該時刻的水平位置與是否完成；未啟動回 null
//   cancel()           結束本次走動
//
// 時間由呼叫端注入（now 參數），不在內部呼 Date.now / setTimeout——因此 start→
// step→step→done、cancel、撞牆翻向、兩向都堵死等情境都能用受控時間單元測試。
// window.ts 只負責：setTimeout(16ms) 迴圈呼 step(Date.now())、把回傳 x 餵給
// win.setPosition、依 start/step 結果 pushTo walk-direction / walk-ended。

import { clampWalkToWorkArea, type WorkArea, type WalkDirection } from './walk-planner'

export interface WalkStartInput {
  startX: number
  requestedDirection: WalkDirection
  distance: number
  duration: number
  workArea: WorkArea
  petWidth: number
}

export interface WalkStartResult {
  /** 是否成功開始（兩個方向都沒空間時為 false，呼叫端應直接結束）。 */
  ok: boolean
  /** 若因撞牆改走對向，這裡是新的方向（呼叫端應 push walk-direction）。 */
  flippedTo?: WalkDirection
}

export interface WalkStep {
  /** 該時刻的水平位置（呼叫端 setPosition(x, startY)）。 */
  x: number
  /** 是否已抵達終點（呼叫端應結束並 push walk-ended）。 */
  done: boolean
}

interface ActiveWalk {
  startX: number
  sign: number // +1 右、-1 左
  available: number // 實際可走距離（已夾邊界）
  startedAt: number
  duration: number
}

export class WalkSession {
  private walk: ActiveWalk | null = null

  get active(): boolean {
    return this.walk !== null
  }

  /**
   * 決定方向（撞牆則試對向）並開始一次走動。
   * 兩個方向都沒空間 → 回 { ok: false } 且不啟動。
   */
  start(input: WalkStartInput, now: number): WalkStartResult {
    const { startX, distance, workArea, petWidth } = input
    let direction = input.requestedDirection
    let available = clampWalkToWorkArea(startX, direction, distance, workArea, petWidth)
    let flippedTo: WalkDirection | undefined

    if (available <= 0) {
      const flipped: WalkDirection = direction === 'right' ? 'left' : 'right'
      const alt = clampWalkToWorkArea(startX, flipped, distance, workArea, petWidth)
      if (alt > 0) {
        direction = flipped
        available = alt
        flippedTo = flipped
      } else {
        this.walk = null
        return { ok: false }
      }
    }

    this.walk = {
      startX,
      sign: direction === 'right' ? 1 : -1,
      available,
      startedAt: now,
      duration: input.duration,
    }
    return { ok: true, flippedTo }
  }

  /** 回該時刻的位置與完成狀態；未啟動回 null。done=true 時呼叫端應結束。 */
  step(now: number): WalkStep | null {
    const w = this.walk
    if (!w) return null
    const elapsed = now - w.startedAt
    const t = w.duration <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / w.duration))
    const x = Math.round(w.startX + w.sign * w.available * t)
    return { x, done: t >= 1 }
  }

  cancel(): void {
    this.walk = null
  }
}
