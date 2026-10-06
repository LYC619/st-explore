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
  // A single newline is a prose paragraph in the reader. Split sanitized DOM,
  // not Markdown source, so lists, fences, tables and nested emphasis survive.
  for (const paragraph of root.querySelectorAll(':scope > p')) {
    // Showdown leaves soft newlines inside emphasis as text instead of <br>.
    const textWalker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    const lines: Text[] = [];
    while (textWalker.nextNode()) {
      const node = textWalker.currentNode as Text;
      if (node.data.includes('\n') && !node.parentElement?.closest('code, pre')) lines.push(node);
    }
    for (const node of lines) {
      const parts = document.createDocumentFragment();
      node.data.split(/\r?\n/).forEach((line, index) => {
        if (index) parts.append(document.createElement('br'));
        parts.append(document.createTextNode(line));
      });
      node.replaceWith(parts);
    }
    const replacement = document.createDocumentFragment();
    const range = document.createRange();
    range.setStart(paragraph, 0);
    const appendParagraph = () => {
      const next = document.createElement('p');
      next.className = 'reading-paragraph';
      next.append(range.cloneContents());
      if (next.textContent?.trim() || next.querySelector('img')) replacement.append(next);
    };
    for (const br of paragraph.querySelectorAll('br')) {
      range.setEndBefore(br);
      appendParagraph();
      range.setStartAfter(br);
    }
    range.setEnd(paragraph, paragraph.childNodes.length);
    appendParagraph();
    paragraph.replaceWith(replacement);
  }
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
