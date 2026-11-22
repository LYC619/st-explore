import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterLoadoutBar } from '@/components/character/CharacterLoadoutBar';
import { GreetingsSection } from '@/components/character/GreetingsSection';
import { normalizeCharacterCard } from '@/lib/adapters/st';
import { buildStoryFromSession, saveRoleplayPreferences, type ArchiveMetaRecord } from '@/lib/archive-db';
import { editsFromNormalized } from '@/lib/card-export';
import { branchStoryFromFloor } from '@/lib/roleplay/branch-from-floor';
import { startCharacterStory } from '@/lib/roleplay/start-story';
import { setActiveVault } from '@/lib/vault/active';
import { createMemFs } from '@/lib/vault/fs';
import { createVault, type VaultBackend } from '@/lib/vault/vault-backend';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import type { WorldBookItem } from '@/types/worldbook';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeCharacter(overrides: Partial<ArchiveCharacter> = {}): ArchiveCharacter {
  return {
    id: 'char-lin',
    name: '沈林',
    tags: [],
    status: '进行中',
    createdAt: 1000,
    updatedAt: 1000,
    card: {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: '沈林',
        first_mes: '「{{user}}，外面下雪了。」{{char}}把热茶推到你面前。',
        alternate_greetings: [
          '午夜的钟声敲响，{{char}}在书房灯下抬头望向{{user}}。',
          '   ',
        ],
        character_book: {
          entries: {
            '0': { keys: ['雪夜'], content: '北境冬夜漫长。' },
          },
        },
        extensions: {
          regex_scripts: [{ scriptName: '去状态栏源码' }],
        },
      },
    },
    ...overrides,
  };
}

