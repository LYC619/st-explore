import { afterEach, beforeEach, expect, it } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { getCurrentRepo } from '@/lib/repo';
import { parsePreset } from '@/lib/preset-parser';
import { createTavernHost } from '@/lib/roleplay/tavern-host';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import type { PresetItem } from '@/types/preset';
beforeEach(() => { localStorage.clear(); setActiveVault(createVault(createMemFs())); });
afterEach(() => setActiveVault(null));
it('reopening a story using a factory preset restores its content after another story saved a managed preset', async () => {
  const raw = (text: string) => ({ prompts: [{ identifier: 'main', role: 'system', content: text }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }] });
  const factory = { ...raw('FACTORY_SYNTHETIC'), openai_max_context: 8192 };
  const managed = { ...raw('MANAGED_SYNTHETIC'), assistant_prefill: 'STALE_SYNTHETIC', openai_max_context: 64000 };
  const defaults = { settings: { oai_settings: { ...raw('BASE_SYNTHETIC'), preset_settings_openai: 'Default' } }, presets: { openai_preset: [{ name: 'Default', data: factory }] } };
  await getCurrentRepo<PresetItem>('presets').put({ id: 'managed', title: 'Managed', preset: parsePreset(managed), createdAt: 1, updatedAt: 1 });
  await getCurrentRepo<ArchiveCharacter>('characters').put({ id: 'char', name: 'Synthetic', card: { name: 'Synthetic', first_mes: 'Synthetic' }, tags: [], status: '进行中', createdAt: 1, updatedAt: 1 });
  for (const id of ['story-a', 'story-b']) await getCurrentRepo<ArchiveStory>('archiveStories').put({ id, characterId: 'char', title: id,
    assets: id === 'story-b' ? [{ kind: 'preset', assetId: 'managed' }] : [],
    session: { id, title: id, messages: [{ id: 'm1', role: 'assistant', content: 'Synthetic', timestamp: 1 }], character: { name: 'Synthetic' }, user: { name: 'User' }, createdAt: 1 },
    markers: [], favorites: [], meta: { modelsUsed: [], playTimeMs: null }, createdAt: 1, updatedAt: 1 });
  const a = await createTavernHost({ storyId: 'story-a', defaults });
  try { expect((await a.request('/api/settings/save', { oai_settings: { ...factory, preset_settings_openai: 'Default' } })).ok).toBe(true); } finally { a.close(); }
  const b = await createTavernHost({ storyId: 'story-b', defaults });
  try {
    const settings = JSON.parse((await (await b.request('/api/settings/get')).json()).settings).oai_settings;
    expect(settings.prompts[0].content).toBe('MANAGED_SYNTHETIC');
    expect((await b.request('/api/settings/save', { oai_settings: { ...settings, assistant_prefill: 'STALE_SYNTHETIC', custom_include_headers: 'X-Synthetic: test' } })).ok).toBe(true);
  } finally { b.close(); }
  const reopened = await createTavernHost({ storyId: 'story-a', defaults });
  try {
    const settings = JSON.parse((await (await reopened.request('/api/settings/get')).json()).settings).oai_settings;
    expect(settings.preset_settings_openai).toBe('Default');
    expect(settings.prompts[0].content).toBe('FACTORY_SYNTHETIC');
    expect(settings.assistant_prefill).toBeUndefined();
    expect(settings.openai_max_context).toBe(8192);
    expect(settings.custom_include_headers).toBe('X-Synthetic: test');
  } finally { reopened.close(); }
});
