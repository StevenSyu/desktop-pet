import { existsSync, readFileSync } from 'node:fs'

/**
 * 從 Claude Code transcript（JSONL）中取「最後一段 assistant 純文字回覆」。
 * 用於 Stop hook：把 Claude 真正回的內容當作卡片 body，而不是固定字串。
 *
 * - 從檔尾往前掃：第一個 type=assistant 且 message.content 含 text block 的就用。
 *   （如果最後是 tool_use 結尾，會略過直到找到帶 text 的 assistant 訊息。）
 * - 多個 text block 以 \n 串接、頭尾 trim。
 * - 檔不存在／讀檔失敗／JSON 壞行 → 略過該行 / 整體回 ''。
 *
 * 純函式（無 side effect）；可測。
 *
 * @param {string | undefined} transcriptPath
 * @returns {string}
 */
export function extractLastAssistantText(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return ''
  let raw
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return ''
  }
  const lines = raw.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (obj?.type !== 'assistant') continue
    const content = obj?.message?.content
    if (!Array.isArray(content)) continue
    const texts = content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text.trim())
      .filter(Boolean)
    if (texts.length > 0) return texts.join('\n').trim()
  }
  return ''
}
