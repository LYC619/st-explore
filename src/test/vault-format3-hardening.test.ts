import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemFs, type VaultFs } from '@/lib/vault/fs';
import { saveCharacterFiles, recoverCharacterSaves } from '@/lib/vault/character-save';
import { mutationCoordinator, withVaultMutation } from '@/lib/vault/mutation-coordinator';
import { assertCompatibleVault, NEWER_VAULT_MESSAGE, NewerVaultFormatError } from '@/lib/vault/vault-format';
import { ARCHIVE_SCHEMA_VERSION } from '@/lib/archive-schema';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', async original => ({
  ...(await original<typeof import('@tauri-apps/api/core')>()),
  invoke: native.invoke,
  Channel: class { onmessage?: (msg: unknown) => void; },
}));

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast: toastSpy }));

import { cleanupSTBackupImport, pickSTBackupImport, repairAppConfig, setAppConfig } from '@/lib/vault/tauri-fs';

const profileJson = (id: string, name: string, revision: number) =>
  JSON.stringify({ id, name, revision });

beforeEach(() => {
  native.invoke.mockReset();
  toastSpy.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Vault Format 3 recoverable character saves', () => {
  it('rolls back an interrupted rename + write before committed.json and cleans up staging', async () => {
    const base = createMemFs();
    await base.writeText('角色/旧名/档案.json', profileJson('c-1', '旧名', 1));
    await base.writeBinary('角色/旧名/卡片.png', 'b2xkLXBuZw==');

    const crashingFs: VaultFs = {
      ...base,
      async writeText(path: string, content: string) {
        if (path.endsWith('/committed.json')) {
          throw new Error('simulated power loss before commit');
        }
        await base.writeText(path, content);
      },
    };

    await expect(saveCharacterFiles(crashingFs, {
      id: 'c-1',
      from: '角色/旧名',
      to: '角色/新名',
      profile: profileJson('c-1', '新名', 2),
      png: 'bmV3LXBuZw==',
      derivedUnchanged: false,
    })).rejects.toThrow('simulated power loss before commit');

    // Inline rollback already restored original directory and files.
    expect(await base.readText('角色/旧名/档案.json')).toBe(profileJson('c-1', '旧名', 1));
    expect(await base.readBinary('角色/旧名/卡片.png')).toBe('b2xkLXBuZw==');
    expect((await base.stat('角色/新名')).exists).toBe(false);
    expect((await base.stat('.ste-control')).exists).toBe(false);

    // Now test recovery on reopen when inline rollback itself couldn't run (process killed).
    let manifestWritten = false;
    let kill = false;
    const killedFs: VaultFs = {
      ...base,
      async writeText(path: string, content: string) {
        if (path.endsWith('/manifest.json')) manifestWritten = true;
        if (path.endsWith('/committed.json')) {
          kill = true;
          throw new Error('SIGKILL');
        }
        if (kill) throw new Error('process dead');
        await base.writeText(path, content);
      },
      async rename(from: string, to: string) {
        if (kill) throw new Error('process dead');
        await base.rename(from, to);
      },
    };

    await expect(saveCharacterFiles(killedFs, {
      id: 'c-1',
      from: '角色/旧名',
      to: '角色/新名',
      profile: profileJson('c-1', '新名', 2),
      png: 'bmV3LXBuZw==',
      derivedUnchanged: false,
    })).rejects.toThrow('process dead');

    expect(manifestWritten).toBe(true);
    // New directory exists on disk with uncommitted journal before recovery.
    expect((await base.stat('角色/新名/档案.json')).exists).toBe(true);
    expect((await base.list('.ste-control/character-saves')).length).toBe(1);

    // Next boot / reopen runs recoverCharacterSaves on a fresh handle and restores exact before-state.
    await recoverCharacterSaves(base);
    expect(await base.readText('角色/旧名/档案.json')).toBe(profileJson('c-1', '旧名', 1));
    expect(await base.readBinary('角色/旧名/卡片.png')).toBe('b2xkLXBuZw==');
    expect((await base.stat('角色/新名')).exists).toBe(false);
    expect((await base.stat('.ste-control')).exists).toBe(false);
  });

  it('completes cleanup without rolling back when crash happens after committed.json', async () => {
    const base = createMemFs();
    await base.writeText('角色/甲/档案.json', profileJson('c-2', '甲', 1));
    await base.writeBinary('角色/甲/卡片.png', 'b2xk');

    const failCleanupFs: VaultFs = {
      ...base,
      async removeFile(path: string) {
        if (path.startsWith('.ste-control/character-saves/')) {
          throw new Error('cleanup interrupted');
        }
        await base.removeFile(path);
      },
    };

    // Save succeeds logically even if cleanup fails after committed.json.
    await saveCharacterFiles(failCleanupFs, {
      id: 'c-2',
      from: '角色/甲',
      to: '角色/乙',
      profile: profileJson('c-2', '乙', 2),
      png: 'bmV3',
      derivedUnchanged: false,
    });

    expect((await base.list('.ste-control/character-saves')).length).toBe(1);
    expect(await base.readText('角色/乙/档案.json')).toBe(profileJson('c-2', '乙', 2));
    expect(await base.readBinary('角色/乙/卡片.png')).toBe('bmV3');

    // Reopen recovery sees committed.json, keeps committed data, and removes staging.
    await recoverCharacterSaves(base);
    expect(await base.readText('角色/乙/档案.json')).toBe(profileJson('c-2', '乙', 2));
    expect(await base.readBinary('角色/乙/卡片.png')).toBe('bmV3');
    expect((await base.stat('.ste-control')).exists).toBe(false);
  });

  it('refuses recovery when disk files were externally tampered to an unknown hash', async () => {
    const base = createMemFs();
    await base.writeText('角色/丙/档案.json', profileJson('c-3', '丙', 1));
    let kill = false;
    const killedFs: VaultFs = {
      ...base,
      async writeText(path: string, content: string) {
        if (path.endsWith('/committed.json')) {
          kill = true;
          throw new Error('crash');
        }
        if (kill) throw new Error('dead');
        await base.writeText(path, content);
      },
      async rename(from: string, to: string) {
        if (kill) throw new Error('dead');
        await base.rename(from, to);
      },
    };
    await expect(saveCharacterFiles(killedFs, {
      id: 'c-3',
      from: '角色/丙',
      to: '角色/丁',
      profile: profileJson('c-3', '丁', 2),
      derivedUnchanged: true,
    })).rejects.toThrow();

    // External process edits 档案.json to an unrecorded state.
    await base.writeText('角色/丁/档案.json', profileJson('c-3', '外部手改', 99));
    await expect(recoverCharacterSaves(base)).rejects.toThrow('恢复记录与文件不一致');
    expect(await base.readText('角色/丁/档案.json')).toBe(profileJson('c-3', '外部手改', 99));
  });
});

