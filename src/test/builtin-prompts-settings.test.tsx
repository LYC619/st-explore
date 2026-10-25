import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { BuiltinPromptsPanel } from '@/components/settings/BuiltinPromptsPanel';
import { buildIntroMessages } from '@/lib/character-ai';
import { normalizeCharacterCard } from '@/lib/png-parser';
import { getBuiltinPromptDefault } from '@/lib/builtin-prompts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; localStorage.clear(); sessionStorage.clear(); });
const button = (label: string, scope: ParentNode = host) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label)!;
const requestPrompt = () => buildIntroMessages({ norm: normalizeCharacterCard({ name: '角色' }) }).messages[0].content;

it('keeps a draft across module/navigation changes, applies only saved text, then restores the actual runtime default', async () => {
  await act(async () => root.render(<BuiltinPromptsPanel />));
  await act(async () => button('角色档案').click());
  await act(async () => button('档案简介').click());
  const editor = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="档案简介提示词"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor, '只写一段人物简介');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(requestPrompt()).toBe(getBuiltinPromptDefault('character.intro'));
  await act(async () => button('世界书').click());
  await act(async () => button('角色档案').click());
  await act(async () => button('档案简介').click());
  expect(host.querySelector('textarea')?.value).toBe('只写一段人物简介');
  await act(async () => root.render(<div>另一设置分区</div>));
  await act(async () => root.render(<BuiltinPromptsPanel />));
  await act(async () => button('角色档案').click());
  await act(async () => button('档案简介').click());
  expect(host.querySelector('textarea')?.value).toBe('只写一段人物简介');
  await act(async () => button('保存提示词').click());
  expect(requestPrompt()).toBe('只写一段人物简介');
  await act(async () => button('恢复默认').click());
  await act(async () => button('恢复默认', document.querySelector('[role="alertdialog"]')!).click());
  expect(requestPrompt()).toBe(getBuiltinPromptDefault('character.intro'));
  expect(host.querySelector('textarea')?.value).toBe(getBuiltinPromptDefault('character.intro'));
});
