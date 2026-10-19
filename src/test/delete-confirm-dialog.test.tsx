import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { buildCharacterFromCard } from '@/lib/archive-db';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; setActiveVault(null); });
async function render(onConfirm: (options: { deleteFiles: boolean }) => void | Promise<void>, onOpenChange = vi.fn()) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<DeleteConfirmDialog open title="删除角色？" description="故事保留。" fileTarget={{ store: 'characters', id: 'char' }} onConfirm={onConfirm} onOpenChange={onOpenChange} />));
  return onOpenChange;
}
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent === label)!;
  expect(button).toBeDefined(); await act(async () => button.click());
}
async function fileVault() {
  const vault = createVault(createMemFs()); setActiveVault(vault);
  await vault.repo('characters').put({ ...buildCharacterFromCard({ name: '角色' }), id: 'char' });
}

describe('删除文件选项', () => {
  it('文件库默认保留原件，确认明确传递 false', async () => {
    await fileVault(); const confirm = vi.fn(); await render(confirm);
    const box = document.querySelector<HTMLInputElement>('input[type=checkbox]');
    expect(box).not.toBeNull(); expect(box!.checked).toBe(false);
    await click('确认删除'); expect(confirm).toHaveBeenCalledWith({ deleteFiles: false });
  });
  it('勾选删除文件后传递 true', async () => {
    await fileVault(); const confirm = vi.fn(); await render(confirm);
    await act(async () => document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
    await click('确认删除'); expect(confirm).toHaveBeenCalledWith({ deleteFiles: true });
  });
  it('浏览器模式没有文件复选框，失败时保留弹窗并显示原因', async () => {
    const changed = await render(async () => { throw new Error('磁盘拒绝'); });
    expect(document.querySelector('input[type=checkbox]')).toBeNull();
    await click('确认删除');
    expect(changed).not.toHaveBeenCalledWith(false);
    expect(document.querySelector('[role=alert]')).toHaveTextContent('磁盘拒绝');
  });
});
