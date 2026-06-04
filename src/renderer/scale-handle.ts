// 寵物縮放 widget：scale 狀態單一持有處——main push（onSetScale）與右下把手拖曳
// 兩個來源都收斂到這裡，再以 transform 套到 shell。換算/clamp 在 core/pet-scale。

import { clampScale, scaleFromDrag } from '../core/pet-scale'

/** petBridge 中本 widget 需要的窄面。 */
export interface ScaleHandleBridge {
  onSetScale: (cb: (s: number) => void) => void
  setScale: (channelId: string, scale: number) => void
  setInteractive: (channelId: string, interactive: boolean) => void
}

export interface ScaleHandleOpts {
  shellEl: HTMLElement
  handleEl: HTMLElement
  channelId: string
  baseW: number
  baseH: number
}

export interface ScaleHandle {
  /** 拖曳縮放進行中（bindHover 的 mouseleave 以此決定是否收把手）。 */
  isResizing: () => boolean
}

export function initScaleHandle(bridge: ScaleHandleBridge, opts: ScaleHandleOpts): ScaleHandle {
  const { shellEl, handleEl, channelId, baseW, baseH } = opts
  let scale = 1
  let resizing = false

  function apply(): void {
    shellEl.style.transform = `scale(${scale})`
  }

  // main 推（prefs 載入 / 其他來源變更）→ 套用
  bridge.onSetScale((s) => {
    scale = clampScale(s)
    apply()
  })

  // 右下把手拖曳：rAF 合併 setScale IPC，放開時送最終值
  handleEl.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    resizing = true
    handleEl.setPointerCapture(e.pointerId)
    bridge.setInteractive(channelId, true)
    const startScale = scale
    const startX = e.screenX
    const startY = e.screenY
    let raf = 0
    const onMove = (ev: PointerEvent): void => {
      scale = scaleFromDrag(startScale, ev.screenX - startX, ev.screenY - startY, baseW, baseH)
      apply()
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0
          bridge.setScale(channelId, scale)
        })
      }
    }
    const onUp = (): void => {
      handleEl.releasePointerCapture(e.pointerId)
      handleEl.removeEventListener('pointermove', onMove)
      handleEl.removeEventListener('pointerup', onUp)
      resizing = false
      bridge.setScale(channelId, scale)
      if (!shellEl.matches(':hover')) {
        handleEl.hidden = true
        bridge.setInteractive(channelId, false)
      }
    }
    handleEl.addEventListener('pointermove', onMove)
    handleEl.addEventListener('pointerup', onUp)
  })

  return { isResizing: () => resizing }
}