describe('Vault Format 3 compatibility gate', () => {
  it('rejects any schemaVersion newer than ARCHIVE_SCHEMA_VERSION and allows current/legacy/missing', async () => {
    const fs = createMemFs();
    await expect(assertCompatibleVault(fs)).resolves.toBeUndefined();

    await fs.writeText('库信息.json', JSON.stringify({ schemaVersion: ARCHIVE_SCHEMA_VERSION }));
    await expect(assertCompatibleVault(fs)).resolves.toBeUndefined();

    await fs.writeText('库信息.json', JSON.stringify({ schemaVersion: ARCHIVE_SCHEMA_VERSION - 1 }));
    await expect(assertCompatibleVault(fs)).resolves.toBeUndefined();

    await fs.writeText('库信息.json', JSON.stringify({ schemaVersion: ARCHIVE_SCHEMA_VERSION + 1 }));
    await expect(assertCompatibleVault(fs)).rejects.toThrow(NewerVaultFormatError);
    await expect(assertCompatibleVault(fs)).rejects.toThrow(NEWER_VAULT_MESSAGE);

    // Corrupted JSON falls back to backend handling instead of crashing the version gate.
    await fs.writeText('库信息.json', '{broken');
    await expect(assertCompatibleVault(fs)).resolves.toBeUndefined();
  });
});

