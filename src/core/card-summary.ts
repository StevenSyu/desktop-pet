export interface CardSummary {
  text: string
  hasMore: boolean
}

const MAX = 60

/** 卡片首段精簡。輸入須為已 stripMarkdown 的純文字。 */
export function cardSummary(plain: string): CardSummary {
  const normalizedFull = plain.replace(/\r\n?/g, '\n').trim()
  if (normalizedFull === '') return { text: '', hasMore: false }

  const firstLine = (normalizedFull.split('\n').find((l) => l.trim() !== '') ?? '').trim()
  let text = firstLine
  if (text.length > MAX) {
    const period = text.indexOf('。')
    if (period >= 0 && period + 1 <= MAX) {
      text = text.slice(0, period + 1)
    } else {
      text = text.slice(0, MAX) + '…'
    }
  }
  return { text, hasMore: text !== normalizedFull }
}
