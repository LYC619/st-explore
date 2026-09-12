import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { saveStoryPackageFile, saveTextFile } from '@/lib/roleplay/export-package-file';
import { saveTextExport } from '@/lib/vault/tauri-fs';

vi.mock('@/lib/vault/tauri-fs', () => ({ saveTextExport: vi.fn() }));
beforeEach(() => { vi.stubGlobal('__TAURI_INTERNALS__', {}); vi.mocked(saveTextExport).mockReset(); });
afterEach(() => vi.unstubAllGlobals());

it('native recovery and story packages use the single native selection-and-write operation', async () => {
  vi.mocked(saveTextExport).mockResolvedValue(true);
  await expect(saveTextFile({ fileName: '恢复.jsonl', text: '当前编辑', extension: 'jsonl', label: '聊天恢复文件' })).resolves.toBe('saved');
  expect(saveTextExport).toHaveBeenLastCalledWith({ fileName: '恢复.jsonl', extension: 'jsonl', content: '当前编辑' });
  await expect(saveStoryPackageFile({ fileName: '故事.ste-play', text: '完整故事' })).resolves.toBe('saved');
  expect(saveTextExport).toHaveBeenLastCalledWith({ fileName: '故事.ste-play', extension: 'ste-play', content: '完整故事' });
});

it('native cancellation is reported truthfully and write errors remain available to the recovery UI', async () => {
  const output = { fileName: '恢复.jsonl', text: '当前编辑', extension: 'jsonl', label: '聊天恢复文件' };
  vi.mocked(saveTextExport).mockResolvedValue(false);
  await expect(saveTextFile(output)).resolves.toBe('cancelled');
  vi.mocked(saveTextExport).mockRejectedValue(new Error('磁盘空间不足'));
  await expect(saveTextFile(output)).rejects.toThrow('磁盘空间不足');
});
