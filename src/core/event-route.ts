// 一筆外部通知事件的路由決策（純函式）：勿擾吞掉、響不響音、推給哪些寵物。
// adapter（index.ts 的 ingest onEvent）只執行副作用：beep、pushTo（含載入中延遲推）。
import { matchingChannels, type Channel } from './channel'
import type { NotifySource } from './events'

export interface EventRouteState {
  dnd: boolean
  soundEnabled: boolean
  allEnabled: boolean
  channels: Channel[]
}

export interface EventRoute {
  /** 是否響通知音（事件層一次，多寵物 fan-out 不疊響）。 */
  sound: boolean
  /** 要推 pet-event 的寵物 channelId（'all' ＋ 命中的啟用頻道）。 */
  targets: string[]
}

export function routeEvent(state: EventRouteState, source: NotifySource): EventRoute {
  if (state.dnd) return { sound: false, targets: [] } // 勿擾：不彈卡、不演動畫、不響音
  const targets = new Set<string>([
    ...(state.allEnabled ? ['all'] : []),
    ...matchingChannels(source, state.channels),
  ])
  return { sound: state.soundEnabled, targets: [...targets] }
}
