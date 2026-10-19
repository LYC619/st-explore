import type { ArchiveCharacter } from '@/types/archive';
import type { VaultFs } from '@/lib/vault/fs';
import { exportCardJson } from '@/lib/card-export';
import { ensureUnique, safeName } from '@/lib/vault/naming';
import { buildCharacterExportSnapshot, CharacterWorldbookChoiceRequired } from '@/lib/character-export-snapshot';

export type CharacterExportFile =
  | { extension: 'png'; binaryBase64: string }
  | { extension: 'json'; text: string };

export interface CharacterExportSuccess {
  id: string;
  fileName: string;
}

export interface CharacterExportFailure extends CharacterExportSuccess {
  error: string;
}

export interface CharacterBatchExportResult {
  exported: CharacterExportSuccess[];
  failed: CharacterExportFailure[];
}

export function buildCharacterExportFile(character: ArchiveCharacter): CharacterExportFile {
  if (character.pngBase64) {
    return { extension: 'png', binaryBase64: character.pngBase64 };
  }
  return { extension: 'json', text: exportCardJson(character.card) };
}

function fileStem(name: string): string {
  const lastDot = name.lastIndexOf('.');
  return lastDot > 0 ? name.slice(0, lastDot) : name;
}

export async function exportCharactersToDirectory(
  characters: ArchiveCharacter[],
  fs: VaultFs,
): Promise<CharacterBatchExportResult> {
  const entries = await fs.list('');
  const takenStems = new Set(entries.map((entry) => fileStem(entry.name)));
  const result: CharacterBatchExportResult = { exported: [], failed: [] };

  for (const character of characters) {
    const stem = ensureUnique(safeName(character.name), takenStems);
    takenStems.add(stem);
    let fileName = `${stem}.${character.pngBase64 ? 'png' : 'json'}`;
    try {
      const snapshot = await buildCharacterExportSnapshot(character.id);
      const file = buildCharacterExportFile(snapshot);
      fileName = `${stem}.${file.extension}`;
      if (file.extension === 'png') await fs.writeBinary(fileName, file.binaryBase64);
      else await fs.writeText(fileName, file.text);
      result.exported.push({ id: character.id, fileName });
    } catch (error) {
      result.failed.push({
        id: character.id,
        fileName,
        error: error instanceof CharacterWorldbookChoiceRequired
          ? '绑定了多个可导出世界书，请到角色详情选择世界书后单独导出'
          : error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
