import type { NotifyType } from './events'

export interface AnimationSpec {
  row: number
  frames: number
  fps: number
  loop: boolean
}

export const SPRITE_FORMAT = {
  sheetWidth: 1536,
  sheetHeight: 1872,
  cols: 8,
  rows: 9,
  frameWidth: 192,
  frameHeight: 208,
  animations: {
    idle: { row: 0, frames: 6, fps: 4, loop: true },
    'running-right': { row: 1, frames: 8, fps: 8, loop: true },
    'running-left': { row: 2, frames: 8, fps: 8, loop: true },
    waving: { row: 3, frames: 4, fps: 6, loop: false },
    jumping: { row: 4, frames: 5, fps: 8, loop: false },
    failed: { row: 5, frames: 8, fps: 8, loop: false },
    waiting: { row: 6, frames: 6, fps: 4, loop: true },
    running: { row: 7, frames: 6, fps: 8, loop: true },
    review: { row: 8, frames: 7, fps: 6, loop: false },
  },
} as const satisfies {
  sheetWidth: number
  sheetHeight: number
  cols: number
  rows: number
  frameWidth: number
  frameHeight: number
  animations: Record<string, AnimationSpec>
}

export type AnimationName = keyof typeof SPRITE_FORMAT.animations

export interface FrameRect {
  x: number
  y: number
  w: number
  h: number
}

export function frameRect(row: number, col: number): FrameRect {
  return {
    x: col * SPRITE_FORMAT.frameWidth,
    y: row * SPRITE_FORMAT.frameHeight,
    w: SPRITE_FORMAT.frameWidth,
    h: SPRITE_FORMAT.frameHeight,
  }
}

export function validateSheetDimensions(width: number, height: number): boolean {
  return width === SPRITE_FORMAT.sheetWidth && height === SPRITE_FORMAT.sheetHeight
}

const TYPE_ANIMATION: Record<NotifyType, AnimationName> = {
  done: 'jumping',
  attention: 'waving',
  error: 'failed',
  review: 'review',
  working: 'waiting',
  info: 'idle',
}

export function animationForType(type: NotifyType): AnimationName {
  return TYPE_ANIMATION[type]
}
