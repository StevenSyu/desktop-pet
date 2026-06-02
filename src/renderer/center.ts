/// <reference path="../preload/api.d.ts" />
import type { StoredMessage } from '../core/message-store'
import type { NotifyType } from '../core/events'
import { relativeTime, timeGroup, type TimeGroup } from '../core/time-format'
import { stripMarkdown } from '../core/markdown-strip'
import { renderMarkdown } from '../core/markdown-render'
import { filterByChannel, unreadByChannel, type Channel } from '../core/channel'
import { sessionShort, collectSessions, filterBySession } from '../core/session-filter'

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
let channels: Channel[] = []
let channelTab = 'all'
let sessionFilter = 'all'
let detailId: string | null = null
let savedScrollTop = 0
let flashId: string | null = null

const listEl = document.querySelector<HTMLDivElement>('#list')!
const emptyEl = document.querySelector<HTMLDivElement>('#empty')!
const unreadEl = document.querySelector<HTMLSpanElement>('#unread')!
const tabsEl = document.querySelector<HTMLDivElement>('#channel-tabs')!
const chipsEl = document.querySelector<HTMLDivElement>('#chips')!
const dndFlagEl = document.querySelector<HTMLSpanElement>('#dnd-flag')!

function setDndFlag(enabled: boolean): void {
  dndFlagEl.hidden = !enabled
}

window.petBridge.getDnd().then(setDndFlag)
window.petBridge.onDndChanged(setDndFlag)

function renderChips(): void {
  const typeChips = CHIPS.map((c) => {
    const el = document.createElement('span')
    el.className = 'chip' + (filter === c.id ? ' active' : '')
    el.textContent = c.name
    el.addEventListener('click', () => {
      filter = c.id
      render()
    })
    return el
  })

  // session 篩選 chips：僅當目前頻道內出現 ≥2 個非 default session 才顯示
  const sessions = collectSessions(filterByChannel(all, channelTab, channels))
  if (sessionFilter !== 'all' && !sessions.includes(sessionFilter)) sessionFilter = 'all'
  const sessionChips: HTMLElement[] = []
  if (sessions.length >= 2) {
    const mk = (id: string, label: string): HTMLSpanElement => {
      const el = document.createElement('span')
      el.className = 'chip session' + (sessionFilter === id ? ' active' : '')
      el.textContent = label
      el.title = id === 'all' ? '所有 session' : id
      el.addEventListener('click', () => {
        sessionFilter = id
        render()
      })
      return el
    }
    const sep = document.createElement('span')
    sep.className = 'chip-sep'
    sessionChips.push(sep, mk('all', '全部 session'), ...sessions.map((s) => mk(s, sessionShort(s))))
  }

  chipsEl.replaceChildren(...typeChips, ...sessionChips)
}

