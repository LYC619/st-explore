import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import {
  isFsMutationError,
  parseFsMutationError,
} from '@/lib/vault/fs-mutation-error';
import {
  isCharacterRelativeSafePath,
  resolveAttachmentRelativePath,
} from '@/lib/vault/character-relative-path';
import { createTauriFs } from '@/lib/vault/tauri-fs';

const tauriMocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauriMocks.invoke }));

describe.each(['removeFile', 'trashFile'] as const)('Tauri %s boundary', method => {
  beforeEach(() => { tauriMocks.invoke.mockReset(); });
  const path = 'characters/A/attachments/file.txt';

  it.each([
    { wire: { code: 'not-file', path: 'native/file', message: 'ordinary file required' }, code: 'not-file' },
    { wire: '{"code":"permission-denied","path":"native/file","message":"denied"}', code: 'permission-denied' },
    { wire: '{invalid JSON', code: 'io' },
    { wire: { code: 'made-up', path: path, message: 'invalid code' }, code: 'io' },
    { wire: '{"code":"unsafe-path","message":"missing path"}', code: 'io' },
    { wire: 'legacy native error', code: 'io' },
  ])('normalizes invoke rejection to $code: $wire', async ({ wire, code }) => {
    tauriMocks.invoke.mockRejectedValue(wire);
    await expect(createTauriFs('D:/synthetic')[method]!(path)).rejects.toMatchObject({
      code, path: code === 'io' ? path : 'native/file', message: expect.any(String),
    });
    expect(tauriMocks.invoke).toHaveBeenCalledWith(
      method === 'removeFile' ? 'vault_remove_file' : 'vault_trash_file',
      { root: 'D:/synthetic', path },
    );
  });

  it.each(['', '../file', 'a/./file', '/file', 'C:/file', 'a\\file', 'a\u0000file'])(
    'rejects unsafe input locally without invoking native code: %j', async invalid => {
      await expect(createTauriFs('D:/synthetic')[method]!(invalid)).rejects.toMatchObject({
        code: 'unsafe-path', path: invalid,
      });
      expect(tauriMocks.invoke).not.toHaveBeenCalled();
    },
  );

  it('resolves after a successful native operation', async () => {
    tauriMocks.invoke.mockResolvedValue(undefined);
    await expect(createTauriFs('D:/synthetic')[method]!(path)).resolves.toBeUndefined();
    expect(tauriMocks.invoke).toHaveBeenCalledOnce();
  });
});

describe('filesystem mutation errors', () => {
  it('parses structured, JSON-string, and legacy errors without losing a stable code', () => {
    expect(parseFsMutationError({ code: 'not-file', path: '角色/A', message: '目录' })).toMatchObject({
      code: 'not-file',
    });
    expect(parseFsMutationError('{"code":"unsafe-path","path":"x","message":"越界"}')).toMatchObject({
      code: 'unsafe-path',
    });
    expect(parseFsMutationError('旧版错误', 'x')).toMatchObject({ code: 'io', path: 'x' });
    expect(isFsMutationError({ code: 'unknown', path: 'x', message: 'x' })).toBe(false);
  });

  it('memory mutations reject directories with the same structured contract', async () => {
    const fs = createMemFs();
    await fs.mkdir('角色/A');
    await expect(fs.removeFile('角色/A')).rejects.toMatchObject({ code: 'not-file' });
    await expect(fs.trashFile?.('角色/A')).rejects.toMatchObject({ code: 'not-file' });
  });
});

describe('character-scoped attachment paths', () => {
  it('uses the current character directory for new and legacy records', () => {
    expect(resolveAttachmentRelativePath({
      id: 'a', title: '攻略', path: '附件/攻略.html', pathBase: 'character', size: 1, addedAt: 1,
    })).toBe('附件/攻略.html');
    expect(resolveAttachmentRelativePath({
      id: 'a', title: '攻略', path: '角色/旧名/附件/攻略.html', size: 1, addedAt: 1,
    })).toBe('附件/攻略.html');
  });

  it('rejects nested, absolute, traversal, and unsafe path shapes', () => {
    const base = (path: string) => ({ id: 'a', title: 'x', path, size: 1, addedAt: 1 });
    expect(resolveAttachmentRelativePath(base('角色/A/附件/子/攻略.html'))).toBeUndefined();
    expect(resolveAttachmentRelativePath(base('../附件/攻略.html'))).toBeUndefined();
    expect(resolveAttachmentRelativePath(base('C:/secret.txt'))).toBeUndefined();
    expect(resolveAttachmentRelativePath(base('角色/A/附件/CON.txt'))).toBeUndefined();
    expect(isCharacterRelativeSafePath('立绘/日常/a.png', 'portrait')).toBe(true);
    expect(isCharacterRelativeSafePath('立绘/日常/../a.png', 'portrait')).toBe(false);
  });
});
