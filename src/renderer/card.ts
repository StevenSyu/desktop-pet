/// <reference path="../preload/api.d.ts" />

import type { CardView } from '../core/card-view'

const root = document.querySelector<HTMLDivElement>('#card')!
const myChannel = new URLSearchParams(location.search).get('c') ?? 'all'
let currentId: string | null = null

function render(view: CardView): void {
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
}

window.cardBridge.onCardData(render)

// 點卡片本體（除關閉鈕外任意處）→ 開通知中心詳情看完整內容
root.title = '點開看完整內容'
root.addEventListener('click', () => {
  if (currentId) window.cardBridge.cardMore(myChannel, currentId)
})