describe('Dual-window write lock contention & shared mutation coordinator', () => {
  it('surfaces a destructive toast on STE_CONFIG_LOCK_TIMEOUT and rethrows for both config_set and config_repair', async () => {
    native.invoke.mockRejectedValueOnce('STE_CONFIG_LOCK_TIMEOUT:另一个窗口持有写锁');
    await expect(setAppConfig('vaultRoot', 'D:/synthetic')).rejects.toBe('STE_CONFIG_LOCK_TIMEOUT:另一个窗口持有写锁');
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({
      title: '配置暂未保存',
      description: expect.stringContaining('另一个 STE 窗口正在写配置'),
      variant: 'destructive',
    }));

    toastSpy.mockClear();
    native.invoke.mockRejectedValueOnce('STE_CONFIG_LOCK_TIMEOUT:timeout');
    await expect(repairAppConfig()).rejects.toBe('STE_CONFIG_LOCK_TIMEOUT:timeout');
    expect(toastSpy).toHaveBeenCalledOnce();
  });

  it('serializes concurrent mutations across two handles pointing at the same library identity', async () => {
    const sharedIdentity = `native:d:/synthetic-dual-window-${crypto.randomUUID()}`;
    const handleA: VaultFs = { ...createMemFs(), mutationIdentity: sharedIdentity };
    const handleB: VaultFs = { ...createMemFs(), mutationIdentity: sharedIdentity };

    expect(mutationCoordinator(handleA)).toBe(mutationCoordinator(handleB));
    const events: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>(resolve => { releaseFirst = resolve; });

    const first = withVaultMutation(handleA, async () => {
      events.push('A-start');
      await gate;
      events.push('A-end');
      return 'A';
    });
    const second = withVaultMutation(handleB, async () => {
      events.push('B-start');
      events.push('B-end');
      return 'B';
    });

    await vi.waitFor(() => expect(events).toEqual(['A-start']));
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(['A', 'B']);
    expect(events).toEqual(['A-start', 'A-end', 'B-start', 'B-end']);
    expect(mutationCoordinator(handleA).revision).toBe(2);
  });
});

describe('Stale temporary backup directory cleanup retries', () => {
  it('deduplicates in-flight cleanup and retries previously failed stale temp cleanup before next import', async () => {
    let releaseCleanup!: () => void;
    const wait = new Promise<void>(resolve => { releaseCleanup = resolve; });
    const tempRoot = `C:/Temp/ste-st-import-999-${Date.now()}`;

    native.invoke.mockImplementationOnce(() => wait);
    const c1 = cleanupSTBackupImport(tempRoot);
    const c2 = cleanupSTBackupImport(tempRoot);
    expect(c1).toBe(c2);
    expect(native.invoke).toHaveBeenCalledTimes(1);
    releaseCleanup();
    await c1;

    // If a cleanup fails (e.g. file briefly locked), pickSTBackupImport retries it before preparing next import.
    const failedRoot = `C:/Temp/ste-st-import-1000-${Date.now()}`;
    native.invoke
      .mockRejectedValueOnce(new Error('temporarily locked'))
      .mockResolvedValueOnce(undefined) // retry cleanup succeeds
      .mockResolvedValueOnce({ root: 'C:/Temp/ste-st-import-1001-1', display_name: 'backup.zip', skipped_secrets: 1 });

    await expect(cleanupSTBackupImport(failedRoot)).rejects.toThrow('temporarily locked');
    const prepared = await pickSTBackupImport();
    expect(prepared).toEqual({
      root: 'C:/Temp/ste-st-import-1001-1',
      displayName: 'backup.zip',
      skippedSecrets: 1,
    });
    expect(native.invoke).toHaveBeenNthCalledWith(3, 'cleanup_st_backup_import', { root: failedRoot });
    expect(native.invoke).toHaveBeenNthCalledWith(4, 'prepare_st_backup_import', expect.any(Object));
  });
});
