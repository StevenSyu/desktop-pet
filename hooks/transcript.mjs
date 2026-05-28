import { existsSync, readFileSync } from 'node:fs'

/**
 * 從 Claude Code transcript（JSONL）中取「當輪 Claude 的所有純文字回覆」。
 *
 * 用於 Stop hook：把 Claude 真正回的內容當作卡片 body，而不是固定字串。
 *
 * # 為什麼要區分「當輪」
 *
 * 一輪內 Claude 會產生多筆 entry：thinking / text / tool_use / tool_result（後者
 * 雖然是 type=user，但是 content 為 tool_result block，不是使用者打字的字串）。
 * 如果單純從尾巴往前找「第一個帶 text 的 assistant」，當該輪的最後 entry 是
 * `thinking` 或 `tool_use`（沒有 text wrap-up），會跨越輪邊界抓到「上一次完成的訊息」。
 *
 * # 演算法
 *
 * 1. 從檔尾往前掃。
 * 2. 跳過 sidechain（Task 子代理）的 entry，避免混入主對話。
 * 3. 收集 assistant entry 內所有 text content block 的文字。
 * 4. 一旦遇到「使用者打字的 user entry」（content 是 string，或 array 裡有非
 *    tool_result 的內容），即視為「上一輪的結尾」，停止收集。
 * 5. 反向後以 \n 串接、頭尾 trim 回傳。
 * 6. 檔不存在 / 讀檔失敗 / JSON 壞行 → 略過 / 回 ''。
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
    // 排除 Task 子代理（subagent）：他們的 assistant 訊息不算主對話
    if (obj?.isSidechain === true) continue

    // 撞到當輪起點（使用者打字訊息）→ 停。當輪沒有 text 就讓 caller 用 default。
    if (obj?.type === 'user' && isUserTypedMessage(obj)) return ''

    if (obj?.type !== 'assistant') continue
    const content = obj?.message?.content
    if (!Array.isArray(content)) continue
    // 該 entry 內所有 text block 用 \n 串接（保留 content 內順序）
    const texts = content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text.trim())
      .filter(Boolean)
    if (texts.length > 0) return texts.join('\n').trim()
  }
  return ''
}

/**
 * async 版本：第一次抓不到就稍等再試（最多 retries 次）。
 *
 * 用途：Claude Code 寫 transcript JSONL 跟觸發 Stop hook 之間存在 flush race
 * ——hook 可能在最後一筆 assistant entry 落盤前就讀檔。給一個短暫的 retry
 * 窗口（預設 3 次 × 100ms = 300ms）讓 disk 跟上。
 *
 * @param {string | undefined} transcriptPath
 * @param {{ retries?: number, delayMs?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function extractLastAssistantTextWithRetry(
  transcriptPath,
  { retries = 3, delayMs = 100 } = {},
) {
  for (let i = 0; i <= retries; i++) {
    const text = extractLastAssistantText(transcriptPath)
    if (text) return text
    if (i < retries) {
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  return ''
}

/**
 * 判斷一個 type=user 的 entry 是不是「使用者實際打字的訊息」（而非 tool_result）。
 *
 * - content 是 string → 是打字訊息
 * - content 是 array 且任一 block 非 tool_result → 是打字訊息（包含 image、text）
 * - content 是 array 且全部都是 tool_result → 不是打字，是工具回應
 */
function isUserTypedMessage(obj) {
  const content = obj?.message?.content
  if (typeof content === 'string') return true
  if (!Array.isArray(content)) return false
  return content.some((c) => c && c.type !== 'tool_result')
}
