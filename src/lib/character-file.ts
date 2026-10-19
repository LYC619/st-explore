/**
 * 角色卡文件导出（10.2 从 Library 抽出，10.3a 角色页操作抽屉复用）。
 * 有 PNG 存原字节（无损原件），JSON 卡导出卡数据。
 */
import type { ArchiveCharacter } from '@/types/archive';
import { exportCardJson } from '@/lib/card-export';
import { saveBinaryFile, saveTextFile } from '@/lib/roleplay/export-package-file';
import { buildCharacterExportSnapshot } from '@/lib/character-export-snapshot';

export function characterExportName(c: Pick<ArchiveCharacter, 'name'>) {
  return c.name.replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/, '') || '角色卡';
}

/** Explicit JSON export also works for cards originally imported as PNG. */
export async function downloadCharacterJson(character: ArchiveCharacter, worldbookId?: string) {
  const c = await buildCharacterExportSnapshot(character.id, worldbookId);
  const name = characterExportName(c);
  return saveTextFile({ fileName: `${name}.json`, text: exportCardJson(c.card), label: '角色卡 JSON', extension: 'json' });
}

export async function downloadCharacterFile(character: ArchiveCharacter, worldbookId?: string) {
  const c = await buildCharacterExportSnapshot(character.id, worldbookId);
  if (c.pngBase64) {
    return saveBinaryFile({ fileName: `${characterExportName(c)}.png`, base64: c.pngBase64,
      label: '角色卡 PNG', extension: 'png', mime: 'image/png' });
  }
  return saveTextFile({ fileName: `${characterExportName(c)}.json`, text: exportCardJson(c.card), label: '角色卡 JSON', extension: 'json' });
}
