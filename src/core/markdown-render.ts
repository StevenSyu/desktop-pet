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

// 表格列：trim 後以 | 開頭。分隔列：只由 | : - 空白組成且含 - 與 |（如 | --- | --- |）。
function isTableRow(line: string): boolean {
  return line.trim().startsWith('|')
}
function isTableSep(line: string): boolean {
  const t = line.trim()
  return /^[|\s:-]+$/.test(t) && t.includes('-') && t.includes('|')
}
// 切出每格（去頭尾 |、以 | 分隔、trim），每格先 escape 再套 inline。
function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => inline(escapeHtml(c.trim())))
}

/**
 * 安全 Markdown→HTML。body 是外部不可信內容：先 escape，再套最小語法白名單。
 * 只產生無屬性標籤 <p><br><ul><li><strong><code><pre> 與表格
 * <table><thead><tbody><tr><th><td>；不支援連結/圖片/raw HTML。
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
    // 表格：目前行是表格列，且下一行是分隔列
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara()
      flushList()
      const header = splitCells(line)
      i += 2 // 跳過 header + 分隔列
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i]) && !isTableSep(lines[i])) {
        rows.push(splitCells(lines[i]))
        i++
      }
      const thead = '<thead><tr>' + header.map((c) => '<th>' + c + '</th>').join('') + '</tr></thead>'
      const tbody =
        '<tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') +
        '</tbody>'
      html.push('<table>' + thead + tbody + '</table>')
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
