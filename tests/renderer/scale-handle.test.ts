// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initScaleHandle, type ScaleHandleBridge } from '../../src/renderer/scale-handle'
import { clampScale, scaleFromDrag } from '../../src/core/pet-scale'

const BASE_W = 135
const BASE_H = 146

function setup(): {
  handle: ReturnType<typeof initScaleHandle>
  shellEl: HTMLElement
  handleEl: HTMLElement
  bridge: ScaleHandleBridge
  pushScale: (s: number) => void
  setScale: ReturnType<typeof vi.fn>
  setInteractive: ReturnType<typeof vi.fn>
} {
  document.body.innerHTML = '<div id="pet-shell"><div id="resize-handle"></div></div>'
  const shellEl = document.querySelector<HTMLElement>('#pet-shell')!
  const handleEl = document.querySelector<HTMLElement>('#resize-handle')!
  // jsdom 無 pointer capture 實作 → stub
  handleEl.setPointerCapture = vi.fn()
  handleEl.releasePointerCapture = vi.fn()
  let scaleCb: ((s: number) => void) | null = null
  const setScale = vi.fn()
  const setInteractive = vi.fn()
  const bridge: ScaleHandleBridge = {
    onSetScale: (cb) => {
      scaleCb = cb
    },
    setScale,
    setInteractive,
  }
  const handle = initScaleHandle(bridge, { shellEl, handleEl, channelId: 'all', baseW: BASE_W, baseH: BASE_H })
  return { handle, shellEl, handleEl, bridge, pushScale: (s) => scaleCb?.(s), setScale, setInteractive }
}

function pointer(el: HTMLElement, type: string, opts: { screenX?: number; screenY?: number } = {}): void {
  // jsdom 無 PointerEvent → 用 MouseEvent 構造再補 pointerId
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, screenX: opts.screenX ?? 0, screenY: opts.screenY ?? 0 })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  el.dispatchEvent(e)
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 1
  })
})

describe('scale-handle widget', () => {
  it('main push onSetScale → clamp 後套 transform', () => {
    const { shellEl, pushScale } = setup()
    pushScale(0.8)
    expect(shellEl.style.transform).toBe('scale(0.8)')
    pushScale(0.1) // 低於下限 → clamp
    expect(shellEl.style.transform).toBe(`scale(${clampScale(0.1)})`)
    pushScale(99) // 超上限 → clamp
    expect(shellEl.style.transform).toBe(`scale(${clampScale(99)})`)
  })

  it('拖曳：pointerdown 開 interactive + isResizing；move 套用換算 scale 並回報 IPC', () => {
    const { handle, shellEl, handleEl, setScale, setInteractive } = setup()
    pointer(handleEl, 'pointerdown', { screenX: 100, screenY: 100 })
    expect(handle.isResizing()).toBe(true)
    expect(setInteractive).toHaveBeenCalledWith('all', true)

    pointer(handleEl, 'pointermove', { screenX: 160, screenY: 160 }) // 對角 +60,+60
    const expected = scaleFromDrag(1, 60, 60, BASE_W, BASE_H)
    expect(shellEl.style.transform).toBe(`scale(${expected})`)
    expect(setScale).toHaveBeenCalledWith('all', expected) // rAF stub 同步執行

    pointer(handleEl, 'pointerup')
    expect(handle.isResizing()).toBe(false)
    expect(setScale).toHaveBeenLastCalledWith('all', expected) // 放開送最終值
  })

  it('放開時滑鼠不在 shell 上 → 收把手 + 關 interactive', () => {
    const { handleEl, setInteractive } = setup()
    // jsdom matches(':hover') 永遠 false → 走收尾分支
    pointer(handleEl, 'pointerdown', { screenX: 0, screenY: 0 })
    pointer(handleEl, 'pointerup')
    expect((handleEl as HTMLElement & { hidden: boolean }).hidden).toBe(true)
    expect(setInteractive).toHaveBeenLastCalledWith('all', false)
  })
})
