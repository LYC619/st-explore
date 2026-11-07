import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { FileMaintenancePanel } from '@/components/settings/FileMaintenancePanel';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { buildCharacterFromCard, buildStoryFromSession, deleteCharacter } from '@/lib/archive-db';
import { scanVaultFiles, cleanupVaultFiles } from '@/lib/vault/file-maintenance';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; setActiveVault(null); });
const foreignFiles: Record<string, string> = {
  '资产/其他/SillyTavern/extensions/st-stage/docs/maintenance/CURRENT.md': '# 维护现状\n用户附件原文',
  '资产/其他/SillyTavern/extensions/st-stage/docs/maintenance/history/2026-10-31.md': '# 历史记录\n用户附件原文',
  '资产/其他/SillyTavern/extensions/st-stage/maintenance/broken.json': '{not json',
  '资产/其他/SillyTavern/extensions/st-stage/turns/broken.json': '{not json',
  '资产/其他/SillyTavern/extensions/st-stage/memory-journal/broken.json': '{not json',
  '资产/其他/SillyTavern/extensions/st-stage/inheritance.json': '{not json',
  '资产/其他/SillyTavern/extensions/st-stage/portrait-journal/broken.json': '{not json',
  '资产/其他/角色/c/故事/s/.ste-control/roleplay/main/maintenance/fake.json': '{not json',
  '备份/角色/c/故事/s/.ste-control/roleplay/main/maintenance/fake.json': '{not json',
};
async function seedForeignAssets() {
  const fs = createMemFs(), vault = createVault(fs); setActiveVault(vault);
  await vault.repo('characters').put({ ...buildCharacterFromCard({ name: '测试角色' }), id: 'c' });
  for (const [path, text] of Object.entries(foreignFiles)) await fs.writeText(path, text);
  return { fs, vault };
}
async function render(node: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(node));
}
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent === label)!;
  expect(button).toBeDefined(); await act(async () => button.click());
}

it('scans maintenance-named external assets as unknown without parsing or making them selectable', async () => {
  const { fs, vault } = await seedForeignAssets();
  const read = fs.readText.bind(fs), externalReads: string[] = [];
  fs.readText = async path => { if (path.startsWith('资产/其他/')) externalReads.push(path); return read(path); };
  const scan = await scanVaultFiles(vault);
  expect(scan.errors).toEqual([]);
  expect(scan.complete).toBe(true);
  expect(externalReads).toEqual([]);
  for (const path of Object.keys(foreignFiles)) expect(scan.entries.find(e => e.path === path)).toMatchObject({ category: 'unknown', selectable: false });
  const clean = await cleanupVaultFiles(scan, Object.keys(foreignFiles));
  expect(clean.removed).toEqual([]);
  for (const [path, text] of Object.entries(foreignFiles)) expect(await fs.readText(path)).toBe(text);
});

it('deletes a character through the real confirmation dialog despite foreign maintenance Markdown and preserves those assets', async () => {
  const { fs, vault } = await seedForeignAssets();
  let removed = false;
  await render(<DeleteConfirmDialog open title="删除测试角色？" description="角色删除复现" fileTarget={{ store: 'characters', id: 'c' }} onOpenChange={() => {}} onConfirm={async options => { await deleteCharacter('c', options); removed = true; }} />);
  await click('确认删除');
  expect(removed).toBe(true);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(await vault.repo('characters').get('c')).toBeUndefined();
  for (const [path, text] of Object.entries(foreignFiles)) expect(await fs.readText(path)).toBe(text);
});

it.each(['maintenance', 'turns', 'memory-updates', 'memory-journal'])('still blocks malformed real story %s recovery records', async directory => {
  const { fs, vault } = await seedForeignAssets();
  const story = { ...buildStoryFromSession({ id: 'session', title: '故事', messages: [], character: { name: '角色' }, user: { name: '我' }, createdAt: 1 }), id: 's' };
  await vault.repo('archiveStories').put(story);
  const path = `${await vault.pathOf('archiveStories', 's')}/.ste-control/roleplay/main/${directory}/${'a'.repeat(64)}.json`;
  await fs.writeText(path, '{bad runtime json');
  const scan = await scanVaultFiles(vault);
  expect(scan.complete).toBe(false);
  expect(scan.errors.some(error => error.startsWith(path + ':'))).toBe(true);
  expect(scan.entries.every(entry => !entry.selectable)).toBe(true);
});