function renderTabs(): void {
  const counts = unreadByChannel(all, channels)
  const tabs: { id: string; name: string }[] = [
    { id: 'all', name: '全部' },
    ...channels.filter((c) => c.enabled).map((c) => ({ id: c.id, name: c.name })),
  ]
  // 目前分頁若指向已停用/刪除的 channel → 退回 all
  if (channelTab !== 'all' && !tabs.some((t) => t.id === channelTab)) channelTab = 'all'
  tabsEl.replaceChildren(
    ...tabs.map((t) => {
      const el = document.createElement('span')
      const n = counts[t.id] ?? 0
      el.className = 'ctab' + (channelTab === t.id ? ' active' : '')
      el.textContent = n > 0 ? `${t.name} (${n})` : t.name
      el.addEventListener('click', () => {
        channelTab = t.id
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
    savedScrollTop = listEl.scrollTop
    detailId = m.id
    render()
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
  const msg = detailId ? all.find((m) => m.id === detailId) : null
  if (detailId && !msg) detailId = null // 該則已被清空/淘汰 → fallback 回列表
  if (msg) {
    renderDetail(msg)
    return
  }
  renderList()
}

function renderList(): void {
  renderTabs()
  renderChips()
  const now = Date.now()
  const byChannel = filterBySession(filterByChannel(all, channelTab, channels), sessionFilter)
  const items = filter === 'all' ? byChannel : byChannel.filter((m) => m.type === filter)
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
    const el = buildItem(m, now)
    if (m.id === flashId) el.classList.add('flash')
    listEl.appendChild(el)
  }
  listEl.scrollTop = savedScrollTop
  flashId = null
}

function renderDetail(m: StoredMessage): void {
  if (!m.read) window.petBridge.markRead(m.id) // 進詳情才標已讀（未讀才送，避免重複 broadcast）
  tabsEl.replaceChildren()
  chipsEl.replaceChildren() // 詳情時清掉 chips（回列表時 renderChips 會重建）
  emptyEl.hidden = true

  const wrap = document.createElement('div')
  wrap.className = 'detail'
  wrap.dataset.type = m.type

  const back = document.createElement('button')
  back.className = 'back'
  back.textContent = '← 返回'
  back.addEventListener('click', () => {
    flashId = m.id
    detailId = null
    render()
  })
  wrap.appendChild(back)

  const label = document.createElement('div')
  label.className = 'detail-label'
  label.textContent = LABEL[m.type]
  wrap.appendChild(label)

  if (m.body) {
    const body = document.createElement('div')
    body.className = 'detail-body'
    // 安全：renderMarkdown escape-first + 無屬性標籤白名單（見 markdown-render 測試）
    body.innerHTML = renderMarkdown(m.body)
    wrap.appendChild(body)
  }

  const meta = document.createElement('div')
  meta.className = 'detail-meta'
  const src = m.title || m.source.name || m.source.kind
  const rows: [string, string][] = [
    ['來源', src],
    ['session', m.sessionId],
    ['時間', new Date(m.timestamp).toLocaleString()],
    ['收到', new Date(m.receivedAt).toLocaleString()],
  ]
  for (const [k, v] of rows) {
    const row = document.createElement('div')
    row.className = 'detail-row'
    const key = document.createElement('span')
    key.className = 'k'
    key.textContent = k
    const val = document.createElement('span')
    val.className = 'v'
    val.textContent = v
    row.appendChild(key)
    row.appendChild(val)
    meta.appendChild(row)
  }
  wrap.appendChild(meta)

  listEl.replaceChildren(wrap)
}

document.querySelector('#mark-all')!.addEventListener('click', () => window.petBridge.markAllRead())
document.querySelector('#clear')!.addEventListener('click', () => window.petBridge.clearMessages())
document.querySelector('#close')!.addEventListener('click', () => window.close())
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (detailId) {
    flashId = detailId
    detailId = null
    render()
  } else {
    window.close()
  }
})

window.petBridge.onMessagesUpdated((msgs) => {
  all = msgs
  render()
})

function consumePendingDetail(): void {
  window.petBridge.getPendingDetail().then(({ id }) => {
    if (id) {
      detailId = id
      render()
    }
  })
}

function consumePendingChannelTab(): void {
  window.petBridge.getPendingChannelTab().then((t) => {
    if (t) {
      channelTab = t
      render()
    }
  })
}

// 初次載入：主動拉一次（did-finish-load 後 main 也會推一次）
window.petBridge.getMessages().then((msgs) => {
  all = msgs
  render()
  consumePendingDetail() // 新開窗：載入後取 pending detail
})
window.petBridge.onOpenDetail(consumePendingDetail) // 已開窗：被 main 觸發重查
window.petBridge.getChannels().then((cs) => {
  channels = cs
  render()
  consumePendingChannelTab()
})
window.petBridge.onOpenChannelTab(consumePendingChannelTab)
window.petBridge.onChannelsUpdated((cs) => {
  channels = cs
  render()
})
