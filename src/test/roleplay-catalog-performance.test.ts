import { expect, it, vi } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { createRoleplayCatalog, avatarKey } from '@/lib/roleplay/catalog';
import { buildCharacterFromCard, buildStoryFromSession } from '@/lib/archive-db';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';

it('opens the chat directory without loading unrelated story bodies, then reads only the chosen character chats', async () => {
  const disk = createMemFs();
  for (let i = 0; i < 12; i++) {
    const character = { ...buildCharacterFromCard({ name: `角色${i}` }), id: `c${i}` };
    await disk.writeText(`角色/C${i}/档案.json`, JSON.stringify(character));
    for (let j = 0; j < 2; j++) {
      const story = { ...buildStoryFromSession({ id: `session-${i}-${j}`, title: '同名', createdAt: 1,
        character: { name: character.name }, user: { name: '用户' },
        messages: [{ id: 'm1', role: 'assistant' as const, content: '保留完整正文'.repeat(100) }],
        rawMetadata: { ste_catalog: { fileName: '共同名称', aliases: ['旧名称'] }, chat_metadata: { plugin: { keep: true } } },
      }, character.id), id: `s${i}-${j}` };
      await disk.writeText(`角色/C${i}/故事/S${j}/故事.json`, JSON.stringify(story));
    }
  }
  const read = vi.spyOn(disk, 'readText');
  const vault = createVault(disk), stories = vault.repo<ArchiveStory>('archiveStories'), characters = vault.repo<ArchiveCharacter>('characters');
  await stories.listLight(); read.mockClear();
  const catalog = await createRoleplayCatalog({ stories, characters, storyId: 's0-0' });
  const people = await catalog.characters();
  expect(people).toHaveLength(12);
  const bodyPaths = () => read.mock.calls.map(([file]) => file).filter(file => file.endsWith('/故事.json'));
  expect(bodyPaths().every(file => file === '角色/C0/故事/S0/故事.json')).toBe(true);
  const chats = await catalog.chats(avatarKey('c0'));
  expect(chats).toHaveLength(2);
  expect(new Set(chats.map(chat => chat.file_name)).size).toBe(2);
  expect(chats[0]).toMatchObject({ chat_items: 1, metadata: { plugin: { keep: true } } });
  expect(bodyPaths().every(file => file.startsWith('角色/C0/'))).toBe(true);
  const line = await catalog.existingLine(avatarKey('c0'), chats[0].file_name);
  expect(line?.line.session.messages[0].content).toBe('保留完整正文'.repeat(100));
});
