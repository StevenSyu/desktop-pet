import type { AppEvent } from './events'

export interface NotificationQueueOptions {
  now?: () => number
}

export class NotificationQueue {
  private items: AppEvent[] = []
  private readonly now: () => number

  constructor(options: NotificationQueueOptions = {}) {
    this.now = options.now ?? (() => Date.now())
  }

  /** 加入事件；同 id 則就地更新（去重）。 */
  push(event: AppEvent): void {
    const index = this.items.findIndex((e) => e.id === event.id)
    if (index >= 0) {
      this.items[index] = event
    } else {
      this.items.push(event)
    }
  }

  /** 回傳尚未到期的事件（順手清掉已到期者）。 */
  active(): AppEvent[] {
    const t = this.now()
    this.items = this.items.filter((e) => t - e.timestamp < e.ttlMs)
    return [...this.items]
  }

  /** 最近一則仍有效的事件，無則 undefined。 */
  latest(): AppEvent | undefined {
    const a = this.active()
    return a.length > 0 ? a[a.length - 1] : undefined
  }
}
