import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadCharacterFile, downloadCharacterJson } from '@/lib/character-file';
import { saveBinaryExport, saveTextExport } from '@/lib/vault/tauri-fs';
import type { ArchiveCharacter } from '@/types/archive';

vi.mock('@/lib/vault/tauri-fs', () => ({ saveTextExport: vi.fn(), saveBinaryExport: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@/lib/character-export-snapshot', () => ({ buildCharacterExportSnapshot: async () => character }));
const character = { id: 'c', tags: [], status: '未开始', createdAt: 1, updatedAt: 1, name: '角色/测试', card: { name: '原始卡名', extensions: { variables: { score: 8 } } },
  pngBase64: btoa('PNG bytes') } as ArchiveCharacter;

beforeEach(() => { vi.stubGlobal('__TAURI_INTERNALS__', {}); vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('character file saving', () => {
  it('waits for the native PNG selection and write, with a safe file name', async () => {
    vi.mocked(saveBinaryExport).mockResolvedValue(true);
    await expect(downloadCharacterFile(character)).resolves.toBe('saved');
    expect(saveBinaryExport).toHaveBeenCalledWith({ fileName: '角色_测试.png', extension: 'png', base64: character.pngBase64 });
  });
  it('reports cancellation and propagates a native write failure for retry', async () => {
    vi.mocked(saveBinaryExport).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('磁盘空间不足')).mockResolvedValueOnce(true);
    await expect(downloadCharacterFile(character)).resolves.toBe('cancelled');
    await expect(downloadCharacterFile(character)).rejects.toThrow('磁盘空间不足');
    await expect(downloadCharacterFile(character)).resolves.toBe('saved');
  });
  it('saves valid JSON for either original card format, preserving unknown data', async () => {
    vi.mocked(saveTextExport).mockResolvedValue(true);
    await expect(downloadCharacterJson(character)).resolves.toBe('saved');
    expect(JSON.parse(vi.mocked(saveTextExport).mock.calls[0][0].content)).toEqual(character.card);
    await expect(downloadCharacterFile({ ...character, pngBase64: undefined })).resolves.toBe('saved');
  });
  it('keeps a browser PNG URL alive until the download has had a chance to consume it', async () => {
    vi.unstubAllGlobals(); vi.useFakeTimers();
    const create = vi.fn(() => 'blob:png'); const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await expect(downloadCharacterFile(character)).resolves.toBe('downloaded');
    expect(click).toHaveBeenCalledOnce(); expect(revoke).not.toHaveBeenCalled();
    await vi.runAllTimersAsync(); expect(revoke).toHaveBeenCalledWith('blob:png');
    expect(document.querySelector('a[download]')).toBeNull();
  });
});
