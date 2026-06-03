/// <reference path="../preload/api.d.ts" />
import type { StoredMessage } from '../core/message-store'
import type { NotifyType } from '../core/events'
import { relativeTime, timeGroup, type TimeGroup } from '../core/time-format'
import { stripMarkdown } from '../core/markdown-strip'
import { renderMarkdown } from '../core/markdown-render'
import { sessionShort } from '../core/session-filter'
import { liveQuery } from '../core/live-query'
import {
  centerReduce,
  centerView,
  initialCenterState,
  type CenterEvent,
  type CenterView,
} from '../core/center-state'

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

// 狀態機在 core 的 center-state（分頁/篩選/詳情/scroll/flash 扶正全在 reducer），
// 這裡只 dispatch 事件並把 centerView 投影成 DOM。
let state = initialCenterState()

function update(e: CenterEvent): void {
  state = centerReduce(state, e)
  render()
}

const listEl = document.querySelector<HTMLDivElement>('#list')!
const emptyEl = document.querySelector<HTMLDivElement>('#empty')!
const unreadEl = document.querySelector<HTMLSpanElement>('#unread')!
const tabsEl = document.querySelector<HTMLDivElement>('#channel-tabs')!
const filtersEl = document.querySelector<HTMLDivElement>('#filters')!
const dndFlagEl = document.querySelector<HTMLSpanElement>('#dnd-flag')!

function setDndFlag(enabled: boolean): void {
  dndFlagEl.hidden = !enabled
}

void liveQuery(
  () => window.petBridge.getDnd(),
  (cb) => window.petBridge.onDndChanged(cb),
  setDndFlag,
)

// type / session 篩選用下拉選單（語意上非分頁；與 channel 分頁區隔、省空間）
function mkSelect(cls: string, opts: { id: string; name: string }[], current: string, onPick: (v: string) => void): HTMLSelectElement {
  const sel = document.createElement('select')
  sel.className = 'filter-select' + cls
  for (const o of opts) {
    const op = document.createElement('option')
    op.value = o.id
    op.textContent = o.name
    if (o.id === current) op.selected = true
    sel.appendChild(op)
  }
  sel.addEventListener('change', () => onPick(sel.value))
  return sel
}

function renderFilters(v: CenterView): void {
  const children: HTMLElement[] = [
    mkSelect('', CHIPS, v.typeFilter, (val) => update({ kind: 'pickType', filter: val as 'all' | NotifyType })),
  ]
  // session 下拉：僅當目前頻道內出現 ≥2 個非 default session 才顯示
  if (v.sessions.length >= 2) {
    const opts = [{ id: 'all', name: '全部 session' }, ...v.sessions.map((s) => ({ id: s, name: sessionShort(s) }))]
    children.push(mkSelect(' session', opts, v.sessionFilter, (val) => update({ kind: 'pickSession', session: val })))
  }
  filtersEl.replaceChildren(...children)
}

function renderTabs(v: CenterView): void {
  tabsEl.replaceChildren(
    ...v.tabs.map((t) => {
      const el = document.createElement('span')
      el.className = 'ctab' + (v.channelTab === t.id ? ' active' : '')
      el.textContent = t.unread > 0 ? `${t.name} (${t.unread})` : t.name
      el.addEventListener('click', () => update({ kind: 'pickTab', tab: t.id }))
      return el
    }),
  )
}

function buildItem(m: StoredMessage, now: number): HTMLDivElement {
  const item = document.createElement('div')
  item.className = `item ${m.read ? 'read' : 'unread'}`
  item.dataset.type = m.type
  item.addEventListener('click', () => update({ kind: 'openDetail', id: m.id, scrollTop: listEl.scrollTop }))

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
  const v = centerView(state)
  if (v.mode === 'detail' && v.detail) {
    renderDetail(v.detail)
    return
  }
  renderList(v)
}

function renderList(v: CenterView): void {
  renderTabs(v)
  renderFilters(v)
  const now = Date.now()
  unreadEl.textContent = v.unreadTotal > 0 ? `${v.unreadTotal} 則未讀` : ''

  listEl.replaceChildren()
  emptyEl.hidden = v.items.length > 0

  let lastGroup: TimeGroup | null = null
  for (const m of v.items) {
    const g = timeGroup(m.receivedAt, now)
    if (g !== lastGroup) {
      lastGroup = g
      const gh = document.createElement('div')
      gh.className = 'group'
      gh.textContent = GROUP_LABEL[g]
      listEl.appendChild(gh)
    }
    const el = buildItem(m, now)
    if (m.id === v.flashId) el.classList.add('flash')
    listEl.appendChild(el)
  }
  listEl.scrollTop = v.scrollTop
  state = centerReduce(state, { kind: 'flashShown' }) // 一次性消費，不重渲染
}

function renderDetail(m: StoredMessage): void {
  if (!m.read) window.petBridge.markRead(m.id) // 進詳情才標已讀（未讀才送，避免重複 broadcast）
  tabsEl.replaceChildren()
  filtersEl.replaceChildren() // 詳情時清掉篩選列（回列表時 renderFilters 會重建）
  emptyEl.hidden = true

  const wrap = document.createElement('div')
  wrap.className = 'detail'
  wrap.dataset.type = m.type

  const back = document.createElement('button')
  back.className = 'back'
  back.textContent = '← 返回'
  back.addEventListener('click', () => update({ kind: 'backToList' }))
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

document.querySelector('#mark-all')!.addEventListener('click', () => {
  // 只標當前分頁 + session/type 篩選後可見的未讀，不動其他分頁的訊息
  const ids = centerView(state).items.filter((m) => !m.read).map((m) => m.id)
  if (ids.length) window.petBridge.markReadIds(ids)
})
document.querySelector('#clear')!.addEventListener('click', () => window.petBridge.clearMessages())
document.querySelector('#close')!.addEventListener('click', () => window.close())
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (state.detailId) {
    update({ kind: 'backToList' })
  } else {
    window.close()
  }
})

function consumePendingDetail(): void {
  window.petBridge.getPendingDetail().then(({ id }) => {
    if (id) update({ kind: 'openDetail', id, scrollTop: state.scrollTop })
  })
}

function consumePendingChannelTab(): void {
  window.petBridge.getPendingChannelTab().then((t) => {
    if (t) update({ kind: 'pickTab', tab: t })
  })
}

// 初次載入：訂閱先行 + 主動拉一次（liveQuery 防 push/query race），載入後消費 pending 狀態
void liveQuery(
  () => window.petBridge.getMessages(),
  (cb) => window.petBridge.onMessagesUpdated(cb),
  (msgs) => update({ kind: 'messages', messages: msgs }),
).then(consumePendingDetail) // 新開窗：載入後取 pending detail
window.petBridge.onOpenDetail(consumePendingDetail) // 已開窗：被 main 觸發重查
void liveQuery(
  () => window.petBridge.getChannels(),
  (cb) => window.petBridge.onChannelsUpdated(cb),
  (cs) => update({ kind: 'channels', channels: cs }),
).then(consumePendingChannelTab)
window.petBridge.onOpenChannelTab(consumePendingChannelTab)
