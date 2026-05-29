import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../src/core/markdown-render'

describe('renderMarkdown — 安全跳脫', () => {
  it('HTML 特殊字元被跳脫', () => {
    expect(renderMarkdown('<b>&"\'')).toBe('<p>&lt;b&gt;&amp;&quot;&#39;</p>')
  })

  it('<script> 不可執行', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    )
  })

  it('img onerror 被中和為純文字', () => {
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    )
  })

  it('連結語法不產生 <a>（不支援連結）', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).toBe('<p>[x](javascript:alert(1))</p>')
  })
})

describe('renderMarkdown — 語法', () => {
  it('粗體', () => {
    expect(renderMarkdown('**hi**')).toBe('<p><strong>hi</strong></p>')
  })

  it('行內 code 內容仍跳脫', () => {
    expect(renderMarkdown('`<b>`')).toBe('<p><code>&lt;b&gt;</code></p>')
  })

  it('清單', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>')
  })

  it('段落內換行 → <br>', () => {
    expect(renderMarkdown('a\nb')).toBe('<p>a<br>b</p>')
  })

  it('fenced code：內部 ** 不被轉、內容跳脫', () => {
    expect(renderMarkdown('```\n<b>**x**\n```')).toBe('<pre><code>&lt;b&gt;**x**</code></pre>')
  })

  it('長輸入不卡死（ReDoS 防護）', () => {
    const startedAt = performance.now()
    const result = renderMarkdown('a'.repeat(100000))
    const elapsed = performance.now() - startedAt

    expect(result.startsWith('<p>')).toBe(true)
    expect(elapsed).toBeLessThan(500)
  })
})
