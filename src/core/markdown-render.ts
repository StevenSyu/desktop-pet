function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 在「已跳脫」字串上套行內語法（` 與 * 不受跳脫影響，故安全）。
function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

/**
 * 安全 Markdown→HTML。body 是外部不可信內容：先 escape，再套最小語法白名單。
 * 只產生無屬性標籤 <p><br><ul><li><strong><code><pre>；不支援連結/圖片/raw HTML。
 * 行為基礎 parser，正則皆 bounded，避免 ReDoS。
 */
export function renderMarkdown(raw: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let para: string[] = []
  let list: string[] = []

  const flushPara = (): void => {
    if (para.length) {
      html.push('<p>' + para.join('<br>') + '</p>')
      para = []
    }
  }
  const flushList = (): void => {
    if (list.length) {
      html.push('<ul>' + list.map((li) => '<li>' + li + '</li>').join('') + '</ul>')
      list = []
    }
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trimStart().startsWith('```')) {
      flushPara()
      flushList()
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        code.push(lines[i])
        i++
      }
      i++ // 跳過收尾 ```
      html.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>')
      continue
    }
    const m = /^\s*[-*]\s+(.*)$/.exec(line)
    if (m) {
      flushPara()
      list.push(inline(escapeHtml(m[1])))
      i++
      continue
    }
    if (line.trim() === '') {
      flushPara()
      flushList()
      i++
      continue
    }
    flushList()
    para.push(inline(escapeHtml(line)))
    i++
  }
  flushPara()
  flushList()
  return html.join('')
}
