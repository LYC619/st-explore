import type { ArchiveCharacter } from '@/types/archive';
import type { CharacterUpdater } from '@/lib/character-mutation';

export type CharacterPatch =
  | Partial<ArchiveCharacter>
  | CharacterUpdater;

export type PersistCharacterPatch = (
  id: string,
  updater: CharacterUpdater,
  options?: { onWarning?: (report: { warnings: string[] }) => void },
) => Promise<ArchiveCharacter | undefined>;

/** 只在持久化成功后提交界面状态，失败时调用方仍持有原来的已落库数据。 */
export async function commitCharacterPatch(
  id: string,
  patch: CharacterPatch,
  persist: PersistCharacterPatch,
  commit: (saved: ArchiveCharacter) => void,
  options?: { onWarning?: (report: { warnings: string[] }) => void },
): Promise<ArchiveCharacter> {
  const saved = await persist(id, async (current, context) => (
    typeof patch === 'function' ? patch(current, context) : patch
  ), options);
  if (!saved) throw new Error('角色档案不存在');
  commit(saved);
  return saved;
}
