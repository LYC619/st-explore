import showdown from 'showdown';
import DOMPurify from 'dompurify';

const converter = new showdown.Converter({ tables: true, strikethrough: true, simpleLineBreaks: true, noHeaderId: true, literalMidWordUnderscores: true });

/** 目录和展示使用同一次 Markdown 解析；代码块中的 # 不会变成标题。原文不改写。 */
export function renderNoteMarkdown(text: string, prefix: string) {
  const root = document.createElement('div');
  root.innerHTML = DOMPurify.sanitize(converter.makeHtml(text), {
    USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button', 'video', 'audio'],
    FORBID_ATTR: ['style', 'id', 'name', 'tabindex'],
  });
  const headings = [...root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')].map((heading, index) => {
    heading.id = `${prefix}-h${index}`;
    heading.tabIndex = -1;
    heading.className = 'scroll-mt-4 truncate';
    heading.title = heading.textContent?.trim() || '未命名标题';
    return { id: heading.id, title: heading.textContent?.trim() || '未命名标题', level: Number(heading.tagName.slice(1)) };
  });
  for (const link of root.querySelectorAll('a')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  for (const img of root.querySelectorAll('img')) { img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; }
  const title = (headings[0]?.title || root.textContent?.trim() || '空备注').replace(/\s+/g, ' ');
  return { html: root.innerHTML, headings, title };
}
