/// <reference path="../preload/api.d.ts" />
import { DEFAULT_WALK_BOUNDS, type WalkBounds } from '../core/walk-planner'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const iMin = $<HTMLInputElement>('iMin')
const iMax = $<HTMLInputElement>('iMax')
const dMin = $<HTMLInputElement>('dMin')
const dMax = $<HTMLInputElement>('dMax')
const tMin = $<HTMLInputElement>('tMin')
const tMax = $<HTMLInputElement>('tMax')
const hint = $<HTMLDivElement>('hint')

function applyBounds(b: WalkBounds): void {
  iMin.value = String(Math.round(b.intervalMinMs / 1000))
  iMax.value = String(Math.round(b.intervalMaxMs / 1000))
  dMin.value = String(b.distanceMinPx)
  dMax.value = String(b.distanceMaxPx)
  tMin.value = (b.durationMinMs / 1000).toFixed(1)
  tMax.value = (b.durationMaxMs / 1000).toFixed(1)
}

function readForm(): WalkBounds {
  return {
    intervalMinMs: Math.max(0, Number(iMin.value) || 0) * 1000,
    intervalMaxMs: Math.max(0, Number(iMax.value) || 0) * 1000,
    distanceMinPx: Math.max(0, Number(dMin.value) || 0),
    distanceMaxPx: Math.max(0, Number(dMax.value) || 0),
    durationMinMs: Math.round(Math.max(0, Number(tMin.value) || 0) * 1000),
    durationMaxMs: Math.round(Math.max(0, Number(tMax.value) || 0) * 1000),
  }
}

window.petBridge.getPrefs().then((p) => applyBounds(p.walk))

$('save').addEventListener('click', () => {
  const b = readForm()
  window.petBridge.setWalkBounds(b)
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
