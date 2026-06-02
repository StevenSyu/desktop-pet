/// <reference path="../preload/api.d.ts" />
import { render } from 'preact'
import { signal } from '@preact/signals'
import { matchesSource, activePetCount, type Channel, type SourceMatch } from '../core/channel'
import type { DiscoveredSkin } from '../core/skin-scan'

const channels = signal<Channel[]>([])
const allEnabled = signal(true)
const knownSources = signal<SourceMatch[]>([])
const skins = signal<DiscoveredSkin[]>([])
const defaultSkin = signal<string>('')
const selectedId = signal<string | null>(null)
const draftName = signal('')

window.channelsBridge.getChannels().then((cs) => (channels.value = cs))
window.channelsBridge.onChannelsUpdated((cs) => (channels.value = cs))
window.channelsBridge.getKnownSources().then((s) => (knownSources.value = s))
window.channelsBridge.onKnownSourcesUpdated((s) => (knownSources.value = s))
window.channelsBridge.getSkins().then((r) => (skins.value = r.skins))
window.channelsBridge.getDefaultSkin().then((id) => (defaultSkin.value = id))
window.channelsBridge.onDefaultSkinUpdated((id) => (defaultSkin.value = id))
window.channelsBridge.getAllEnabled().then((v) => (allEnabled.value = v))
window.channelsBridge.onAllEnabledUpdated((v) => (allEnabled.value = v))

const srcKey = (s: SourceMatch): string => `${s.kind ?? ''} ${s.name ?? ''}`
const srcLabel = (s: SourceMatch): string => s.name || s.kind || '(unknown)'
const skinName = (id: string): string => skins.value.find((s) => s.id === id)?.displayName ?? id
const upsert = (ch: Channel): void => window.channelsBridge.upsertChannel(ch)

function addMember(ch: Channel, s: SourceMatch): void {
  if (ch.members.some((m) => srcKey(m) === srcKey(s))) return
  upsert({ ...ch, members: [...ch.members, { ...s }] })
}
function removeMember(ch: Channel, i: number): void {
  upsert({ ...ch, members: ch.members.filter((_, idx) => idx !== i) })
}

function ChannelRow({ ch }: { ch: Channel }): preact.JSX.Element {
  const sel = selectedId.value === ch.id
  const stop = (e: Event) => e.stopPropagation()
  // 這個頻道的寵物是否為「唯一顯示」→ 停用/刪除/關眼睛都會歸零，防呆鎖定（至少保留一隻顯示）
  const lockLast = ch.enabled && ch.showPet && activePetCount(channels.value, allEnabled.value) <= 1
  return (
    <div class={'crow' + (sel ? ' sel' : '')} onClick={() => (selectedId.value = sel ? null : ch.id)} title="點此列選取並在下方編輯成員">
      <span class="chev">{sel ? '▾' : '▸'}</span>
      <input class="name" value={ch.name} onClick={stop} onInput={(e) => upsert({ ...ch, name: (e.target as HTMLInputElement).value })} />
      <button class="skin-pick" onClick={(e) => { stop(e); window.channelsBridge.openSkinPicker(ch.id) }}>造型：{skinName(ch.skin)} ⚙</button>
      <span class="count">{ch.members.length} 來源</span>
      <button class={'eye' + (ch.showPet ? ' on' : '')} disabled={!ch.enabled || lockLast} title={!ch.enabled ? '頻道停用中（無寵物）' : lockLast ? '至少保留一隻顯示寵物' : ch.showPet ? '顯示寵物中（點按隱藏）' : '寵物已隱藏（點按顯示）'} onClick={(e) => { stop(e); upsert({ ...ch, showPet: !ch.showPet }) }} aria-label="寵物顯示切換"></button>
      <button class={'toggle' + (ch.enabled ? ' on' : '')} disabled={lockLast} title={lockLast ? '至少保留一隻寵物' : ''} onClick={(e) => { stop(e); upsert({ ...ch, enabled: !ch.enabled }) }}>{ch.enabled ? '啟用中' : '停用'}</button>
      <button class="del" disabled={lockLast} title={lockLast ? '至少保留一隻寵物（先啟用其他頻道再刪）' : ''} onClick={(e) => { stop(e); window.channelsBridge.deleteChannel(ch.id); if (sel) selectedId.value = null }}>✕</button>
    </div>
  )
}

