/// <reference path="../preload/api.d.ts" />

import type { CardView } from '../core/card-view'

const root = document.querySelector<HTMLDivElement>('#card')!
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
}

window.cardBridge.onCardData(render)

root.title = '點一下關閉'
root.addEventListener('click', () => {
  if (currentId) window.cardBridge.cardClicked(currentId)
})
