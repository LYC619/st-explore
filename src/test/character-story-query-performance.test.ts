import { afterEach, expect, it, vi } from 'vitest';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { getStoriesByCharacter } from '@/lib/archive-db';
import { performanceFixture } from './performance-fixture';

afterEach(() => { vi.restoreAllMocks(); setActiveVault(null); });

it('after indexing reads and clones only the selected character story bodies', async () => {
  const fixture = await performanceFixture();
  const vault = createVault(fixture.fs);
  setActiveVault(vault);
  await vault.pathOf('archiveStories', 'perf-s0-0');
  await vault.repo('archiveStories').listLight();
  fixture.reset();
  const clone = vi.spyOn(globalThis, 'structuredClone');
  const selected = await getStoriesByCharacter('perf-c0');
  expect(selected.map(story => story.id)).toEqual(['perf-s0-1', 'perf-s0-0']);
  expect(selected.every(story => story.session.messages.length === 48)).toBe(true);
  const bodyReads = fixture.calls.text.filter(path => path.endsWith('/故事.json'));
  expect(bodyReads).toHaveLength(2);
  expect(bodyReads.every(path => path.startsWith('角色/性能角色0/'))).toBe(true);
  const fullClones = clone.mock.calls.filter(([value]) => value && typeof value === 'object' && 'session' in value);
  expect(fullClones.length).toBeLessThanOrEqual(2);
  selected[0].session.messages[0].content = '仅修改调用者副本';
  expect((await getStoriesByCharacter('perf-c0'))[0].session.messages[0].content).not.toBe('仅修改调用者副本');
});
