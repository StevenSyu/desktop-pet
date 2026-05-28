// 可選造型（pet skin）清單。main 用於右鍵選單、renderer 用於對應精靈圖。
// 三隻共用同一精靈格式（1536×1872、9 列），切換造型只需換背景圖。
export interface SkinInfo {
  id: string
  name: string
}

export const SKINS: SkinInfo[] = [
  { id: 'may', name: 'may' },
  { id: 'maruko', name: '丸子' },
  { id: 'oil-king-penguin', name: '厭世石油王' },
]

export const DEFAULT_SKIN_ID = 'may'
