/// <reference path="../preload/api.d.ts" />
import type { DiscoveredSkin } from '../core/skin-scan'

const myChannel = new URLSearchParams(location.search).get('c') ?? 'all'
const DISPLAY_SCALE = 0.5 // 縮圖比例（sheet frame 192×208 → 96×104）
const FRAME_W = 192
const FRAME_H = 208
const SHEET_W = 1536
const SHEET_H = 1872

const listEl = document.querySelector<HTMLDivElement>('#list')!
const countEl = document.querySelector<HTMLSpanElement>('#count')!
const hintEl = document.querySelector<HTMLDivElement>('#hint')!

function thumbStyle(id: string): string {
  // 用 idle 第一格（左上 192×208）當縮圖
  return [
    `width:${FRAME_W * DISPLAY_SCALE}px`,
    `height:${FRAME_H * DISPLAY_SCALE}px`,
    `background-image:url(pet://${id}/sheet)`,
    `background-size:${SHEET_W * DISPLAY_SCALE}px ${SHEET_H * DISPLAY_SCALE}px`,
    'background-position:0 0',
    'background-repeat:no-repeat',
    'image-rendering:pixelated',
  ].join(';')
}

function buildCard(skin: DiscoveredSkin, effectiveId: string): HTMLDivElement {
  const card = document.createElement('div')
  card.className = 'card' + (skin.valid ? '' : ' invalid') + (skin.id === effectiveId ? ' current' : '')

  const thumb = document.createElement('div')
  thumb.className = 'thumb'
  if (skin.valid) thumb.setAttribute('style', thumbStyle(skin.id))
  else thumb.textContent = '⚠️'
  card.appendChild(thumb)

  const main = document.createElement('div')
  main.className = 'main'
  const name = document.createElement('div')
  name.className = 'name'
  name.textContent = skin.displayName
  if (skin.id === effectiveId) {
    const tag = document.createElement('span')
    tag.className = 'using'
    tag.textContent = ' · 使用中'
    name.appendChild(tag)
  }
  main.appendChild(name)

  const desc = document.createElement('div')
  desc.className = skin.valid ? 'desc' : 'desc err'
  desc.textContent = skin.valid ? skin.description : (skin.error ?? '無效')
  main.appendChild(desc)

  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.textContent = `id: ${skin.id} · ${skin.source === 'builtin' ? '內建' : '來自 pets/'}${skin.valid ? '' : ' · 不可用'}`
  main.appendChild(meta)
  card.appendChild(main)

  if (skin.valid && skin.id !== effectiveId) {
    const btn = document.createElement('button')
    btn.className = 'select'
    btn.textContent = '選擇'
    btn.addEventListener('click', async () => {
      const res = await window.petBridge.selectSkin(myChannel, skin.id)
      if (res.ok) render()
    })
    card.appendChild(btn)
  }
  return card
}

async function render(): Promise<void> {
  const { skins, requestedId, effectiveId } = await window.petBridge.getSkins(myChannel)
  const validCount = skins.filter((s) => s.valid).length
  countEl.textContent = `· ${skins.length} 個（${validCount} 可用）`
  if (requestedId !== effectiveId) {
    hintEl.hidden = false
    hintEl.textContent = `上次造型「${requestedId}」已失效，目前顯示「${effectiveId}」`
  } else {
    hintEl.hidden = true
  }
  listEl.replaceChildren(...skins.map((s) => buildCard(s, effectiveId)))
}

document.querySelector('#refresh')!.addEventListener('click', () => render())
document.querySelector('#open-folder')!.addEventListener('click', () => window.petBridge.openPetsFolder())
document.querySelector('#close')!.addEventListener('click', () => window.close())

// 造型規格說明 popup
const specModal = document.querySelector<HTMLDivElement>('#spec-modal')!
document.querySelector('#spec-link')!.addEventListener('click', () => (specModal.hidden = false))
document.querySelector('#spec-close')!.addEventListener('click', () => (specModal.hidden = true))
specModal.addEventListener('click', (e) => {
  if (e.target === specModal) specModal.hidden = true // 點背景關閉
})

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (!specModal.hidden) specModal.hidden = true // modal 開著 → Esc 先關 modal
  else window.close()
})

render()
