import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB } from '@/lib/idb';
import { setActiveVault } from '@/lib/vault/active';
import { getArchiveStory, saveArchiveStory, updateArchiveStory, saveRoleplayPreferences } from '@/lib/archive-db';
import { emptyFrontend, frontendSnapshot, importFrontendFile, newHtmlRule } from '@/lib/frontend-workbench';
import { loadFrontend, saveFrontend, persistFrontendScriptData } from '@/lib/frontend-workbench-store';
import { beginStoryGeneration } from '@/lib/story-activity';
import { frontendScripts, withoutFrontendScripts } from '@/lib/roleplay/frontend-scripts';
import type { ArchiveStory } from '@/types/archive';

beforeEach(async () => {
  closeDB(); setActiveVault(null); globalThis.indexedDB = new IDBFactory();
  const session = { id: 'session', title: '故事', user: { name: '我' }, character: { name: '角色' }, createdAt: 1,
    messages: [{ id: 'm', role: 'assistant' as const, content: '回复', rawData: { swipe_id: 0, swipes: ['回复', '候选'], variables: [{ stat_data: { score: 1 } }, { stat_data: { score: 2 } }] } }] };
  await saveArchiveStory({ id: 's', title: '故事', session, markers: [], createdAt: 1, updatedAt: 1, meta: { modelsUsed: [], playTimeMs: null },
    branches: [{ id: 'b', name: '支线', session: { ...session, id: 'branch' }, markers: [], createdAt: 1, updatedAt: 1 }] } satisfies ArchiveStory);
});
describe('finished frontend work copies', () => {
  it('ignores unrelated automatic Tavern UI settings while still protecting helper switches', async () => {
    const loaded = await loadFrontend('s', null), draft = { ...emptyFrontend(), rules: [newHtmlRule('<div>1</div>', '状态栏')] };
    await saveRoleplayPreferences({ tavern: { uiMode: 'changed by Tavern after navigation' } });
    const baseline = await saveFrontend('s', null, draft, loaded.text, loaded.revision, 'apply');
    await saveRoleplayPreferences({ tavern: { extension_settings: { tavern_helper: { script: { enabled: { global: false } } } } } });
    await expect(saveFrontend('s', null, draft, baseline, loaded.revision, 'apply')).rejects.toThrow('已变化');
  });
  it('keeps draft separate from applied content, branches and story variables', async () => {
    const before = await getArchiveStory('s');
    const loaded = await loadFrontend('s', null), draft = { ...emptyFrontend(), rules: [newHtmlRule('<div>1</div>', '状态栏')] };
    const originalHtml = draft.rules[0].script.replaceString;
    expect(originalHtml).toContain('<!DOCTYPE html>');
    const baseline = await saveFrontend('s', null, draft, loaded.text, loaded.revision, 'draft');
    expect((await loadFrontend('s', null)).state.applied).toBeNull();
    const applied = await saveFrontend('s', null, draft, baseline, loaded.revision, 'apply');
    draft.rules[0].script.replaceString = '<div>2</div>';
    const later = await saveFrontend('s', null, draft, applied, loaded.revision, 'draft');
    expect((await loadFrontend('s', null)).state.applied?.rules[0].script.replaceString).toBe(originalHtml);
    expect((await loadFrontend('s', 'b')).state.draft.rules).toEqual([]);
    await saveFrontend('s', null, draft, later, loaded.revision, 'remove');
    expect((await loadFrontend('s', null)).state.applied).toBeNull();
    expect(await getArchiveStory('s')).toEqual(before);
  });
  it('preserves a draft but rejects apply after a chat changed or while generating', async () => {
    const loaded = await loadFrontend('s', null);
    await updateArchiveStory('s', story => ({ session: { ...story.session, title: 'changed' } }));
    const baseline = await saveFrontend('s', null, loaded.state.draft, loaded.text, loaded.revision, 'draft');
    await expect(saveFrontend('s', null, loaded.state.draft, baseline, loaded.revision, 'apply')).rejects.toThrow('已变化');
    const release = beginStoryGeneration('s');
    await expect(saveFrontend('s', null, loaded.state.draft, baseline, loaded.revision, 'draft')).rejects.toThrow('正在生成');
    release();
  });
  it('rejects stale work copies and never silently executes imported scripts', async () => {
    const loaded = await loadFrontend('s', null);
    const draft = importFrontendFile(emptyFrontend(), 'script.json', JSON.stringify({ type: 'script', name: '示例', enabled: true, content: '1' }));
    expect(draft.scripts[0].enabled).toBe(false);
    const baseline = await saveFrontend('s', null, draft, loaded.text, loaded.revision, 'draft');
    await expect(saveFrontend('s', null, draft, loaded.text, loaded.revision, 'draft')).rejects.toThrow('已在其他位置修改');
    draft.scripts[0].enabled = true;
    await expect(saveFrontend('s', null, draft, baseline, loaded.revision, 'apply')).rejects.toThrow('原版酒馆助手');
  });
  it('keeps candidate snapshots separate and does not alias the saved variable object', async () => {
    const session = (await getArchiveStory('s'))!.session;
    const first = frontendSnapshot(session, 0, 0), second = frontendSnapshot(session, 0, 1);
    expect(first.data).toEqual({ stat_data: { score: 1 } }); expect(second.data).toEqual({ stat_data: { score: 2 } });
    second.data.stat_data.score = 99;
    expect(frontendSnapshot(session, 0, 1).data.stat_data.score).toBe(2);
    expect(frontendSnapshot(session, 0, 2).data).toEqual({});
  });
  it('retains regex order, scope, unknown fields and round trips an exported work copy', () => {
    const scripts = [1, 2].map(i => ({ id: String(i), scriptName: String(i), findRegex: '.', replaceString: '<div />', placement: [2, 5], minDepth: 3, future: { keep: true } }));
    const draft = importFrontendFile(emptyFrontend(), 'card.json', JSON.stringify({ data: { extensions: { regex_scripts: scripts } } }));
    expect(draft.rules.map(r => r.script)).toEqual(scripts);
    expect(importFrontendFile(emptyFrontend(), 'copy.json', JSON.stringify(draft))).toEqual(draft);
  });
  it('isolates original helper identities across branches and strips only its temporary runtime scripts', () => {
    const draft = importFrontendFile(emptyFrontend(), 'script.js', '1'); draft.scripts[0].enabled = true;
    const main = frontendScripts(draft, 'main'), branch = frontendScripts(draft, 'branch');
    expect(main[0].id).not.toBe(branch[0].id);
    expect(withoutFrontendScripts([{ id: 'ordinary' }, ...main])).toEqual([{ id: 'ordinary' }]);
  });
  it('stores original helper script variables in the applied branch copy without overwriting the draft', async () => {
    const draft = importFrontendFile(emptyFrontend(), 'script.js', '1'); draft.scripts[0].enabled = true;
    const { createRuntimeStore } = await import('@/lib/roleplay/runtime-store');
    const { frontendPath } = await import('@/lib/frontend-workbench-store');
    await createRuntimeStore('s').write(frontendPath(null), JSON.stringify({ schema: 1, draft, applied: draft }));
    const projected = frontendScripts(draft, 'main'); projected[0].data = { count: 2 };
    await persistFrontendScriptData('s', null, 'main', [{ id: 'folder', scripts: projected }]);
    const loaded = await loadFrontend('s', null);
    expect(loaded.state.applied?.scripts[0].data).toEqual({ count: 2 });
    expect(loaded.state.draft.scripts[0].data).toEqual({});
    // Reapplying a layout edit keeps the previously saved script state.
    const changed = structuredClone(loaded.state.draft); changed.scripts[0].enabled = false;
    changed.rules.push(newHtmlRule('<div>新版布局</div>', 'layout'));
    await saveFrontend('s', null, changed, loaded.text, loaded.revision, 'apply');
    expect((await loadFrontend('s', null)).state.applied?.scripts[0].data).toEqual({ count: 2 });
    await persistFrontendScriptData('s', 'b', 'branch', projected);
    expect((await loadFrontend('s', 'b')).state.applied).toBeNull();
  });
});
