/**
 * 言外 · 极简 markdown 渲染器
 *
 * 后端综合器 (synthesize) 输出 markdown,前端无 bundler、不引第三方库,这里手写一份
 * 最小、安全的 markdown → HTML。只覆盖综合器实际会用到的标记:标题、列表、引用、
 * 加粗、斜体、链接、行内代码、段落换行。
 *
 * 安全是硬约束:先把原文做 HTML 转义,再套 markdown 标记;绝不透传任何裸 HTML,
 * 防止模型生成的内容注入 <script>/<img onerror> 等 XSS 载荷。
 */

/** HTML 转义:处理 < > & ",其余字符(包括 markdown 标记)原样保留。 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 链接只放行 http/https,其余协议(如 javascript:)直接降级为纯文本。 */
function safeUrl(raw: string): string | null {
  return /^https?:\/\//i.test(raw) ? raw : null;
}

/**
 * 行内标记。入参是已经 HTML 转义过的文本(不含裸 < > & ")。
 * 顺序:先代码,再链接,再加粗,再斜体——保证代码里的 * / [ ] 不被误套标记。
 */
function renderInline(escaped: string): string {
  let out = escaped;

  // 行内代码
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 链接 [文本](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, raw: string) => {
    const url = safeUrl(raw);
    if (!url) return label;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // 加粗 **text**
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // 斜体 *text*
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  return out;
}

/**
 * 把一段 markdown 文本渲染成 HTML 字符串。逐行处理块级结构,行内交给 renderInline。
 * 返回的 HTML 已全程转义 + 白名单链接,可直接赋给 innerHTML。
 */
export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === '') {
      closeList();
      continue;
    }

    // 标题 # / ##
    const heading = /^(#{1,2})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    // 引用 >
    if (line.startsWith('>')) {
      closeList();
      const content = line.replace(/^>\s?/, '');
      html.push(`<blockquote>${renderInline(escapeHtml(content))}</blockquote>`);
      continue;
    }

    // 列表 - / *
    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      const content = line.replace(/^[-*]\s+/, '');
      html.push(`<li>${renderInline(escapeHtml(content))}</li>`);
      continue;
    }

    // 段落
    closeList();
    html.push(`<p>${renderInline(escapeHtml(line))}</p>`);
  }

  closeList();
  return html.join('');
}
