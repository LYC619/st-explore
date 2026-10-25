import { createMemFs, type VaultFs } from '@/lib/vault/fs';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';

/** Synthetic data only. Counts storage work without timing the memory filesystem. */
export async function performanceFixture(characterCount = 48, storiesPerCharacter = 2) {
  const raw = createMemFs();
  const calls = { text: [] as string[], binary: [] as string[], writes: [] as string[] };
  const fs: VaultFs = {
    ...raw,
    readText: async path => { calls.text.push(path); return raw.readText(path); },
    readBinary: async path => { calls.binary.push(path); return raw.readBinary(path); },
    writeText: async (path, value) => { calls.writes.push(path); return raw.writeText(path, value); },
  };
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  await raw.writeText('库信息.json', JSON.stringify({ id: 'archive-schema', schemaVersion: 2, updatedAt: 1 }));
  for (let c = 0; c < characterCount; c++) {
    const character: ArchiveCharacter = { id: `perf-c${c}`, name: `性能角色${c}`, card: { name: `性能角色${c}`, description: '保留完整卡片正文' },
      tags: [], status: '未开始', createdAt: 1, updatedAt: c + 1 };
    const dir = `角色/${character.name}`;
    await raw.writeText(`${dir}/档案.json`, JSON.stringify(character));
    await raw.writeBinary(`${dir}/卡片.png`, png);
    for (let i = 0; i < storiesPerCharacter; i++) {
      const id = `perf-s${c}-${i}`;
      const story: ArchiveStory = { id, title: `性能故事${c}-${i}`, characterId: character.id,
        session: { id, title: id, messages: Array.from({ length: 48 }, (_, floor) => ({ id: `${id}-m${floor}`, role: 'assistant',
          content: '用于核对读取范围的正文。'.repeat(100), timestamp: 1000 + floor })),
          character: { name: character.name }, user: { name: '测试' }, createdAt: 1 },
        markers: [], meta: { modelsUsed: [], playTimeMs: null }, createdAt: 1, updatedAt: i + 1 };
      await raw.writeText(`${dir}/故事/${story.title}/故事.json`, JSON.stringify(story));
    }
  }
  return { fs, raw, calls, reset: () => { calls.text.length = 0; calls.binary.length = 0; calls.writes.length = 0; } };
}
