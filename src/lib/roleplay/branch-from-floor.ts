import { buildBranchFromSession, getBranchLine, updateArchiveStory } from '@/lib/archive-db';
import { getVaultEpoch } from '@/lib/vault/active';
import type { StoryBranch } from '@/types/archive';
import type { ChatSession } from '@/types/chat';
import { captureBranchRuntimeParent } from './branch-inheritance';

export interface BranchFromFloorResult {
  storyId: string;
  branchId: string;
  branchName: string;
  floorCount: number;
  forkFloor: number;
  playPath: string;
}

export interface BranchFromFloorOptions {
  requestedName?: string;
  /** 优先按稳定 messageId 定锚分叉点，避免隐藏楼/OOC 过滤导致虚拟下标偏移 */
  targetMessageId?: string | null;
}

/**
 * 从指定脉络的 targetMessageId 或 targetFloor（0-based，包含该楼）派生一条新支线：
 * - 完整保留 0..forkFloor 的原始消息 ID 与候选记录；
 * - 登记 ste_catalog.runtimeParent，进入酒馆续聊时自动继承截止该楼的记忆与世界书版本；
 * - 同步继承落在 0..forkFloor 范围内的章节标记与书签。
 */
export async function branchStoryFromFloor(
  storyId: string,
  sourceBranchId: string | null,
  targetFloor: number,
  optionsOrName?: string | BranchFromFloorOptions,
): Promise<BranchFromFloorResult> {
  const epoch = getVaultEpoch();
  const assertCurrent = () => {
    if (getVaultEpoch() !== epoch) {
      throw new Error('文件库已切换，已取消创建支线');
    }
  };

  const opts: BranchFromFloorOptions =
    typeof optionsOrName === 'string'
      ? { requestedName: optionsOrName }
      : (optionsOrName ?? {});

  let createdBranch: StoryBranch | undefined;
  let resolvedForkFloor = 0;

  const saved = await updateArchiveStory(storyId, (current) => {
    assertCurrent();
    const parentLine = getBranchLine(current, sourceBranchId);
    if (!parentLine) throw new Error('当前故事分支不存在');
    if (parentLine.session.messages.length === 0) {
      throw new Error('当前故事还没有消息楼层，暂时不能分叉支线');
    }

    const byMessageId = opts.targetMessageId
      ? parentLine.session.messages.findIndex((m) => m.id === opts.targetMessageId)
      : -1;
    const clampedFloor = byMessageId >= 0
      ? byMessageId
      : Math.min(
          Math.max(0, Math.trunc(targetFloor)),
          parentLine.session.messages.length - 1,
        );
    resolvedForkFloor = clampedFloor;
    const slicedMessages = structuredClone(parentLine.session.messages.slice(0, clampedFloor + 1));

    const existingNames = new Set([
      '主线',
      ...(current.branches ?? []).map((b) => b.name),
    ]);
    const baseName = opts.requestedName?.trim() || `从 #${clampedFloor} 楼分叉`;
    let branchName = baseName;
    let suffix = 2;
    while (existingNames.has(branchName)) {
      branchName = `${baseName} (${suffix++})`;
    }

    const parentChatMeta = structuredClone(parentLine.session.rawMetadata?.chat_metadata ?? {});
    delete parentChatMeta.main_chat;

    const childSession: ChatSession = {
      ...structuredClone(parentLine.session),
      id: crypto.randomUUID(),
      title: branchName,
      createdAt: Date.now(),
      messages: slicedMessages,
      rawMetadata: {
        ...structuredClone(parentLine.session.rawMetadata ?? {}),
        chat_metadata: parentChatMeta,
        ste_catalog: {},
      },
    };

    const branch = buildBranchFromSession(childSession, branchName);
    branch.session.rawMetadata!.ste_catalog = {
      runtimeParent: captureBranchRuntimeParent(
        current.id,
        branch.id,
        sourceBranchId,
        parentLine.session,
        childSession,
      ),
    };

    const keptIds = new Map(slicedMessages.map((m, idx) => [m.id, idx]));
    branch.markers = parentLine.markers
      .filter((marker) => keptIds.has(marker.messageId))
      .map((marker) => ({
        ...structuredClone(marker),
        messageIndex: keptIds.get(marker.messageId)!,
      }));
    branch.favorites = (parentLine.favorites ?? []).filter((id) => keptIds.has(id));
    branch.lastFloor = clampedFloor;

    createdBranch = branch;
    return {
      branches: [...(current.branches ?? []), branch],
      lastViewedBranchId: branch.id,
      updatedAt: Date.now(),
    };
  });

  assertCurrent();
  if (!saved || !createdBranch) throw new Error('故事不存在，未能创建支线');

  return {
    storyId: saved.id,
    branchId: createdBranch.id,
    branchName: createdBranch.name,
    floorCount: createdBranch.session.messages.length,
    forkFloor: resolvedForkFloor,
    playPath: `/play/${encodeURIComponent(saved.id)}?branch=${encodeURIComponent(createdBranch.id)}`,
  };
}
