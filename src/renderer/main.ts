import { SPRITE_FORMAT, frameRect, type AnimationName } from '../core/sprite-format'
import { PetController } from '../core/pet-fsm'
import sheetUrl from '../../resources/pets/may/spritesheet.webp'

const DISPLAY_SCALE = 0.7

const petEl = document.querySelector<HTMLDivElement>('#pet')!
petEl.style.width = `${SPRITE_FORMAT.frameWidth * DISPLAY_SCALE}px`
petEl.style.height = `${SPRITE_FORMAT.frameHeight * DISPLAY_SCALE}px`
petEl.style.backgroundImage = `url(${sheetUrl})`
petEl.style.backgroundSize = `${SPRITE_FORMAT.sheetWidth * DISPLAY_SCALE}px ${SPRITE_FORMAT.sheetHeight * DISPLAY_SCALE}px`

const pet = new PetController()

function render(now: number): void {
  const view = pet.advance(now)
  const anim = SPRITE_FORMAT.animations[view.animation as AnimationName]
  const frameIndex = Math.floor((now / 1000) * anim.fps) % anim.frames
  const rect = frameRect(anim.row, frameIndex)
  petEl.style.backgroundPosition = `-${rect.x * DISPLAY_SCALE}px -${rect.y * DISPLAY_SCALE}px`
  requestAnimationFrame(render)
}
requestAnimationFrame(render)

// 之後 Task 6 會在這裡接上 IPC 事件 → pet.onEvent(...)
;(window as unknown as { __pet?: PetController }).__pet = pet
