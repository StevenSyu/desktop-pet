/// <reference path="../preload/api.d.ts" />
import type { StoredMessage } from '../core/message-store'
import type { NotifyType } from '../core/events'
import { relativeTime, timeGroup, type TimeGroup } from '../core/time-format'
import { stripMarkdown } from '../core/markdown-strip'

const LABEL: Record<NotifyType, string> = {
  done: '完成',
  attention: '需要注意',
  error: '錯誤',
  review: '請檢視',
  working: '工作中',
  info: '通知',
}

const CHIPS: { id: 'all' | NotifyType; name: string }[] = [
  { id: 'all', name: '全部' },
  { id: 'done', name: '完成' },
  { id: 'attention', name: '需要注意' },
  { id: 'error', name: '錯誤' },
]

const GROUP_LABEL: Record<TimeGroup, string> = {
  now: '剛剛',
  today: '今天稍早',
  earlier: '更早',
}

let all: StoredMessage[] = []
let filter: 'all' | NotifyType = 'all'

const listEl = document.querySelector<HTMLDivElement>('#list')!
const emptyEl = document.querySelector<HTMLDivElement>('#empty')!
const unreadEl = document.querySelector<HTMLSpanElement>('#unread')!
const chipsEl = document.querySelector<HTMLDivElement>('#chips')!
const dndFlagEl = document.querySelector<HTMLSpanElement>('#dnd-flag')!

function setDndFlag(enabled: boolean): void {
  dndFlagEl.hidden = !enabled
}

window.petBridge.getDnd().then(setDndFlag)
window.petBridge.onDndChanged(setDndFlag)

function renderChips(): void {
  chipsEl.replaceChildren(
    ...CHIPS.map((c) => {
      const el = document.createElement('span')
      el.className = 'chip' + (filter === c.id ? ' active' : '')
      el.textContent = c.name
      el.addEventListener('click', () => {
        filter = c.id
        render()
      })
      return el
    }),
  )
}

function buildItem(m: StoredMessage, now: number): HTMLDivElement {
  const item = document.createElement('div')
  item.className = `item ${m.read ? 'read' : 'unread'}`
  item.dataset.type = m.type
  item.addEventListener('click', () => {
    if (!m.read) window.petBridge.markRead(m.id) // main 會回推更新
  })

  const main = document.createElement('div')
  main.className = 'main'

  const label = document.createElement('div')
  label.className = 'label'
  label.textContent = LABEL[m.type]
  main.appendChild(label)

  if (m.body) {
    const body = document.createElement('div')
    body.className = 'body'
    body.textContent = stripMarkdown(m.body)
    main.appendChild(body)

    const expand = document.createElement('div')
    expand.className = 'expand'
    expand.textContent = '展開'
    expand.hidden = true
    expand.addEventListener('click', (ev) => {
      ev.stopPropagation()
      body.classList.toggle('expanded')
      expand.textContent = body.classList.contains('expanded') ? '收合' : '展開'
    })
    main.appendChild(expand)
    // 內容溢出才顯示展開鈕
    requestAnimationFrame(() => {
      expand.hidden = body.scrollHeight <= body.clientHeight
    })
  }

  const sourceText = m.title || m.source.name || m.source.kind
  const sessionTag =
    m.sessionId && m.sessionId !== 'default' ? `#${m.sessionId.slice(0, 6)}` : ''
  const display = [sourceText, sessionTag].filter(Boolean).join(' · ')
  if (display) {
    const s = document.createElement('div')
    s.className = 'src'
    s.textContent = display
    main.appendChild(s)
  }

  const meta = document.createElement('div')
  meta.className = 'meta'
  const time = document.createElement('div')
  time.className = 'time'
  time.textContent = relativeTime(m.receivedAt, now)
  meta.appendChild(time)
  if (!m.read) {
    const dot = document.createElement('div')
    dot.className = 'dot'
    meta.appendChild(dot)
  }

  item.appendChild(main)
  item.appendChild(meta)
  return item
}

function render(): void {
  renderChips()
  const now = Date.now()
  const items = filter === 'all' ? all : all.filter((m) => m.type === filter)
  const unread = all.filter((m) => !m.read).length
  unreadEl.textContent = unread > 0 ? `${unread} 則未讀` : ''

  listEl.replaceChildren()
  emptyEl.hidden = items.length > 0

  let lastGroup: TimeGroup | null = null
  for (const m of items) {
    const g = timeGroup(m.receivedAt, now)
    if (g !== lastGroup) {
      lastGroup = g
      const gh = document.createElement('div')
      gh.className = 'group'
      gh.textContent = GROUP_LABEL[g]
      listEl.appendChild(gh)
    }
    listEl.appendChild(buildItem(m, now))
  }
}

document.querySelector('#mark-all')!.addEventListener('click', () => window.petBridge.markAllRead())
document.querySelector('#clear')!.addEventListener('click', () => window.petBridge.clearMessages())
document.querySelector('#close')!.addEventListener('click', () => window.close())
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close()
})

window.petBridge.onMessagesUpdated((msgs) => {
  all = msgs
  render()
})

// 初次載入：主動拉一次（did-finish-load 後 main 也會推一次）
window.petBridge.getMessages().then((msgs) => {
  all = msgs
  render()
})
