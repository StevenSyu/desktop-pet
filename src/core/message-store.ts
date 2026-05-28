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

  clear(): void {
    this.items = []
  }
}
