/// <reference path="../preload/api.d.ts" />
import { render } from 'preact'
import { signal } from '@preact/signals'
import type { Channel } from '../core/channel'
import type { DiscoveredSkin } from '../core/skin-scan'

const channels = signal<Channel[]>([])
const skins = signal<DiscoveredSkin[]>([])

window.channelsBridge.getChannels().then((cs) => (channels.value = cs))
window.channelsBridge.onChannelsUpdated((cs) => (channels.value = cs))
window.channelsBridge.getSkins().then((r) => (skins.value = r.skins))

// id 一律由 main 指派：新建送空 id，main 收到空 id 會產生（見 Task 4 channel-upsert）。
function upsert(ch: Channel): void {
  window.channelsBridge.upsertChannel(ch)
}
const matchOf = (by: string, val: string): Channel['match'] => (by === 'name' ? { name: val } : { kind: val })

// 既有頻道列：欄位變更即存；match 值為空時不送（避免持久化空 match）。
function Row({ ch }: { ch: Channel }): preact.JSX.Element {
  const by = ch.match.name != null ? 'name' : 'kind'
  const val = ch.match.name ?? ch.match.kind ?? ''
  const setMatch = (nby: string, nval: string): void => {
    if (nval.trim() === '') return // 空值不持久化（保留上一個有效 match）
    upsert({ ...ch, match: matchOf(nby, nval) })
  }
  return (
    <div class="row" data-enabled={String(ch.enabled)}>
      <input class="name" value={ch.name} onInput={(e) => upsert({ ...ch, name: (e.target as HTMLInputElement).value })} />
      <select class="skin" value={ch.skin} onChange={(e) => upsert({ ...ch, skin: (e.target as HTMLSelectElement).value })}>
        {skins.value.filter((s) => s.valid).map((s) => (
          <option value={s.id}>{s.displayName}</option>
        ))}
      </select>
      <select class="by" value={by} onChange={(e) => setMatch((e.target as HTMLSelectElement).value, val)}>
        <option value="name">專案名</option>
        <option value="kind">類別</option>
      </select>
      <input class="val" value={val} onInput={(e) => setMatch(by, (e.target as HTMLInputElement).value)} />
      <button class={'toggle' + (ch.enabled ? ' on' : '')} onClick={() => upsert({ ...ch, enabled: !ch.enabled })}>
        {ch.enabled ? '啟用中' : '停用'}
      </button>
      <button class="del" onClick={() => window.channelsBridge.deleteChannel(ch.id)}>✕</button>
    </div>
  )
}

// 手動新增草稿：純本地 signal，不送空 match；按「建立」且 val 非空才送 upsert（id 空字串→main 指派）。
const draft = signal<{ name: string; skin: string; by: string; val: string } | null>(null)
function openDraft(): void {
  draft.value = { name: '新頻道', skin: skins.value.find((s) => s.valid)?.id ?? '', by: 'name', val: '' }
}
function commitDraft(): void {
  const d = draft.value
  if (!d || d.val.trim() === '') return
  upsert({ id: '', name: d.name, skin: d.skin, enabled: false, match: matchOf(d.by, d.val) })
  draft.value = null
}

function DraftRow(): preact.JSX.Element | null {
  const d = draft.value
  if (!d) return null
  const set = (patch: Partial<typeof d>) => (draft.value = { ...d, ...patch })
  return (
    <div class="row draft">
      <input class="name" value={d.name} onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} />
      <select class="skin" value={d.skin} onChange={(e) => set({ skin: (e.target as HTMLSelectElement).value })}>
        {skins.value.filter((s) => s.valid).map((s) => (
          <option value={s.id}>{s.displayName}</option>
        ))}
      </select>
      <select class="by" value={d.by} onChange={(e) => set({ by: (e.target as HTMLSelectElement).value })}>
        <option value="name">專案名</option>
        <option value="kind">類別</option>
      </select>
      <input class="val" value={d.val} placeholder="比對值" onInput={(e) => set({ val: (e.target as HTMLInputElement).value })} />
      <button class="toggle on" disabled={d.val.trim() === ''} onClick={commitDraft}>建立</button>
      <button class="del" onClick={() => (draft.value = null)}>✕</button>
    </div>
  )
}

function App(): preact.JSX.Element {
  return (
    <div class="panel">
      <header>
        <div class="title">頻道</div>
        <button class="close" onClick={() => window.close()}>×</button>
      </header>
      <div class="hint">啟用某頻道 → 通知中心多一個分頁（B 階段會長自己的寵物）。自動偵測到的新來源會以「停用」加入。</div>
      <div class="list">
        {channels.value.map((ch) => (
          <Row ch={ch} key={ch.id} />
        ))}
        {channels.value.length === 0 && !draft.value && <div class="empty">尚無頻道（發一則通知即會自動偵測）</div>}
        <DraftRow />
      </div>
      <button class="add" disabled={draft.value !== null} onClick={openDraft}>＋ 手動新增</button>
    </div>
  )
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close()
})

render(<App />, document.querySelector('#app')!)
