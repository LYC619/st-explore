import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';

describe('chat Markdown display', () => {
  it('restores individual reading paragraphs for single newlines without breaking inline Markdown', () => {
    const root = document.createElement('div');
    root.innerHTML = renderToStaticMarkup(<ChatMarkdown text={'第一段\n**第二段\n第三段**\n\n第四段\n\n- 列表\n  续行\n\n```text\n代码一\n代码二\n```'} />);
    const paragraphs = [...root.querySelectorAll('.chat-markdown > .reading-paragraph')];
    expect(paragraphs.map(p => p.textContent)).toEqual(['第一段', '第二段', '第三段', '第四段']);
    expect(paragraphs[1].querySelector('strong')?.textContent).toBe('第二段');
    expect(paragraphs[2].querySelector('strong')?.textContent).toBe('第三段');
    expect(root.querySelector('li .reading-paragraph')).toBeNull();
    expect(root.querySelector('pre')?.textContent).toContain('代码一\n代码二');
  });
  it('renders Markdown and spoken dialogue while retaining search highlights', () => {
    const html = renderToStaticMarkup(<ChatMarkdown text={'**她说**：“你好。”\n\n*动作*\n\n- 第一项\n- 第二项'} search="你好" />);
    expect(html).toContain('<strong>她说</strong>'); expect(html).toContain('<em>动作</em>'); expect(html).toContain('<ul>');
    expect(html).toContain('chat-dialogue'); expect(html).toContain('<mark class="chat-search-hit" data-search-match="true">你好</mark>');
  });
  it('preserves fenced code without dialogue styling and removes active HTML', () => {
    const html = renderToStaticMarkup(<ChatMarkdown text={'```js\n"quoted"\n```\n<script>alert(1)</script><img src="x" onerror="bad()"><a href="javascript:bad()">link</a>'} />);
    expect(html).toContain('<pre><code'); expect(html).not.toContain('chat-dialogue');
    expect(html).not.toContain('<script'); expect(html).not.toContain('onerror'); expect(html).not.toContain('javascript:');
  });
});
