import type { ArchiveCharacter } from '@/types/archive';
import { getCharacter } from '@/lib/archive-db';
import { getWorldBook } from '@/lib/worldbook-db';
import { worldBookToCharacterBook } from '@/lib/character-book';
import { embedCharaInPng } from '@/lib/png-writer';
import { getVaultEpoch } from '@/lib/vault/active';

export class CharacterWorldbookChoiceRequired extends Error {
  constructor(public readonly choices: { id: string; title: string }[]) { super('请选择本次角色卡导出的世界书'); }
}

/** Reads live references and constructs a detached export; never writes the library. */
export async function buildCharacterExportSnapshot(characterId: string, worldbookId?: string): Promise<ArchiveCharacter> {
  const epoch = getVaultEpoch();
  const check = () => { if (getVaultEpoch() !== epoch) throw new Error('文件库已切换，请重新导出'); };
  const current = await getCharacter(characterId); check();
  if (!current) throw new Error('角色不存在，请刷新后重试');
  const snapshot = structuredClone(current);
  const refs = (current.assets ?? []).filter(ref => ref.kind === 'worldbook');
  const embedded = refs.filter(ref => ref.relations?.includes('embedded'));
  const candidates = [...new Set((embedded.length ? embedded : refs.filter(ref => ref.relations?.includes('primary'))).map(ref => ref.assetId))];
  if (worldbookId && !candidates.includes(worldbookId)) throw new Error('所选世界书不在当前角色的可导出绑定中');
  if (!worldbookId && candidates.length > 1) {
    const choices = await Promise.all(candidates.map(async id => ({ id, title: (await getWorldBook(id))?.title ?? `缺失世界书 (${id})` })));
    check(); throw new CharacterWorldbookChoiceRequired(choices);
  }
  const targetId = worldbookId ?? candidates[0];
  if (targetId) {
    const book = await getWorldBook(targetId); check();
    if (!book) throw new Error('当前绑定世界书不存在，请先检查角色关联');
    const data = snapshot.card.data ?? snapshot.card;
    data.character_book = worldBookToCharacterBook(book.worldbook, book.title);
    data.extensions = { ...(data.extensions && typeof data.extensions === 'object' ? data.extensions : {}), world: book.title };
  }
  if (snapshot.pngBase64) {
    const original = Uint8Array.from(atob(snapshot.pngBase64), ch => ch.charCodeAt(0));
    const bytes = embedCharaInPng(original.buffer, snapshot.card);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    snapshot.pngBase64 = btoa(binary);
  }
  check(); return snapshot;
}
