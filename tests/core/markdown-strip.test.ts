import { describe, it, expect } from 'vitest'
import { stripMarkdown } from '../../src/core/markdown-strip'

describe('stripMarkdown', () => {
  it('空字串', () => {
    expect(stripMarkdown('')).toBe('')
  })

  it('純文字不變', () => {
    expect(stripMarkdown('Hello world')).toBe('Hello world')
  })

  it('bold **text** 去星號', () => {
    expect(stripMarkdown('this is **bold** text')).toBe('this is bold text')
  })

  it('italic *text* 去星號（不影響 bold）', () => {
    expect(stripMarkdown('an *italic* word')).toBe('an italic word')
  })

  it('inline code `code` 去 backtick', () => {
    expect(stripMarkdown('use `npm run dev` to start')).toBe('use npm run dev to start')
  })

  it('code fence ``` 整段保留內容', () => {
    expect(stripMarkdown('see:\n```js\nconst x = 1\n```\nend')).toBe('see:\nconst x = 1\nend')
  })

  it('heading # 去井號', () => {
    expect(stripMarkdown('# Title\nbody')).toBe('Title\nbody')
    expect(stripMarkdown('### Sub')).toBe('Sub')
  })

  it('bulleted list 去前綴', () => {
    expect(stripMarkdown('- a\n- b\n- c')).toBe('a\nb\nc')
    expect(stripMarkdown('* x\n* y')).toBe('x\ny')
  })

  it('numbered list 去前綴', () => {
    expect(stripMarkdown('1. first\n2. second')).toBe('first\nsecond')
  })

  it('連結 [text](url) → text', () => {
    expect(stripMarkdown('see [docs](https://example.com)')).toBe('see docs')
  })

  it('圖片 ![alt](url) → alt', () => {
    expect(stripMarkdown('![logo](pic.png)')).toBe('logo')
  })

  it('blockquote > 去箭頭', () => {
    expect(stripMarkdown('> quoted text')).toBe('quoted text')
  })

  it('horizontal rule --- 整行刪除', () => {
    expect(stripMarkdown('above\n---\nbelow')).toBe('above\n\nbelow')
  })

  it('多重格式組合：commit message 風格', () => {
    const input = '## 摘要\n- 修了 `foo()` bug\n- 加 **新功能** [連結](http://x)\n\n```\ndetail\n```'
    expect(stripMarkdown(input)).toBe('摘要\n修了 foo() bug\n加 新功能 連結\n\ndetail')
  })

  it('連續空行壓成最多兩個 \\n', () => {
    expect(stripMarkdown('a\n\n\n\nb')).toBe('a\n\nb')
  })

  it('頭尾 trim', () => {
    expect(stripMarkdown('   hello   ')).toBe('hello')
  })

  it('表格列整列略過（不進預覽）', () => {
    const input = '測試結果如下：\n\n| 檔案 | 狀態 |\n| --- | --- |\n| foo.ts | 通過 |\n\n詳見上表。'
    expect(stripMarkdown(input)).toBe('測試結果如下：\n\n詳見上表。')
  })
})
