import { exportCharactersToDirectory } from '@/lib/character-batch-export';
import { downloadCharacterFile } from '@/lib/character-file';
import { downloadCharactersInBatch, WEB_BATCH_DOWNLOAD_LIMIT } from '@/lib/character-web-download';
import { displayCharacterName } from '@/lib/library-query';
import { createTauriFs, isTauri, pickDirectory } from '@/lib/vault/tauri-fs';
import type { ArchiveCharacter } from '@/types/archive';

export interface ToastPayload {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}

export { WEB_BATCH_DOWNLOAD_LIMIT };

export async function runWebBatchCharacterDownload(
  targets: ArchiveCharacter[],
  notify: (payload: ToastPayload) => void,
): Promise<void> {
  const result = await downloadCharactersInBatch(targets);
  if (result.failed.length === 0) {
    notify({
      title: `已发起下载 ${result.downloaded.length} 张角色卡`,
      description: '浏览器可能会询问是否允许连续下载多个文件。',
    });
    return;
  }
  notify({
    title: result.downloaded.length > 0
      ? `已下载 ${result.downloaded.length} 张，另有 ${result.failed.length} 张未成功`
      : `下载未成功：${result.failed.length} 张均未开始`,
    description: result.failed.slice(0, 3).map((f) => `${f.name}：${f.error}`).join('\n'),
    variant: 'destructive',
  });
}

export async function exportBatchCharactersToDesktop(
  targets: ArchiveCharacter[],
  notify: (payload: ToastPayload) => void,
): Promise<void> {
  const root = await pickDirectory('选择角色卡导出文件夹');
  if (!root) {
    notify({ title: '已取消导出', description: '没有写入任何文件。' });
    return;
  }
  const result = await exportCharactersToDirectory(targets, createTauriFs(root));
  if (result.failed.length === 0) {
    notify({
      title: `已导出 ${result.exported.length} 张角色卡`,
      description: `已保存到：${root}`,
    });
    return;
  }
  const detail = result.failed
    .slice(0, 3)
    .map((item) => `${item.fileName}：${item.error}`)
    .join('\n');
  notify({
    title: result.exported.length > 0
      ? `已导出 ${result.exported.length} 张，另有 ${result.failed.length} 张失败`
      : `导出未成功：${result.failed.length} 张均未写入`,
    description: detail,
    variant: 'destructive',
  });
}

export async function exportSingleCharacterFromLibrary(
  character: ArchiveCharacter,
  notify: (payload: ToastPayload) => void,
): Promise<void> {
  if (!isTauri()) {
    try {
      const result = await downloadCharacterFile(character);
      if (result !== 'cancelled') {
        notify({
          title: result === 'shared'
            ? '已调起分享角色卡'
            : `已发起下载「${displayCharacterName(character)}」`,
        });
      }
    } catch (error) {
      notify({
        title: '导出未成功',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
    return;
  }
  try {
    const root = await pickDirectory('选择角色卡导出文件夹');
    if (!root) {
      notify({ title: '已取消导出', description: '没有写入任何文件。' });
      return;
    }
    const result = await exportCharactersToDirectory([character], createTauriFs(root));
    if (result.failed.length === 0) {
      notify({ title: `已导出「${displayCharacterName(character)}」`, description: `已保存到：${root}` });
    } else {
      notify({ title: '导出未成功', description: result.failed[0]?.error, variant: 'destructive' });
    }
  } catch (error) {
    notify({
      title: '导出未成功',
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive',
    });
  }
}

export { isTauri };
