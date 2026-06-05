// 走動 main 端 driver：驅動 core 的 WalkSession（16ms step loop）、持有 per-pet 走動狀態、
// 自註冊 walk domain 的 IPC handler（walk-start／walk-cancel）。
// 取消語意（與 CONTEXT.md Walk Engine 一致）：結束一律經 endWalk——
//   拖動中斷／走完／cancel → notify（renderer 等 walkEnded 才轉 false）
//   視窗消失 → 靜默清掉（沒有人可通知）
// Electron 能力以 deps 注入（與 card-manager 同模式）：interface 即測試面。

import { WalkSession } from '../core/walk-session'
import type { WorkArea, WalkDirection } from '../core/walk-planner'
import { handleCommand } from '../ipc/main-helpers'

/** driver 需要的視窗能力子集（測試用 fake 物件即可滿足）。 */
export interface WalkWindow {
  getBounds: () => { x: number; y: number; width: number; height: number }
  setPosition: (x: number, y: number) => void
}

export interface WalkDriverDeps {
  /** 取目前有效的寵物視窗；不存在（已關）→ undefined。 */
  getWindow: (channelId: string) => WalkWindow | undefined
  /** 該點所在顯示器的工作區（邊界 clamp 用）。 */
  workAreaFor: (point: { x: number; y: number }) => WorkArea
  /** 推 walk-ended 給該寵物。 */
  notifyEnded: (channelId: string) => void
  /** 撞牆翻向時推 walk-direction 給該寵物。 */
  notifyDirection: (channelId: string, direction: WalkDirection) => void
}

export interface WalkDriver {
  endWalk: (channelId: string, notify: boolean) => void
  endAllWalks: (notify: boolean) => void
}

export function initWalkDriver(deps: WalkDriverDeps): WalkDriver {
  const walks = new Map<string, { session: WalkSession; timer: NodeJS.Timeout | null }>()

  function endWalk(channelId: string, notify: boolean): void {
    const walk = walks.get(channelId)
    if (!walk) return
    if (walk.timer) clearTimeout(walk.timer)
    walk.session.cancel()
    walks.delete(channelId)
    if (notify) deps.notifyEnded(channelId)
  }

  function endAllWalks(notify: boolean): void {
    for (const id of [...walks.keys()]) endWalk(id, notify)
  }

  handleCommand('walk-start', (req) => {
    const { channelId } = req
    const win = deps.getWindow(channelId)
    if (!win) return
    endWalk(channelId, false)
    const { x: startX, y: startY, width: winWidth } = win.getBounds()
    const walk = { session: new WalkSession(), timer: null as NodeJS.Timeout | null }
    const res = walk.session.start(
      // petWidth 用實際視窗寬（含 scale），固定 PET_WIDTH 會讓放大的寵物走出螢幕右緣被切
      { startX, requestedDirection: req.direction, distance: req.distance, duration: req.duration, workArea: deps.workAreaFor({ x: startX, y: startY }), petWidth: winWidth },
      Date.now(),
    )
    if (!res.ok) {
      deps.notifyEnded(channelId)
      return
    }
    walks.set(channelId, walk)
    if (res.flippedTo) deps.notifyDirection(channelId, res.flippedTo)
    const step = (): void => {
      const w = deps.getWindow(channelId)
      if (!w) {
        endWalk(channelId, false)
        return
      }
      const frame = walk.session.step(Date.now())
      if (!frame) return
      w.setPosition(frame.x, startY)
      if (frame.done) {
        endWalk(channelId, true)
        return
      }
      walk.timer = setTimeout(step, 16)
    }
    step()
  })
  handleCommand('walk-cancel', ({ channelId }) => endWalk(channelId, true))

  return { endWalk, endAllWalks }
}
