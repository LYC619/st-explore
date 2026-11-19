import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauriMocks.invoke,
}));

import { createTauriFs, pickDirectory } from '@/lib/vault/tauri-fs';
import { exportTextFile } from '@/lib/text-file-export';
import { savePackBytes } from '@/lib/reading-pack/save';

describe('Tauri 文件系统状态转换', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('把 Rust 的 is_dir 字段转换为前端使用的 isDir', async () => {
    tauriMocks.invoke.mockResolvedValue({ exists: true, is_dir: true });

    const stat = await createTauriFs('D:/vault').stat('');

    expect(tauriMocks.invoke).toHaveBeenCalledWith('vault_stat', {
      root: 'D:/vault',
      path: '',
    });
    expect(stat).toEqual({ exists: true, isDir: true });
  });

  it('把 Rust 的修改时间毫秒值映射到目录项', async () => {
    tauriMocks.invoke.mockResolvedValue([{
      name: '世界书.json',
      is_dir: false,
      is_symlink: false,
      size: 12,
      modified_at: 1_725_000_000_123,
    }]);

    const entries = await createTauriFs('D:/ST').list('worlds');

    expect(entries).toEqual([{
      name: '世界书.json',
      isDir: false,
      isSymlink: false,
      size: 12,
      modifiedAt: 1_725_000_000_123,
    }]);
  });

  it('目录选择由 Rust 完成，并只返回已加入授权集合的路径', async () => {
    tauriMocks.invoke.mockResolvedValue('D:/vaults/demo');

    await expect(pickDirectory('选择 STE 库')).resolves.toBe('D:/vaults/demo');

    expect(tauriMocks.invoke).toHaveBeenCalledWith('vault_pick_authorized_directory', {
      title: '选择 STE 库',
      persistent: false,
      purpose: 'export',
    });
  });

  it('passes file size and modification time through stat for summary validation', async () => {
    tauriMocks.invoke.mockResolvedValue({ exists: true, is_dir: false, size: 123, modified_at: 123456 });
    expect(await createTauriFs('D:/vault').stat('临时/故事/故事.json')).toEqual({ exists: true, isDir: false, size: 123, modifiedAt: 123456 });
  });

  it('marks ST picker grants as source access', async () => {
    tauriMocks.invoke.mockResolvedValue('D:/ST');
    await pickDirectory('ST', { persistAuthorization: true, purpose: 'source' });
    expect(tauriMocks.invoke).toHaveBeenCalledWith('vault_pick_authorized_directory', { title: 'ST', persistent: true, purpose: 'source' });
  });

  it('saves Markdown through the native single-export command and preserves cancellation', async () => {
    tauriMocks.invoke.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const input = { suggestedName: 'Synthetic', content: '# Synthetic' };
    expect(await exportTextFile(input, { tauri: true })).toBe('saved');
    expect(await exportTextFile(input, { tauri: true })).toBe('cancelled');
    expect(tauriMocks.invoke).toHaveBeenCalledWith('save_text_export', { fileName: 'Synthetic.md', extension: 'md', content: '# Synthetic' });
  });

  it('saves reading packages through the native single-export command', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    try {
      tauriMocks.invoke.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      expect(await savePackBytes(new Uint8Array([1, 2, 3]), 'Synthetic.ste-reading')).toBe('saved');
      expect(await savePackBytes(new Uint8Array([1, 2, 3]), 'Synthetic.zip', { label: 'ZIP', extension: 'zip' })).toBe('cancelled');
      expect(tauriMocks.invoke).toHaveBeenCalledWith('save_binary_export', { fileName: 'Synthetic.ste-reading', extension: 'ste-reading', base64: 'AQID' });
    } finally { Reflect.deleteProperty(window, '__TAURI_INTERNALS__'); }
  });
});
