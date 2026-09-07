import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  Channel: class { onmessage = () => {}; },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetModules();
  mocks.invoke.mockReset();
});

describe('native ST preparation lifecycle', () => {
  it('waits for the previous preparation and cancellation IPC before retrying', async () => {
    const first = deferred<null>();
    const cancel = deferred<void>();
    mocks.invoke.mockImplementation((command: string) => command === 'cancel_st_backup_import'
      ? cancel.promise : first.promise);
    const { pickSTBackupImport } = await import('@/lib/vault/tauri-fs');
    const controller = new AbortController();
    const original = pickSTBackupImport({ signal: controller.signal });
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    controller.abort();
    const retry = pickSTBackupImport();
    await Promise.resolve();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'prepare_st_backup_import')).toHaveLength(1);
    first.resolve(null);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'prepare_st_backup_import')).toHaveLength(1);
    cancel.resolve();
    await Promise.all([original, retry]);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'prepare_st_backup_import')).toHaveLength(2);
  });

  it('does not open the picker for an already cancelled request', async () => {
    const { pickSTBackupImport } = await import('@/lib/vault/tauri-fs');
    const controller = new AbortController();
    controller.abort();
    await expect(pickSTBackupImport({ signal: controller.signal })).resolves.toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('retries previously failed cleanup before another preparation', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('file is locked')).mockResolvedValue(null);
    const { cleanupSTBackupImport, pickSTBackupImport } = await import('@/lib/vault/tauri-fs');
    await expect(cleanupSTBackupImport('C:/Temp/synthetic-st-import')).rejects.toThrow('file is locked');
    await pickSTBackupImport();
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      'cleanup_st_backup_import', 'cleanup_st_backup_import', 'prepare_st_backup_import',
    ]);
  });

  it('shares an in-flight cleanup with a preparation retry', async () => {
    const removal = deferred<void>();
    mocks.invoke.mockImplementation((command: string) => command === 'cleanup_st_backup_import'
      ? removal.promise : Promise.resolve(null));
    const { cleanupSTBackupImport, pickSTBackupImport } = await import('@/lib/vault/tauri-fs');
    const cleanup = cleanupSTBackupImport('C:/Temp/synthetic-st-import');
    const prepare = pickSTBackupImport();
    await Promise.resolve();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    removal.resolve();
    await Promise.all([cleanup, prepare]);
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      'cleanup_st_backup_import', 'prepare_st_backup_import',
    ]);
  });
});
