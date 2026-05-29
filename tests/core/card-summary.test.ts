import { describe, it, expect } from 'vitest'
import { cardSummary } from '../../src/core/card-summary'

describe('cardSummary', () => {
  it('單行短內容 → 原文、hasMore=false', () => {
    expect(cardSummary('完成任務')).toEqual({ text: '完成任務', hasMore: false })
  })
  it('多行 → 取第一非空行、hasMore=true', () => {
    expect(cardSummary('第一行\n第二行')).toEqual({ text: '第一行', hasMore: true })
  })
  it('純空白/只有換行 → 空字串、hasMore=false', () => {
    expect(cardSummary('   \n  ')).toEqual({ text: '', hasMore: false })
  })
  it('首行超長無句號 → 硬切 60 + …、hasMore=true', () => {
    const long = 'a'.repeat(80)
    const r = cardSummary(long)
    expect(r.text).toBe('a'.repeat(60) + '…')
    expect(r.hasMore).toBe(true)
  })
  it('首行超長含句號（句號在 60 內）→ 切到句號、hasMore=true', () => {
    const body = 'x'.repeat(40) + '。' + 'y'.repeat(40)
    const r = cardSummary(body)
    expect(r.text).toBe('x'.repeat(40) + '。')
    expect(r.hasMore).toBe(true)
  })
  it('正規化 CRLF', () => {
    expect(cardSummary('一\r\n二')).toEqual({ text: '一', hasMore: true })
  })
})
