import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ===== mocks：walk-driver 的 main 端依賴（與 pomodoro-driver.test 同模式）=====
const ipcMain = { on: vi.fn(), handle: vi.fn() }
vi.mock('electron', () => ({
  get ipcMain() {
    return ipcMain
  },
}))

import { initWalkDriver, type WalkWindow } from '../../src/main/walk-driver'

const WORK_AREA = { x: 0, y: 0, width: 1000, height: 800 }

interface FakeWin extends WalkWindow {
  positions: Array<[number, number]>
}

function fakeWin(x: number, y = 100, width = 135): FakeWin {
  const positions: Array<[number, number]> = []
  return {
    positions,
    getBounds: () => ({ x, y, width, height: 146 }),
    setPosition: (px, py) => positions.push([px, py]),
  }
}

function commandHandler(channel: string): (payload?: unknown) => void {
  const entry = ipcMain.on.mock.calls.findLast((c) => c[0] === channel)
  if (!entry) throw new Error(`no handler for ${channel}`)
  const h = entry[1] as (e: unknown, payload?: unknown) => void
  return (payload?: unknown) => h({}, payload)
}

function setup(wins: Record<string, FakeWin | undefined>) {
  const notifyEnded = vi.fn()
  const notifyDirection = vi.fn()
  const driver = initWalkDriver({
    getWindow: (id) => wins[id],
    workAreaFor: () => WORK_AREA,
    notifyEnded,
    notifyDirection,
  })
  return { driver, notifyEnded, notifyDirection, wins }
}

const startReq = (channelId: string, over: Record<string, unknown> = {}) => ({
  channelId,
  direction: 'right',
  distance: 100,
  duration: 1000,
  ...over,
})

beforeEach(() => {
  vi.useFakeTimers()
  ipcMain.on.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('walk-driver', () => {
  it('walk-start → 逐幀 setPosition，走完 → notifyEnded', () => {
    const win = fakeWin(200)
    const { notifyEnded } = setup({ 'ch-1': win })
    commandHandler('walk-start')(startReq('ch-1'))
    vi.advanceTimersByTime(1100)
    expect(win.positions.length).toBeGreaterThan(1)
    expect(win.positions.at(-1)![0]).toBe(300) // startX 200 + distance 100
    expect(notifyEnded).toHaveBeenCalledWith('ch-1')
  })

  it('外部 endWalk(notify=true)（拖動中斷）→ 停止推進並 notifyEnded', () => {
    const win = fakeWin(200)
    const { driver, notifyEnded } = setup({ 'ch-1': win })
    commandHandler('walk-start')(startReq('ch-1'))
    vi.advanceTimersByTime(160)
    const frames = win.positions.length
    driver.endWalk('ch-1', true)
    expect(notifyEnded).toHaveBeenCalledWith('ch-1')
    vi.advanceTimersByTime(500)
    expect(win.positions.length).toBe(frames) // timer 已清，不再推進
  })

  it('視窗消失 mid-walk → 靜默清掉（不 notifyEnded）', () => {
    const win = fakeWin(200)
    const wins: Record<string, FakeWin | undefined> = { 'ch-1': win }
    const { notifyEnded } = setup(wins)
    commandHandler('walk-start')(startReq('ch-1'))
    vi.advanceTimersByTime(160)
    wins['ch-1'] = undefined // 寵物窗被關
    vi.advanceTimersByTime(1000)
    expect(notifyEnded).not.toHaveBeenCalled()
  })

  it('兩向都沒空間 → 不啟動、立即 notifyEnded', () => {
    // 寵物寬到塞滿工作區 → 左右都走不了
    const win = fakeWin(0, 100, 1000)
    const { notifyEnded } = setup({ 'ch-1': win })
    commandHandler('walk-start')(startReq('ch-1'))
    expect(notifyEnded).toHaveBeenCalledWith('ch-1')
    vi.advanceTimersByTime(500)
    expect(win.positions.length).toBeLessThanOrEqual(1) // 起手 step 後不再推進
  })

  it('撞牆翻向 → notifyDirection(flippedTo)', () => {
    // 貼右緣要求向右 → 翻左
    const win = fakeWin(1000 - 135)
    const { notifyDirection } = setup({ 'ch-1': win })
    commandHandler('walk-start')(startReq('ch-1', { direction: 'right' }))
    expect(notifyDirection).toHaveBeenCalledWith('ch-1', 'left')
  })

  it('walk-cancel command → notifyEnded', () => {
    const win = fakeWin(200)
    const { notifyEnded } = setup({ 'ch-1': win })
    commandHandler('walk-start')(startReq('ch-1'))
    commandHandler('walk-cancel')({ channelId: 'ch-1' })
    expect(notifyEnded).toHaveBeenCalledWith('ch-1')
  })

  it('endAllWalks → 全部走動結束', () => {
    const a = fakeWin(200)
    const b = fakeWin(400)
    const { driver, notifyEnded } = setup({ a, b })
    commandHandler('walk-start')(startReq('a'))
    commandHandler('walk-start')(startReq('b'))
    driver.endAllWalks(true)
    expect(notifyEnded).toHaveBeenCalledWith('a')
    expect(notifyEnded).toHaveBeenCalledWith('b')
  })

  it('沒在走時 endWalk → no-op（不誤發 notifyEnded）', () => {
    const { driver, notifyEnded } = setup({})
    driver.endWalk('ch-1', true)
    expect(notifyEnded).not.toHaveBeenCalled()
  })
})
