import { tr } from '@/lib/i18n';
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
      title: tr("已发起下载 {{v0}} 张角色卡", { v0: result.downloaded.length }),
      description: tr("浏览器可能会询问是否允许连续下载多个文件。"),
    });
    return;
  }
  notify({
    title: result.downloaded.length > 0
      ? tr("已下载 {{v0}} 张，另有 {{v1}} 张未成功", { v0: result.downloaded.length, v1: result.failed.length })
      : tr("下载未成功：{{v0}} 张均未开始", { v0: result.failed.length }),
    description: result.failed.slice(0, 3).map((f) => tr("{{v0}}：{{v1}}", { v0: f.name, v1: f.error })).join('\n'),
    variant: 'destructive',
  });
}

export async function exportBatchCharactersToDesktop(
  targets: ArchiveCharacter[],
  notify: (payload: ToastPayload) => void,
): Promise<void> {
  const root = await pickDirectory(tr("选择角色卡导出文件夹"));
  if (!root) {
    notify({ title: tr("已取消导出"), description: tr("没有写入任何文件。") });
    return;
  }
  const result = await exportCharactersToDirectory(targets, createTauriFs(root));
  if (result.failed.length === 0) {
    notify({
      title: tr("已导出 {{v0}} 张角色卡", { v0: result.exported.length }),
      description: tr("已保存到：{{v0}}", { v0: root }),
    });
    return;
  }
  const detail = result.failed
    .slice(0, 3)
    .map((item) => tr("{{v0}}：{{v1}}", { v0: item.fileName, v1: item.error }))
    .join('\n');
  notify({
    title: result.exported.length > 0
      ? tr("已导出 {{v0}} 张，另有 {{v1}} 张失败", { v0: result.exported.length, v1: result.failed.length })
      : tr("导出未成功：{{v0}} 张均未写入", { v0: result.failed.length }),
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
            ? tr("已调起分享角色卡")
            : tr("已发起下载「{{v0}}」", { v0: displayCharacterName(character) }),
        });
      }
    } catch (error) {
      notify({
        title: tr("导出未成功"),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
    return;
  }
  try {
    const root = await pickDirectory(tr("选择角色卡导出文件夹"));
    if (!root) {
      notify({ title: tr("已取消导出"), description: tr("没有写入任何文件。") });
      return;
    }
    const result = await exportCharactersToDirectory([character], createTauriFs(root));
    if (result.failed.length === 0) {
      notify({ title: tr("已导出「{{v0}}」", { v0: displayCharacterName(character) }), description: tr("已保存到：{{v0}}", { v0: root }) });
    } else {
      notify({ title: tr("导出未成功"), description: result.failed[0]?.error, variant: 'destructive' });
    }
  } catch (error) {
    notify({
      title: tr("导出未成功"),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive',
    });
  }
}

export { isTauri };
