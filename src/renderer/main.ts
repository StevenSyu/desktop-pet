/// <reference path="../preload/api.d.ts" />

import { SPRITE_FORMAT, frameRect, type AnimationName } from '../core/sprite-format'
import { PetController } from '../core/pet-fsm'
import { DEFAULT_SKIN_ID } from '../core/skins'
import type { AppEvent, NotifyType } from '../core/events'
import maySheet from '../../resources/pets/may/spritesheet.webp'
import marukoSheet from '../../resources/pets/maruko/spritesheet.webp'
import penguinSheet from '../../resources/pets/oil-king-penguin/spritesheet.webp'

const SHEET_URL: Record<string, string> = {
  'may': maySheet,
  'maruko': marukoSheet,
  'oil-king-penguin': penguinSheet,
}

const DISPLAY_SCALE = 0.7
const ICON: Record<NotifyType, string> = {
  done: '✅', attention: '❓', error: '⚠️', review: '🔍', working: '⏳', info: 'ℹ️',
}

const petEl = document.querySelector<HTMLDivElement>('#pet')!
const cardsEl = document.querySelector<HTMLDivElement>('#cards')!
petEl.style.width = `${SPRITE_FORMAT.frameWidth * DISPLAY_SCALE}px`
petEl.style.height = `${SPRITE_FORMAT.frameHeight * DISPLAY_SCALE}px`
petEl.style.backgroundSize = `${SPRITE_FORMAT.sheetWidth * DISPLAY_SCALE}px ${SPRITE_FORMAT.sheetHeight * DISPLAY_SCALE}px`

function setSkin(id: string): void {
  petEl.style.backgroundImage = `url(${SHEET_URL[id] ?? SHEET_URL[DEFAULT_SKIN_ID]})`
}
setSkin(DEFAULT_SKIN_ID)

// 右鍵選單選擇造型 → 切換背景圖（所有造型共用同精靈格式，只換圖）
window.petBridge?.onSetSkin?.((id) => setSkin(id))

const pet = new PetController()

// 目前顯示的訊息：持久顯示、不自動消失。新訊息會替換，使用者點一下卡片才關閉。
let currentEvent: AppEvent | null = null

// optional-chaining 防護：即使 preload 載入失敗，idle 動畫迴圈仍會啟動
window.petBridge?.onPetEvent?.((event: AppEvent) => {
  pet.onEvent(event, performance.now())
  currentEvent = event
  renderCard()
})

function renderCard(): void {
  if (!currentEvent) {
    cardsEl.replaceChildren()
    return
  }
  const e = currentEvent
  // 用 textContent 安全建構，title/body 來自 POST，屬不可信內容。
  const card = document.createElement('div')
  card.className = 'card'
  card.title = '點一下關閉'
  card.addEventListener('click', () => {
    currentEvent = null
    renderCard()
  })

  const title = document.createElement('div')
  title.className = 'card-title'
  title.textContent = `${ICON[e.type]} ${e.title || e.source.name || e.source.kind}`
  card.appendChild(title)

  if (e.body) {
    const body = document.createElement('div')
    body.className = 'card-body'
    body.textContent = e.body
    card.appendChild(body)
  }
  cardsEl.replaceChildren(card)
}

function render(now: number): void {
  const view = pet.advance(now)
  const anim = SPRITE_FORMAT.animations[view.animation as AnimationName]
  // 所有動畫（含反應）持續循環輪播；反應由 FSM 維持約 3 秒後回 idle
  const frameIndex = Math.floor((now / 1000) * anim.fps) % anim.frames
  const rect = frameRect(anim.row, frameIndex)
  petEl.style.backgroundPosition = `-${rect.x * DISPLAY_SCALE}px -${rect.y * DISPLAY_SCALE}px`
  requestAnimationFrame(render)
}
requestAnimationFrame(render)

function bindHover(): void {
  const enableInteractive = () => window.petBridge.setInteractive(true)
  const disableInteractive = () => window.petBridge.setInteractive(false)

  petEl.addEventListener('mouseenter', enableInteractive)
  petEl.addEventListener('mouseleave', disableInteractive)
  cardsEl.addEventListener('mouseenter', enableInteractive)
  cardsEl.addEventListener('mouseleave', disableInteractive)
}

bindHover()

// 右鍵叫出原生選單（結束 may／未來通知中心）
document.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  window.petBridge?.showContextMenu?.()
})
