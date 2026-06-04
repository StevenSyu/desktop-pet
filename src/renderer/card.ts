/// <reference path="../preload/api.d.ts" />

import type { CardView } from '../core/card-view'

const root = document.querySelector<HTMLDivElement>('#card')!
const myChannel = new URLSearchParams(location.search).get('c') ?? 'all'
let currentId: string | null = null
let dismissTimer: ReturnType<typeof setTimeout> | null = null

function render(view: CardView): void {
  // 換卡先清舊 timer，避免舊 transient timer 關掉新卡
  if (dismissTimer) {
    clearTimeout(dismissTimer)
    dismissTimer = null
  }

  currentId = view.id
  root.dataset.type = view.type // CSS 依此上狀態色
  root.replaceChildren()

  const label = document.createElement('div')
  label.className = 'card-label'
  label.textContent = view.label
  root.appendChild(label)

  if (view.body) {
    const body = document.createElement('div')
    body.className = 'card-body'
    body.textContent = view.body
    root.appendChild(body)
  }

  if (view.source) {
    const source = document.createElement('div')
    source.className = 'card-source'
    source.textContent = view.source
    root.appendChild(source)
  }

  // 右上角關閉鈕：點它只關閉（stopPropagation 不觸發開詳情）
  const close = document.createElement('button')
  close.className = 'card-close'
  close.textContent = '×'
  close.title = '關閉'
  close.setAttribute('aria-label', '關閉')
  close.addEventListener('click', (e) => {
    e.stopPropagation()
    if (currentId) window.cardBridge.cardClicked(myChannel, currentId)
  })
  root.appendChild(close)

  if (view.transient) {
    const id = view.id // 捕捉 render 當下的 id
    dismissTimer = setTimeout(() => {
      dismissTimer = null
      window.cardBridge.cardClicked(myChannel, id) // 走現有點關路徑：dismissCardsById 連帶關所有同 id 卡
    }, view.transient.dismissMs)
  }
}

window.cardBridge.onCardData(render)

// 點卡片本體（除關閉鈕外任意處）→ 開通知中心詳情看完整內容
root.title = '點開看完整內容'
root.addEventListener('click', () => {
  if (currentId) window.cardBridge.cardMore(myChannel, currentId)
})
