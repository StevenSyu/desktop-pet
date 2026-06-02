export type ChannelLabelMode = 'hidden' | 'hover' | 'always'

const MODES: ChannelLabelMode[] = ['hidden', 'hover', 'always']

export function sanitizeLabelMode(raw: unknown): ChannelLabelMode {
  return typeof raw === 'string' && (MODES as string[]).includes(raw)
    ? (raw as ChannelLabelMode)
    : 'hidden'
}

export function shouldShowLabel(mode: ChannelLabelMode, hovering: boolean): boolean {
  if (mode === 'always') return true
  if (mode === 'hover') return hovering
  return false
}
