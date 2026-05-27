/// <reference path="../preload/api.d.ts" />

import { SPRITE_FORMAT, frameRect, type AnimationName } from '../core/sprite-format'
import { PetController } from '../core/pet-fsm'
import { NotificationQueue } from '../core/notification-queue'
import type { AppEvent, NotifyType } from '../core/events'
import sheetUrl from '../../resources/pets/may/spritesheet.webp'

const DISPLAY_SCALE = 0.7
const ICON: Record<NotifyType, string> = {
  done: '✅', attention: '❓', error: '⚠️', review: '🔍', working: '⏳', info: 'ℹ️',
}

const petEl = document.querySelector<HTMLDivElement>('#pet')!
const cardsEl = document.querySelector<HTMLDivElement>('#cards')!
petEl.style.width = `${SPRITE_FORMAT.frameWidth * DISPLAY_SCALE}px`
petEl.style.height = `${SPRITE_FORMAT.frameHeight * DISPLAY_SCALE}px`
petEl.style.backgroundImage = `url(${sheetUrl})`
petEl.style.backgroundSize = `${SPRITE_FORMAT.sheetWidth * DISPLAY_SCALE}px ${SPRITE_FORMAT.sheetHeight * DISPLAY_SCALE}px`

const pet = new PetController()
// 佇列時鐘與事件 timestamp 一致用 performance.now()，否則卡片會被誤判過期
const queue = new NotificationQueue({ now: () => performance.now() })

// optional-chaining 防護：即使 preload 載入失敗，idle 動畫迴圈仍會啟動
window.petBridge?.onPetEvent?.((event: AppEvent) => {
  pet.onEvent(event, performance.now())
  queue.push({ ...event, timestamp: performance.now() })
})

function renderCards(): void {
  const active = queue.active()
  cardsEl.replaceChildren(
    ...active.map((e) => {
      // 用 textContent 安全建構，title/body 來自 POST，屬不可信內容。
      const card = document.createElement('div')
      card.className = 'card'

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
      return card
    }),
  )
}

function render(now: number): void {
  const view = pet.advance(now)
  const anim = SPRITE_FORMAT.animations[view.animation as AnimationName]
  // 所有動畫（含反應）持續循環輪播；反應由 FSM 維持約 3 秒後回 idle
  const frameIndex = Math.floor((now / 1000) * anim.fps) % anim.frames
  const rect = frameRect(anim.row, frameIndex)
  petEl.style.backgroundPosition = `-${rect.x * DISPLAY_SCALE}px -${rect.y * DISPLAY_SCALE}px`
  renderCards()
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
