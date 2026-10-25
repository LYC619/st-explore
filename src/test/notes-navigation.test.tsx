import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotesSection } from '@/components/character/NotesSection';
import type { CharacterNote } from '@/types/archive';
import { setCurrentVaultId } from '@/lib/vault/vault-scope';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
beforeEach(() => { localStorage.clear(); setCurrentVaultId(null); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; setCurrentVaultId(null); vi.restoreAllMocks(); });

it('builds a navigable note/heading directory from Markdown and keeps fenced headings out', async () => {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  Element.prototype.scrollIntoView = vi.fn();
  const body = '# 精彩片段\n\n**对白**\n\n## 再见\n\n第一处\n\n## 再见\n\n第二处\n\n```md\n# 代码不是目录\n```\n\n| 人物 | 内容 |\n| --- | --- |\n| 甲 | 乙 |\n\n[参考](https://example.com)\n<script>alert(1)</script>';
  await act(async () => root!.render(<NotesSection notes={[{ id: 'a', at: 1, body }, { id: 'b', at: 2, body: '另一篇备注' }]} onChange={async () => {}} />));
  const nav = host.querySelector('nav[aria-label="备注目录"]')!;
  expect(nav).not.toBeNull();
  expect(nav.textContent).toContain('没有小标题');
  expect(host.querySelector('h1')).toBeNull();
  const switcher = host.querySelector('nav[aria-label="切换备注"]')!;
  await act(async () => [...switcher.querySelectorAll('button')].find(node => node.textContent?.includes('精彩片段'))!.click());
  expect(switcher.querySelector('[aria-current="true"]')?.textContent).toContain('精彩片段');
  expect(nav.textContent).not.toContain('代码不是目录');
  const links = [...nav.querySelectorAll('button')].filter(node => node.textContent === '再见');
  expect(links).toHaveLength(2);
  await act(async () => links[1].click());
  const target = [...host.querySelectorAll('h2')].filter(node => node.textContent === '再见')[1];
  expect(document.activeElement).toBe(target);
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  expect(host.querySelectorAll('table')).toHaveLength(1);
  expect(host.querySelector('pre code')?.textContent).toContain('# 代码不是目录');
  expect(host.querySelector('script')).toBeNull();
  await act(async () => [...switcher.querySelectorAll('button')].find(node => node.textContent?.includes('另一篇备注'))!.click());
  expect(nav.textContent).not.toContain('再见');
  expect(host.querySelector('table')).toBeNull();
});

it('remembers the selected note per character and vault, and falls back after deletion', async () => {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  Element.prototype.scrollIntoView = vi.fn();
  const notes = [{ id: 'a', at: 1, body: '# 第一篇' }, { id: 'b', at: 2, body: '# 第二篇' }];
  const render = async (key: string, current = notes) => {
    await act(async () => root!.render(<NotesSection key={key} characterId="c1" notes={current} onChange={async () => {}} />));
  };
  setCurrentVaultId('one');
  await render('first');
  const selector = 'nav[aria-label="切换备注"] button';
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>(selector)].find(node => node.textContent?.includes('第一篇'))!.click());
  await render('reopen');
  expect(host.querySelector('h1')?.textContent).toBe('第一篇');
  setCurrentVaultId('two');
  await render('other-vault');
  expect(host.querySelector('h1')?.textContent).toBe('第二篇');
  setCurrentVaultId('one');
  await render('deleted', notes.filter(note => note.id !== 'a'));
  expect(host.querySelector('h1')?.textContent).toBe('第二篇');
});

it('previews, saves and reopens Markdown without changing the stored source', async () => {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  let stored: CharacterNote[] = [];
  function Harness() {
    const [notes, setNotes] = useState(stored);
    return <NotesSection notes={notes} onChange={async value => { stored = value; setNotes(value); }} />;
  }
  await act(async () => root!.render(<Harness />));
  const button = (label: string) => [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === label)!;
  await act(async () => button('新建备注').click());
  const source = '# 标题\n\n- **保留原文**\n- 第二项';
  await act(async () => {
    const textarea = document.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, source);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(button('预览')).toBeDefined();
  await act(async () => button('预览').click());
  expect(document.querySelector('[role="dialog"] strong')?.textContent).toBe('保留原文');
  await act(async () => button('保存').click());
  expect(stored[0].body).toBe(source);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="编辑备注"]')!.click());
  expect(document.querySelector('textarea')!.value).toBe(source);
});
