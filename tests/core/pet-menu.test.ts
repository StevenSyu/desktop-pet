import { describe, it, expect } from 'vitest'
import { petMenuTemplate, type PetMenuItem } from '../../src/core/pet-menu'

const base = { channelLabelMode: 'hover' as const, autoWalk: true, dnd: false, soundEnabled: true }

function flatten(items: PetMenuItem[]): PetMenuItem[] {
  return items.flatMap((it) => [it, ...(it.submenu ? flatten(it.submenu) : [])])
}

function byAction(items: PetMenuItem[], type: string): PetMenuItem {
  const found = flatten(items).find((it) => it.action?.type === type)
  if (!found) throw new Error(`no item with action ${type}`)
  return found
}

describe('petMenuTemplate', () => {
  it('名稱標籤 radio：恰好一個 checked，對應 channelLabelMode', () => {
    for (const mode of ['hidden', 'hover', 'always'] as const) {
      const items = petMenuTemplate({ ...base, channelLabelMode: mode }, 2)
      const radios = flatten(items).filter((it) => it.kind === 'radio')
      expect(radios).toHaveLength(3)
      const checked = radios.filter((it) => it.checked)
      expect(checked).toHaveLength(1)
      expect(checked[0].action).toEqual({ type: 'set-label-mode', mode })
    }
  })

  it('checkbox checked 鏡射 prefs：autoWalk／dnd／soundEnabled', () => {
    const items = petMenuTemplate({ ...base, autoWalk: false, dnd: true, soundEnabled: false }, 2)
    expect(byAction(items, 'toggle-auto-walk').checked).toBe(false)
    expect(byAction(items, 'toggle-dnd').checked).toBe(true)
    expect(byAction(items, 'toggle-sound').checked).toBe(false)
  })

  it('petCount 1 → 關閉這隻寵物 disabled ＋ 提示標籤（至少保留一隻）', () => {
    const item = byAction(petMenuTemplate(base, 1), 'close-pet')
    expect(item.enabled).toBe(false)
    expect(item.label).toBe('關閉這隻寵物（至少保留一隻）')
  })

  it('petCount 2 → 關閉這隻寵物 enabled', () => {
    const item = byAction(petMenuTemplate(base, 2), 'close-pet')
    expect(item.enabled).toBe(true)
    expect(item.label).toBe('關閉這隻寵物')
  })

  it('完整選單動作齊備（open-channels／open-settings／open-center／quit）', () => {
    const items = petMenuTemplate(base, 2)
    for (const t of ['open-channels', 'open-settings', 'open-center', 'quit']) {
      expect(byAction(items, t)).toBeDefined()
    }
  })
})
