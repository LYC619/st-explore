import { getArchiveStory, getBranchLine, resolveInitialBranchId } from '@/lib/archive-db';
import { getVaultEpoch } from '@/lib/vault/active';

/** Open an existing line; undefined restores its last viewed branch, null selects main. */
export async function prepareStoryPlay(storyId: string, requestedBranchId?: string | null): Promise<{ storyId: string; branchId: string | null; path: string }> {
  const epoch = getVaultEpoch();
  const story = await getArchiveStory(storyId);
  if (epoch !== getVaultEpoch()) throw new Error('文件库已切换，请重新打开故事');
  if (!story) throw new Error('故事不存在');
  if (requestedBranchId && !getBranchLine(story, requestedBranchId)) throw new Error('故事分支不存在');
  const branchId = resolveInitialBranchId(story, requestedBranchId);
  return { storyId: story.id, branchId, path: `/play/${encodeURIComponent(story.id)}?branch=${branchId === null ? '' : encodeURIComponent(branchId)}` };
}
