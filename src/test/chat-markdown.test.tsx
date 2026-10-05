import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';

describe('chat Markdown display', () => {
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