function MemberEditor({ ch }: { ch: Channel }): preact.JSX.Element {
  const pool = knownSources.value.filter((s) => !matchesSourceAny(ch, s))
  return (
    <div class="editor">
      <div class="col">
        <div class="col-h">已知來源</div>
        <div class="zone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const i = e.dataTransfer?.getData('member-index'); if (i) removeMember(ch, Number(i)) }}>
          {pool.map((s) => (
            <div class="src" draggable onDragStart={(e) => e.dataTransfer?.setData('src-key', srcKey(s))} onClick={() => addMember(ch, s)} title="點擊或拖到右邊加入">
              {srcLabel(s)}<span class="add">＋</span>
            </div>
          ))}
          {pool.length === 0 && <div class="ph">（無可加入來源）</div>}
        </div>
      </div>
      <div class="col">
        <div class="col-h">「{ch.name}」成員</div>
        <div class="zone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const key = e.dataTransfer?.getData('src-key'); const s = knownSources.value.find((x) => srcKey(x) === key); if (s) addMember(ch, s) }}>
          {ch.members.map((m, i) => (
            <div class="src member" draggable onDragStart={(e) => e.dataTransfer?.setData('member-index', String(i))} onClick={() => removeMember(ch, i)} title="點擊或拖回左邊移除">
              {srcLabel(m)}{m.name == null ? ' (整類)' : ''}<span class="rm">✕</span>
            </div>
          ))}
          {ch.members.length === 0 && <div class="ph">（拖來源進來）</div>}
        </div>
      </div>
    </div>
  )
}

function matchesSourceAny(ch: Channel, s: SourceMatch): boolean {
  return ch.members.some((m) => matchesSource(m, { kind: s.kind ?? '', name: s.name }))
}

function App(): preact.JSX.Element {
  const sel = channels.value.find((c) => c.id === selectedId.value)
  return (
    <div class="panel">
      <header><div class="title">寵物設定</div><button class="close" onClick={() => window.close()}>×</button></header>
      <div class="hint">把「已知來源」拖或點進某頻道＝該頻道含它（可跨專案合併）。啟用→通知中心多一分頁。</div>
      <div class="list">
        <div class="crow all">
          <span class="chev" />
          <span class="all-name">全部</span>
          <span class="all-note">所有訊息 · 恆啟用</span>
          <button class="skin-pick" onClick={() => window.channelsBridge.openSkinPicker('all')}>造型：{skinName(defaultSkin.value)} ⚙</button>
          <span class="count" />
          <button class={'eye' + (allEnabled.value ? ' on' : '')} disabled={allEnabled.value && activePetCount(channels.value, allEnabled.value) <= 1} title={allEnabled.value && activePetCount(channels.value, allEnabled.value) <= 1 ? '至少保留一隻顯示寵物（先顯示其他頻道）' : allEnabled.value ? '顯示「全部」寵物中（點按隱藏）' : '「全部」寵物已隱藏（點按顯示）'} onClick={() => window.channelsBridge.setAllEnabled(!allEnabled.value)} aria-label="全部寵物顯示切換"></button>
          <span class="del-spacer" />
        </div>
        {channels.value.map((ch) => <ChannelRow ch={ch} key={ch.id} />)}
        {channels.value.length === 0 && <div class="ph">尚無頻道（發一則通知即自動偵測）</div>}
      </div>
      <div class="addbar">
        <input value={draftName.value} placeholder="新頻道名稱" onInput={(e) => (draftName.value = (e.target as HTMLInputElement).value)} />
        <button disabled={draftName.value.trim() === ''} onClick={() => { upsert({ id: '', name: draftName.value.trim(), skin: skins.value.find((s) => s.valid)?.id ?? '', enabled: false, showPet: true, members: [] }); draftName.value = '' }}>＋ 新增頻道</button>
      </div>
      {sel ? <MemberEditor ch={sel} /> : <div class="ph editor-empty">選一個頻道編輯成員</div>}
    </div>
  )
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close() })
render(<App />, document.querySelector('#app')!)