describe('Stage 2 playability loop: greetings theater, branch-from-floor & loadout bar', () => {
  let vault: VaultBackend;
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    vault = createVault(createMemFs());
    setActiveVault(vault);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    host?.remove();
    host = null;
    setActiveVault(null);
  });

  it('starts a new story with pending initial greeting when greetingIndex is omitted', async () => {
    const charRepo = vault.repo<ArchiveCharacter>('characters');
    const storyRepo = vault.repo<ArchiveStory>('archiveStories');
    await charRepo.put(makeCharacter());

    const storyId = await startCharacterStory('char-lin');
    const saved = await storyRepo.get(storyId);
    expect(saved).toBeDefined();
    expect(saved?.session.messages).toHaveLength(0);
    expect(saved?.session.rawMetadata?.chat_metadata?.ste_pending_initial_greeting).toBe(true);
  });

  it('starts a story directly on chosen alternate greeting with macro expansion and full swipes', async () => {
    const charRepo = vault.repo<ArchiveCharacter>('characters');
    const storyRepo = vault.repo<ArchiveStory>('archiveStories');
    const metaRepo = vault.repo<ArchiveMetaRecord>('archiveMeta');
    await charRepo.put(makeCharacter());
    await saveRoleplayPreferences({ tavern: { username: '陆离' } }, metaRepo);

    const storyId = await startCharacterStory('char-lin', { greetingIndex: 1 });
    const saved = await storyRepo.get(storyId);
    expect(saved).toBeDefined();
    expect(saved?.title).toBe('沈林 · 备选开场 1');
    expect(saved?.session.rawMetadata?.chat_metadata?.ste_pending_initial_greeting).toBeUndefined();
    expect(saved?.session.messages).toHaveLength(1);

    const firstFloor = saved!.session.messages[0];
    expect(firstFloor.role).toBe('assistant');
    expect(firstFloor.content).toBe('午夜的钟声敲响，沈林在书房灯下抬头望向陆离。');
    expect(firstFloor.rawData?.swipe_id).toBe(1);
    expect(firstFloor.rawData?.swipes).toEqual([
      '「陆离，外面下雪了。」沈林把热茶推到你面前。',
      '午夜的钟声敲响，沈林在书房灯下抬头望向陆离。',
    ]);
  });

  it('anchors branchStoryFromFloor by targetMessageId even when hidden floors shift virtual floor numbers', async () => {
    const storyRepo = vault.repo<ArchiveStory>('archiveStories');
    const story = buildStoryFromSession(
      {
        id: 'sess-hidden',
        title: '带隐藏楼的故事',
        createdAt: 1000,
        user: { name: '陆离' },
        character: { name: '沈林' },
        messages: [
          { id: 'h0', role: 'system', hidden: true, content: '记忆摘要 0' },
          { id: 'h1', role: 'system', hidden: true, content: '记忆摘要 1' },
          { id: 'm0', role: 'assistant', is_user: false, name: '沈林', content: '可见第 0 楼（原始下标 2）' },
          { id: 'm1', role: 'user', is_user: true, name: '陆离', content: '可见第 1 楼（原始下标 3）' },
        ],
      },
      'char-lin',
    );
    await storyRepo.put(story);

    // 虚拟楼层号是 0，但稳定 messageId 指向 m0（原始下标 2）：必须保留 h0, h1, m0 共 3 条消息
    const forked = await branchStoryFromFloor(story.id, null, 0, { targetMessageId: 'm0' });
    expect(forked.forkFloor).toBe(2);
    expect(forked.floorCount).toBe(3);
    const saved = await storyRepo.get(story.id);
    expect(saved?.branches?.[0].session.messages.map((m) => m.id)).toEqual(['h0', 'h1', 'm0']);
  });

  it('rejects empty or out-of-range greetingIndex with clear player guidance', async () => {
    const charRepo = vault.repo<ArchiveCharacter>('characters');
    await charRepo.put(makeCharacter());

    await expect(startCharacterStory('char-lin', { greetingIndex: 2 })).rejects.toThrow('这条开场白还是空的');
    await expect(startCharacterStory('char-lin', { greetingIndex: 9 })).rejects.toThrow('所选开场白不存在');
  });

  it('forks a branch from an arbitrary floor and preserves runtimeParent, markers & favorites', async () => {
    const storyRepo = vault.repo<ArchiveStory>('archiveStories');
    const baseStory = buildStoryFromSession(
      {
        id: 'sess-1',
        title: '雪夜重逢',
        createdAt: 1000,
        user: { name: '陆离' },
        character: { name: '沈林' },
        messages: [
          { id: 'm0', role: 'assistant', is_user: false, name: '沈林', content: '第 0 楼' },
          { id: 'm1', role: 'user', is_user: true, name: '陆离', content: '第 1 楼' },
          { id: 'm2', role: 'assistant', is_user: false, name: '沈林', content: '第 2 楼关键转折' },
          { id: 'm3', role: 'user', is_user: true, name: '陆离', content: '第 3 楼原主线走向' },
        ],
      },
      'char-lin',
    );
    baseStory.markers = [
      { messageId: 'm1', messageIndex: 1, title: '初见', createdAt: 1001 },
      { messageId: 'm3', messageIndex: 3, title: '主线结局', createdAt: 1002 },
    ];
    baseStory.favorites = ['m2', 'm3'];
    await storyRepo.put(baseStory);

    const firstFork = await branchStoryFromFloor(baseStory.id, null, 2);
    expect(firstFork.branchName).toBe('从 #2 楼分叉');
    expect(firstFork.floorCount).toBe(3);

    const secondFork = await branchStoryFromFloor(baseStory.id, null, 2);
    expect(secondFork.branchName).toBe('从 #2 楼分叉 (2)');

    const updated = await storyRepo.get(baseStory.id);
    expect(updated?.branches).toHaveLength(2);
    const branch = updated!.branches!.find((b) => b.id === firstFork.branchId)!;
    expect(branch.session.messages.map((m) => m.id)).toEqual(['m0', 'm1', 'm2']);
    expect(branch.markers.map((m) => m.messageId)).toEqual(['m1']);
    expect(branch.favorites).toEqual(['m2']);
    expect(branch.session.rawMetadata?.ste_catalog?.runtimeParent).toMatchObject({
      schema: 1,
      storyId: baseStory.id,
      branchId: firstFork.branchId,
      parentBranchId: null,
    });
    expect(branch.session.rawMetadata?.ste_catalog?.runtimeParent?.sourceRefs).toHaveLength(3);
  });

  it('renders GreetingsSection in theater stage mode and fires onStartWithGreeting', async () => {
    const character = makeCharacter();
    const norm = normalizeCharacterCard(character.card);
    const edits = editsFromNormalized(norm);
    const onStartWithGreeting = vi.fn();

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root!.render(
        <GreetingsSection
          edits={edits}
          characterName={character.name}
          onEditChange={vi.fn()}
          onStartWithGreeting={onStartWithGreeting}
        />,
      );
    });

    expect(host.textContent).toContain('开场白剧场');
    expect(host.textContent).toContain('你，外面下雪了。');

    const altPill = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('备选 1'),
    );
    expect(altPill).toBeTruthy();

    await act(async () => {
      altPill!.click();
    });
    expect(host.textContent).toContain('午夜的钟声敲响');

    const startBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('用这段开场白开聊'),
    );
    expect(startBtn).toBeTruthy();
    await act(async () => {
      startBtn!.click();
    });
    expect(onStartWithGreeting).toHaveBeenCalledWith(1);
  });

  it('renders CharacterLoadoutBar with linked worldbook & embedded assets and navigates tabs', async () => {
    const wbRepo = vault.repo<WorldBookItem>('worldbooks');
    await wbRepo.put({
      id: 'wb-north',
      title: '北境编年史',
      worldbook: { entries: {} },
      createdAt: 1,
      updatedAt: 1,
    });

    const character = makeCharacter({
      assets: [{ kind: 'worldbook', assetId: 'wb-north', relations: ['primary'] }],
    });
    const norm = normalizeCharacterCard(character.card);
    const onSelectTab = vi.fn();

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <CharacterLoadoutBar character={character} norm={norm} onSelectTab={onSelectTab} />
        </MemoryRouter>,
      );
    });
    // Flush Promise.allSettled microtask
    await act(async () => {
      await Promise.resolve();
    });

    expect(host.textContent).toContain('北境编年史');
    expect(host.textContent).toContain('卡内自带 (1 项)');
    expect(host.textContent).toContain('2 段可赏玩');

    const greetingPill = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('2 段可赏玩'),
    );
    await act(async () => {
      greetingPill!.click();
    });
    expect(onSelectTab).toHaveBeenCalledWith('greetings');
  });
});
