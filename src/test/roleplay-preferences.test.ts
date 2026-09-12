import { afterEach, describe, expect, it } from 'vitest';
import { getRoleplayPreferences, saveRoleplayPreferences, saveLibraryTagPreferences, setArchiveSchemaVersion } from '@/lib/archive-db';
import { createVault } from '@/lib/vault/vault-backend';
import { createMemFs } from '@/lib/vault/fs';
import { setActiveVault } from '@/lib/vault/active';
import { normalizeLibraryTagPreferences } from '@/lib/library-tag-preferences';

afterEach(() => setActiveVault(null));

describe('roleplay library preferences', () => {
  it('shares the existing metadata queue and record, preserving schema and tags across reopening', async () => {
    const fs = createMemFs();
    setActiveVault(createVault(fs));
    await Promise.all([
      saveRoleplayPreferences({ mainProfileId: 'main' }),
      setArchiveSchemaVersion(21),
      saveLibraryTagPreferences(normalizeLibraryTagPreferences({ version: 1, customTags: ['私人'] })),
      saveRoleplayPreferences({ toolProfileId: 'tool', tavern: { username: '旅人', extension_settings: { plugin: 1 } } }),
    ]);
    setActiveVault(createVault(fs));
    expect(await getRoleplayPreferences()).toMatchObject({ mainProfileId: 'main', toolProfileId: 'tool', tavern: { username: '旅人' } });
    const raw = JSON.parse(await fs.readText('库信息.json'));
    expect(raw.schemaVersion).toBe(21);
    expect(raw.libraryTags.customTags).toEqual(['私人']);
    expect(raw.id).toBe('archive-schema');
  });

  it('captures the originating vault before a queued save and returns independent settings objects', async () => {
    const firstFs = createMemFs();
    const secondFs = createMemFs();
    setActiveVault(createVault(firstFs));
    const pending = saveRoleplayPreferences({ tavern: { username: '旧库' } });
    setActiveVault(createVault(secondFs));
    await pending;
    expect(await getRoleplayPreferences()).toEqual({});
    setActiveVault(createVault(firstFs));
    const settings = await getRoleplayPreferences();
    settings.tavern!.username = '进程内修改';
    expect((await getRoleplayPreferences()).tavern?.username).toBe('旧库');
  });
});
