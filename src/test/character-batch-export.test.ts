import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB } from '@/lib/idb';
import { saveCharacter, getCharacter } from '@/lib/archive-db';
import { saveWorldBook } from '@/lib/worldbook-db';
import { setActiveVault } from '@/lib/vault/active';
import { DEFAULT_ENTRY } from '@/types/worldbook';
import { extractCharacterFromPngBuffer } from '@/lib/png-parser';
import { tinyPngBase64 } from './fixtures/images';
import {
  buildCharacterExportFile,
  exportCharactersToDirectory,
} from '@/lib/character-batch-export';
import { createMemFs, type VaultFs } from '@/lib/vault/fs';
import type { ArchiveCharacter } from '@/types/archive';
import type { STCharacterCard } from '@/lib/png-parser';

const card = (name: string) => ({
  spec: 'chara_card_v2',
  data: { name },
}) as unknown as STCharacterCard;

function character(id: string, name: string, pngBase64?: string): ArchiveCharacter {
  return {
    id,
    name,
    card: card(name),
    pngBase64,
    tags: [],
    status: '未开始',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('character batch export', () => {
  beforeEach(() => { closeDB(); vi.stubGlobal('indexedDB', new IDBFactory()); setActiveVault(null); });
  afterEach(() => { closeDB(); vi.unstubAllGlobals(); });
  const seedCharacters = async (items: ArchiveCharacter[]) => {
    for (const item of items) await saveCharacter(item);
    return items;
  };

  it('导出包含角色数据的 PNG 和 JSON 角色卡', async () => {
    const fs = createMemFs();
    const png = character('png', '卡面角色', tinyPngBase64);
    const json = character('json', '文本角色');

    expect(buildCharacterExportFile(png)).toMatchObject({ extension: 'png', binaryBase64: tinyPngBase64 });
    expect(buildCharacterExportFile(json)).toMatchObject({ extension: 'json' });

    const result = await exportCharactersToDirectory(await seedCharacters([png, json]), fs);

    expect(result.failed).toEqual([]);
    expect(result.exported.map((item) => item.fileName)).toEqual(['卡面角色.png', '文本角色.json']);
    const bytes = Uint8Array.from(atob(await fs.readBinary('卡面角色.png')), ch => ch.charCodeAt(0));
    expect(extractCharacterFromPngBuffer(bytes.buffer)).toEqual(png.card);
    await expect(fs.readText('文本角色.json')).resolves.toContain('"name": "文本角色"');
  });

  it('清理 Windows 非法字符，并避让已有文件与批内重名', async () => {
    const fs = createMemFs();
    await fs.writeText('角色.json', '已有');
    const result = await exportCharactersToDirectory(await seedCharacters([
      character('1', '角色', tinyPngBase64),
      character('2', '角色'),
      character('3', '坏:/?*<>|"\u0001名'),
      character('4', 'CON'),
    ]), fs);

    expect(result.failed).toEqual([]);
    expect(result.exported.map((item) => item.fileName)).toEqual([
      '角色·2.png',
      '角色·3.json',
      '坏________名.json',
      '未命名.json',
    ]);
  });

  it('单个写入失败时继续导出其余角色，并返回真实结果', async () => {
    const memory = createMemFs();
    const fs: VaultFs = {
      ...memory,
      writeText: async (path, content) => {
        if (path.startsWith('坏角色')) throw new Error('磁盘已满');
        await memory.writeText(path, content);
      },
    };

    const result = await exportCharactersToDirectory(await seedCharacters([
      character('bad', '坏角色'),
      character('good', '好角色'),
    ]), fs);

    expect(result.exported).toEqual([{ id: 'good', fileName: '好角色.json' }]);
    expect(result.failed).toEqual([
      { id: 'bad', fileName: '坏角色.json', error: '磁盘已满' },
    ]);
    await expect(memory.readText('好角色.json')).resolves.toContain('好角色');
  });

  it.each(['json', 'png'])('目录导出重新读取角色绑定和当前世界书，来源保持原样 (%s)', async format => {
    const original = character('c', '角色', format === 'png' ? tinyPngBase64 : undefined);
    await saveCharacter({ ...original, assets: [{ kind: 'worldbook', assetId: 'live', relations: ['embedded'] }] });
    await saveWorldBook({ id: 'live', title: '当前书', createdAt: 1, updatedAt: 2,
      worldbook: { entries: { '7': { ...DEFAULT_ENTRY, uid: 7, content: '当前内容 B' } } } });
    const before = await getCharacter('c');
    const fs = createMemFs();
    const result = await exportCharactersToDirectory([original], fs);
    expect(result.failed).toEqual([]);
    const path = result.exported[0].fileName;
    const output = format === 'png'
      ? extractCharacterFromPngBuffer(Uint8Array.from(atob(await fs.readBinary(path)), ch => ch.charCodeAt(0)).buffer)
      : JSON.parse(await fs.readText(path));
    expect(output.data.character_book.entries[0].content).toBe('当前内容 B');
    expect(await getCharacter('c')).toEqual(before);
  });

  it('多候选、缺失绑定与已删除角色逐项报错，继续导出有效角色', async () => {
    const ambiguous = { ...character('a', '多候选'), assets: ['one', 'two'].map(assetId => ({ kind: 'worldbook' as const, assetId, relations: ['embedded' as const] })) };
    const missing = { ...character('b', '缺失书'), assets: [{ kind: 'worldbook' as const, assetId: 'missing', relations: ['embedded' as const] }] };
    const good = character('good', '有效角色');
    await seedCharacters([ambiguous, missing, good]);
    const fs = createMemFs();
    const result = await exportCharactersToDirectory([ambiguous, missing, character('deleted', '已删除'), good], fs);
    expect(result.failed.map(item => item.id)).toEqual(['a', 'b', 'deleted']);
    expect(result.failed[0].error).toContain('世界书');
    expect(result.exported).toEqual([{ id: 'good', fileName: '有效角色.json' }]);
    expect(await fs.list('')).toHaveLength(1);
  });
});