it('lets settings inspect and select real cleanup entries while external source-tree files remain read-only', async () => {
  const { fs, vault } = await seedForeignAssets();
  await fs.mkdir('空目录');
  await render(<FileMaintenancePanel />);
  await click('检查文件');
  expect(document.querySelector('[role="alert"]')).toBeNull();
  const choose = [...document.querySelectorAll('button')].find(b => b.textContent === '选择可清理项')!;
  expect(choose.disabled).toBe(false);
  await act(async () => choose.click());
  const selected = [...document.querySelectorAll('button')].find(b => b.textContent?.startsWith('清理已选'))!;
  expect(selected.disabled).toBe(false);
  expect(selected.textContent).toContain('1 项');
  expect((await scanVaultFiles(vault)).complete).toBe(true);
  await act(async () => selected.click());
  await click('确认清理');
  expect((await fs.stat('空目录')).exists).toBe(false);
  expect(document.querySelector('[role="status"]')?.textContent).toContain('成功 1 项');
  for (const [path, text] of Object.entries(foreignFiles)) expect(await fs.readText(path)).toBe(text);
});

it('keeps long settings error lists collapsed and retry available', async () => {
  const { fs, vault } = await seedForeignAssets();
  await vault.repo('archiveStories').put({ ...buildStoryFromSession({ id: 'session', title: '故事', messages: [], character: { name: '角色' }, user: { name: '我' }, createdAt: 1 }), id: 's' });
  for (let i = 0; i < 30; i++) await fs.writeText(`临时/故事/.ste-control/roleplay/main/maintenance/${i.toString(16).padStart(64, '0')}.json`, '{bad');
  await render(<FileMaintenancePanel />);
  await click('检查文件');
  const alert = document.querySelector('[role="alert"]')!;
  const errors = alert.querySelector('details')!;
  expect(errors).not.toBeNull();
  expect(errors.open).toBe(false);
  expect(errors.querySelector('summary')?.textContent).toContain('30');
  const retry = [...document.querySelectorAll('button')].find(b => b.textContent === '检查文件')!;
  expect(retry.disabled).toBe(false);
});


it('still blocks malformed inheritance and orphaned runtime journals in STE story control directories', async () => {
  const { fs, vault } = await seedForeignAssets();
  const inheritance = '临时/遗留故事/.ste-control/roleplay/branch-branch1/inheritance.json';
  const orphaned = `角色/已移除角色/故事/遗留故事/.ste-control/roleplay/main/turns/${'b'.repeat(64)}.json`;
  for (const path of [inheritance, orphaned]) await fs.writeText(path, '{bad runtime');
  const scan = await scanVaultFiles(vault);
  expect(scan.complete).toBe(false);
  for (const path of [inheritance, orphaned]) expect(scan.errors.some(error => error.startsWith(path + ':'))).toBe(true);
});

it('still reports real portrait control journals without treating source-tree portrait-journal docs as recovery state', async () => {
  const { fs, vault } = await seedForeignAssets();
  const path = '角色/测试角色/.ste-control/portrait-journal/broken.json';
  await fs.writeText(path, '{broken');
  const scan = await scanVaultFiles(vault);
  expect(scan.complete).toBe(false);
  expect(scan.errors).toEqual([`${path}: 立绘操作需要先完成恢复`]);
});

it('keeps long deletion errors collapsed with cancellation available', async () => {
  await seedForeignAssets();
  await render(<DeleteConfirmDialog open title="删除测试角色？" description="长错误复现" fileTarget={{ store: 'characters', id: 'c' }} onOpenChange={() => {}} onConfirm={async () => { throw new Error('真实恢复记录需要处理。'.repeat(50)); }} />);
  await click('确认删除');
  const details = document.querySelector('[role="alert"] details') as HTMLDetailsElement;
  expect(details).not.toBeNull();
  expect(details.open).toBe(false);
  expect([...document.querySelectorAll('button')].find(button => button.textContent === '取消')?.disabled).toBe(false);
});
