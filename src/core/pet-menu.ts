// 寵物右鍵選單的純模板：prefs → 選單顯示狀態（radio/checkbox checked、enabled 規則）。
// click 副作用以 action tag 表達，adapter（window.ts 的 show-context-menu）對 tag 做 dispatch。
// 新增選單項＝模板加一項 ＋ adapter switch 加一個 case。
import type { ChannelLabelMode } from './channel-label'

export type PetMenuAction =
  | { type: 'set-label-mode'; mode: ChannelLabelMode }
  | { type: 'open-channels' }
  | { type: 'toggle-auto-walk' }
  | { type: 'toggle-dnd' }
  | { type: 'toggle-sound' }
  | { type: 'open-settings' }
  | { type: 'open-center' }
  | { type: 'close-pet' }
  | { type: 'quit' }

export interface PetMenuItem {
  kind: 'normal' | 'checkbox' | 'radio' | 'separator'
  label?: string
  checked?: boolean
  enabled?: boolean
  action?: PetMenuAction
  submenu?: PetMenuItem[]
}

export interface PetMenuState {
  channelLabelMode: ChannelLabelMode
  autoWalk: boolean
  dnd: boolean
  soundEnabled: boolean
}

export function petMenuTemplate(state: PetMenuState, petCount: number): PetMenuItem[] {
  const labelRadio = (label: string, mode: ChannelLabelMode): PetMenuItem => ({
    kind: 'radio',
    label,
    checked: state.channelLabelMode === mode,
    action: { type: 'set-label-mode', mode },
  })
  // 防呆：至少保留一隻寵物（選單 disable；index.ts 的 close-pet bus handler 再擋一次避免 race）
  const canClose = petCount >= 2
  return [
    {
      kind: 'normal',
      label: '名稱標籤',
      submenu: [labelRadio('隱藏', 'hidden'), labelRadio('滑過時顯示', 'hover'), labelRadio('常態顯示', 'always')],
    },
    { kind: 'normal', label: '寵物設定…', action: { type: 'open-channels' } },
    { kind: 'checkbox', label: '自動走動', checked: state.autoWalk, action: { type: 'toggle-auto-walk' } },
    { kind: 'checkbox', label: '勿擾模式', checked: state.dnd, action: { type: 'toggle-dnd' } },
    { kind: 'checkbox', label: '通知音效', checked: state.soundEnabled, action: { type: 'toggle-sound' } },
    { kind: 'normal', label: '進階設定…', action: { type: 'open-settings' } },
    { kind: 'separator' },
    { kind: 'normal', label: '通知中心', action: { type: 'open-center' } },
    { kind: 'separator' },
    {
      kind: 'normal',
      label: canClose ? '關閉這隻寵物' : '關閉這隻寵物（至少保留一隻）',
      enabled: canClose,
      action: { type: 'close-pet' },
    },
    { kind: 'normal', label: '關閉小幫手', action: { type: 'quit' } },
  ]
}
