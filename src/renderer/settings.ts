/// <reference path="../preload/api.d.ts" />
import { DEFAULT_WALK_BOUNDS, type WalkBounds } from '../core/walk-planner'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const tMin = $<HTMLInputElement>('tMin')
const tMax = $<HTMLInputElement>('tMax')
const hint = $<HTMLDivElement>('hint')

function applyBounds(b: WalkBounds): void {
  tMin.value = (b.durationMinMs / 1000).toFixed(1)
  tMax.value = (b.durationMaxMs / 1000).toFixed(1)
}

function readForm(): WalkBounds {
  return {
    durationMinMs: Math.round(Math.max(0, Number(tMin.value) || 0) * 1000),
    durationMaxMs: Math.round(Math.max(0, Number(tMax.value) || 0) * 1000),
  }
}

window.petBridge.getPrefs().then((p) => applyBounds(p.walk))

$('save').addEventListener('click', () => {
  window.petBridge.setWalkBounds(readForm())
  hint.textContent = '已儲存。'
  hint.className = 'hint ok'
  setTimeout(() => {
    hint.textContent = ''
    hint.className = 'hint'
  }, 1600)
})

$('reset').addEventListener('click', () => {
  applyBounds(DEFAULT_WALK_BOUNDS)
  hint.textContent = '已恢復預設（尚未儲存）。'
  hint.className = 'hint'
})

$('close').addEventListener('click', () => window.close())
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close()
})
