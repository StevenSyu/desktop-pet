/**
 * 把常見 markdown 格式符號剝除，回 plain text 給 UI 顯示。
 *
 * 卡片 body 只有 2 行，markdown 符號（**、`、#、-、[]() ...）會吃掉視覺空間，
 * 真正內容看不到——所以顯示前先 strip。
 *
 * 處理項目：
 * - bold/italic（*、_、**、__）→ 去符號保留內容
 * - inline/fenced code（`、```）→ 去符號保留內容
 * - heading（#、##、###...）→ 去 # 與空白
 * - 列表前綴（-、*、+、1. 2. ...）→ 去前綴
 * - blockquote（>）→ 去箭頭
 * - 連結 [text](url) → text；圖片 ![alt](url) → alt
 * - 水平線（--- *** ___）→ 空行
 * - 連續空行壓成單一空行
 * - 頭尾 trim
 *
 * 純函式、可測。
 */
export function stripMarkdown(input: string): string {
  if (!input) return ''
  let text = input

  // 1. Code fence（多行 ``` ... ```）：保留內容、去 fence；連同 fence 行尾 \n 一起吃掉
  text = text.replace(/```[\w-]*\n?([\s\S]*?)```\n?/g, '$1')

  // 2. 圖片 ![alt](url) → alt
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')

  // 3. 連結 [text](url) → text
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')

  // 4. Inline code `code` → code
  text = text.replace(/`([^`]+)`/g, '$1')

  // 5. Bold **text** / __text__
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')

  // 6. Italic *text* / _text_（lookarounds 避免影響 bold 與單字內 _）
  text = text.replace(/(?<!\*)\*(?!\*)([^*\n]+)\*(?!\*)/g, '$1')
  text = text.replace(/(?<![_\w])_(?!_)([^_\n]+)_(?![_\w])/g, '$1')

  // 7. Heading # / ## / ###...
  text = text.replace(/^#{1,6}\s+/gm, '')

  // 8. 列表前綴（- * + 1. 2. ...）
  text = text.replace(/^\s*[-*+]\s+/gm, '')
  text = text.replace(/^\s*\d+\.\s+/gm, '')

  // 9. Blockquote >
  text = text.replace(/^>\s?/gm, '')

  // 10. 水平線整行刪除
  text = text.replace(/^[-*_]{3,}\s*$/gm, '')

  // 11. 連續空行（≥3 個 \n）壓成 2 個（= 一個空行）
  text = text.replace(/\n{3,}/g, '\n\n')

  return text.trim()
}
