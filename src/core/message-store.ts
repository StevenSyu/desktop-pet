import type { AppEvent, NotifyType } from './events'

export interface StoredMessage extends AppEvent {
  read: boolean
  receivedAt: number
}

export interface MessageStoreOptions {
  now?: () => number
  capacity?: number
}

const DEFAULT_CAPACITY = 50

export class MessageStore {
  private items: StoredMessage[] = []
  private readonly now: () => number
  private readonly capacity: number

  constructor(options: MessageStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.capacity = options.capacity ?? DEFAULT_CAPACITY
  }

  /** 加入未讀訊息；超過容量移除最舊。 */
  push(event: AppEvent): StoredMessage {
    const msg: StoredMessage = { ...event, read: false, receivedAt: this.now() }
    this.items.push(msg)
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity)
    }
    return msg
  }

  markRead(id: string): void {
    const m = this.items.find((x) => x.id === id)
    if (m) m.read = true
  }

  markAllRead(): void {
    for (const m of this.items) m.read = true
  }

  /** 由新到舊；可依 type 過濾。 */
  list(filter: { type?: NotifyType } = {}): StoredMessage[] {
    const out = filter.type ? this.items.filter((m) => m.type === filter.type) : [...this.items]
    return out.reverse()
  }

  unreadCount(): number {
    return this.items.reduce((n, m) => (m.read ? n : n + 1), 0)
  }

  /** 刪除指定 ids 的訊息（不存在的 id 忽略）。 */
  removeByIds(ids: string[]): void {
    if (ids.length === 0) return
    const set = new Set(ids)
    this.items = this.items.filter((m) => !set.has(m.id))
  }
}
