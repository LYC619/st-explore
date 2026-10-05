import { memo, useMemo } from 'react';
import showdown from 'showdown';
import DOMPurify from 'dompurify';

const converter = new showdown.Converter({ tables: true, strikethrough: true, simpleLineBreaks: true, noHeaderId: true, literalMidWordUnderscores: true });

function renderMessage(text: string, search: string): string {
  const root = document.createElement('div');
  root.innerHTML = DOMPurify.sanitize(converter.makeHtml(text), {
    USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button', 'video', 'audio'],
    FORBID_ATTR: ['style', 'id', 'name'],
  });
  for (const link of root.querySelectorAll('a')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  for (const img of root.querySelectorAll('img')) { img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const content = node.data;
    const fragment = document.createDocumentFragment();
    const quote = node.parentElement?.closest('pre, code') ? null : /“[^”\n]*”|「[^」\n]*」|『[^』\n]*』|"[^"\n]+"/g;
    const ranges = quote ? [...content.matchAll(quote)].map(m => [m.index!, m.index! + m[0].length]) : [];
    const query = search.toLocaleLowerCase();
    const hits: number[] = [];
    if (query) { const lower = content.toLocaleLowerCase(); let at = 0; while ((at = lower.indexOf(query, at)) !== -1) { hits.push(at); at += query.length; } }
    const cuts = [...new Set([0, content.length, ...ranges.flat(), ...hits.flatMap(at => [at, at + query.length])])].sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const start = cuts[i], end = cuts[i + 1];
      const hit = hits.some(at => at <= start && at + query.length >= end);
      const spoken = ranges.some(([a, b]) => a <= start && b >= end);
      if (!hit && !spoken) fragment.append(document.createTextNode(content.slice(start, end)));
      else {
        const span = document.createElement(hit ? 'mark' : 'span');
        span.className = hit ? 'chat-search-hit' : 'chat-dialogue';
        if (hit) span.dataset.searchMatch = 'true';
        span.textContent = content.slice(start, end); fragment.append(span);
      }
    }
    node.replaceWith(fragment);
  }
  return root.innerHTML;
}

/** Rendering is display-only: stored text and regex/edit/export paths keep the original Markdown. */
export const ChatMarkdown = memo(function ChatMarkdown({ text, search = '' }: { text: string; search?: string }) {
  const html = useMemo(() => renderMessage(text, search), [text, search]);
  return <div className="chat-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
});
