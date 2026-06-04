/// <reference path="../preload/api.d.ts" />
import { DEFAULT_WALK_BOUNDS, type WalkBounds } from '../core/walk-planner'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const iMin = $<HTMLInputElement>('iMin')
const iMax = $<HTMLInputElement>('iMax')
const tMin = $<HTMLInputElement>('tMin')
const tMax = $<HTMLInputElement>('tMax')
const hint = $<HTMLDivElement>('hint')
const pomoEnabled = $<HTMLInputElement>('pomoEnabled')
const pomoShowOnAll = $<HTMLInputElement>('pomoShowOnAll')
const pomoWork = $<HTMLInputElement>('pomoWork')
const pomoBreak = $<HTMLInputElement>('pomoBreak')
const pomoAfterBreak = $<HTMLSelectElement>('pomoAfterBreak')

type PomoPrefs = { enabled: boolean; workMs: number; breakMs: number; afterBreak: 'loop' | 'pause'; showOnAll: boolean }

const DEFAULT_POMO: PomoPrefs = { enabled: false, workMs: 25 * 60_000, breakMs: 5 * 60_000, afterBreak: 'loop', showOnAll: true }

function applyPomodoro(p: PomoPrefs): void {
  pomoEnabled.checked = p.enabled
  pomoShowOnAll.checked = p.showOnAll
  pomoWork.value = String(Math.round(p.workMs / 60_000))
  pomoBreak.value = String(Math.round(p.breakMs / 60_000))
  pomoAfterBreak.value = p.afterBreak
  syncPomoDisabled()
}

function readPomodoro(): PomoPrefs {
  const clampMin = (v: string): number => Math.min(180, Math.max(1, Math.round(Number(v) || 0)))
  return {
    enabled: pomoEnabled.checked,
    showOnAll: pomoShowOnAll.checked,
    workMs: clampMin(pomoWork.value) * 60_000,
    breakMs: clampMin(pomoBreak.value) * 60_000,
    afterBreak: pomoAfterBreak.value === 'pause' ? 'pause' : 'loop',
  }
}

function syncPomoDisabled(): void {
  const off = !pomoEnabled.checked
  for (const el of [pomoShowOnAll, pomoWork, pomoBreak, pomoAfterBreak]) el.disabled = off
}
pomoEnabled.addEventListener('change', syncPomoDisabled)

function applyBounds(b: WalkBounds): void {
  iMin.value = String(Math.round(b.intervalMinMs / 1000))
  iMax.value = String(Math.round(b.intervalMaxMs / 1000))
  tMin.value = (b.durationMinMs / 1000).toFixed(1)
  tMax.value = (b.durationMaxMs / 1000).toFixed(1)
}

function readForm(): WalkBounds {
  return {
    intervalMinMs: Math.max(0, Number(iMin.value) || 0) * 1000,
    intervalMaxMs: Math.max(0, Number(iMax.value) || 0) * 1000,
    durationMinMs: Math.round(Math.max(0, Number(tMin.value) || 0) * 1000),
    durationMaxMs: Math.round(Math.max(0, Number(tMax.value) || 0) * 1000),
  }
}

window.petBridge.getPrefs().then((p) => {
  applyBounds(p.walk)
  applyPomodoro(p.pomodoro)
})

$('save').addEventListener('click', () => {
  window.petBridge.setWalkBounds(readForm())
  window.petBridge.setPomodoroPrefs(readPomodoro())
  window.close()
})

$('reset').addEventListener('click', () => {
  applyBounds(DEFAULT_WALK_BOUNDS)
  applyPomodoro(DEFAULT_POMO)
  hint.textContent = '已恢復預設（尚未儲存）。'
  hint.className = 'hint'
})

$('close').addEventListener('click', () => window.close())
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close()
})
