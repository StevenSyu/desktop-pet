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
const confirmDelId = signal<string | null>(null)
const draftName = signal('')
const adding = signal(false)
let pendingScrollBottom = false // 新增頻道後捲到底（新頻道在清單末）

window.channelsBridge.getChannels().then((cs) => (channels.value = cs))
window.channelsBridge.onChannelsUpdated((cs) => {
  channels.value = cs
  if (pendingScrollBottom) {
    pendingScrollBottom = false
    requestAnimationFrame(() => {
      const l = document.querySelector('.list')
      if (l) l.scrollTop = l.scrollHeight
    })
  }
})
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
function createChannel(): void {
  const name = draftName.value.trim()
  if (!name) return
  pendingScrollBottom = true
  upsert({ id: '', name, skin: skins.value.find((s) => s.valid)?.id ?? '', enabled: false, showPet: true, members: [] })
  draftName.value = ''
  adding.value = false
}
function cancelAdd(): void {
  adding.value = false
  draftName.value = ''
}

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
      <div class="crow-top">
        <span class="chev">{sel ? '▾' : '▸'}</span>
        <input class="name" value={ch.name} onClick={stop} onInput={(e) => upsert({ ...ch, name: (e.target as HTMLInputElement).value })} />
        <button class={'switch' + (ch.enabled ? ' on' : '')} role="switch" aria-checked={ch.enabled} disabled={lockLast} title={lockLast ? '至少保留一隻寵物' : ch.enabled ? '已啟用（點按停用）' : '已停用（點按啟用）'} onClick={(e) => { stop(e); upsert({ ...ch, enabled: !ch.enabled }) }}></button>
      </div>
      <div class="crow-bottom">
        <button class="del" disabled={lockLast} title={lockLast ? '至少保留一隻寵物（先啟用其他頻道再刪）' : '刪除頻道'} onClick={(e) => { stop(e); confirmDelId.value = ch.id }}>✕</button>
        <button class="skin-pick" onClick={(e) => { stop(e); window.channelsBridge.openSkinPicker(ch.id) }}>造型：{skinName(ch.skin)} ⚙</button>
        <span class="count">{ch.members.length} 來源</span>
        <button class={'eye' + (ch.showPet ? ' on' : '')} disabled={!ch.enabled || lockLast} title={!ch.enabled ? '頻道停用中（無寵物）' : lockLast ? '至少保留一隻顯示寵物' : ch.showPet ? '顯示寵物中（點按隱藏）' : '寵物已隱藏（點按顯示）'} onClick={(e) => { stop(e); upsert({ ...ch, showPet: !ch.showPet }) }} aria-label="寵物顯示切換"></button>
      </div>
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
          <div class="crow-top">
            <span class="chev" />
            <span class="all-name">全部</span>
            <span class="all-note">所有訊息 · 恆啟用</span>
          </div>
          <div class="crow-bottom">
            <button class="skin-pick" onClick={() => window.channelsBridge.openSkinPicker('all')}>造型：{skinName(defaultSkin.value)} ⚙</button>
            <button class={'eye' + (allEnabled.value ? ' on' : '')} disabled={allEnabled.value && activePetCount(channels.value, allEnabled.value) <= 1} title={allEnabled.value && activePetCount(channels.value, allEnabled.value) <= 1 ? '至少保留一隻顯示寵物（先顯示其他頻道）' : allEnabled.value ? '顯示「全部」寵物中（點按隱藏）' : '「全部」寵物已隱藏（點按顯示）'} onClick={() => window.channelsBridge.setAllEnabled(!allEnabled.value)} aria-label="全部寵物顯示切換"></button>
          </div>
        </div>
        {channels.value.map((ch) => <ChannelRow ch={ch} key={ch.id} />)}
        {channels.value.length === 0 && <div class="ph">尚無頻道（發一則通知即自動偵測）</div>}
      </div>
      {adding.value ? (
        <div class="addbar">
          <input class="add-input" value={draftName.value} placeholder="新頻道名稱…" ref={(el) => el?.focus()}
            onInput={(e) => (draftName.value = (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createChannel(); else if (e.key === 'Escape') { e.stopPropagation(); cancelAdd() } }} />
          <button class="add-confirm" disabled={draftName.value.trim() === ''} onClick={createChannel}>建立</button>
          <button class="add-cancel" onClick={cancelAdd}>取消</button>
        </div>
      ) : (
        <button class="add-trigger" onClick={() => (adding.value = true)}>＋ 新增頻道</button>
      )}
      {sel ? <MemberEditor ch={sel} /> : <div class="ph editor-empty">選一個頻道編輯成員</div>}
      {confirmDelId.value != null && <DeleteDialog />}
    </div>
  )
}

function DeleteDialog(): preact.JSX.Element {
  const ch = channels.value.find((c) => c.id === confirmDelId.value)
  const cancel = (): void => { confirmDelId.value = null }
  const confirm = (): void => {
    const id = confirmDelId.value
    if (id != null) {
      window.channelsBridge.deleteChannel(id)
      if (selectedId.value === id) selectedId.value = null
    }
    confirmDelId.value = null
  }
  return (
    <div class="modal" onClick={(e) => { if (e.target === e.currentTarget) cancel() }}>
      <div class="modal-card">
        <div class="modal-body">確定刪除頻道 <strong>「{ch?.name}」</strong>？<span class="sub">此操作無法復原，該頻道的來源分群設定會一併移除。</span></div>
        <div class="modal-actions">
          <button class="btn-cancel" onClick={cancel}>取消</button>
          <button class="btn-danger" onClick={confirm}>刪除</button>
        </div>
      </div>
    </div>
  )
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close() })
render(<App />, document.querySelector('#app')!)
