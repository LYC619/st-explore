// @vitest-environment node
/**
 * 阅读包往返：库内实体 → 包字节 → 解析 → 还原回实体。
 *
 * 必须声明 node 环境。jsdom 会把 Uint8Array 换成另一个 realm 的构造器，
 * fflate 在里面会走错分支——zipSync 把 96KB 文本「压」成 9.7MB 且解不回来，
 * 连 level:0（STORE，本来不可能膨胀）都一样。同一段代码在 node 下完全正常。
 * 详见 src/test/setup.ts 的说明。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { buildReadingPack, suggestPackFileName } from '@/lib/reading-pack/export';
import {
  ReadingPackError, buildExistingIndex, parseReadingPackBytes, previewReadingPack,
  restoreCharacter, restoreStory,
} from '@/lib/reading-pack/import';
import { READING_PACK_FORMAT } from '@/types/reading-pack';
import type { ArchiveCharacter, ArchiveStory, StoryBranch } from '@/types/archive';
import type { SummaryItem } from '@/types/summary';
import { readingPackSource, type ImportSink } from '@/lib/data-source';
import { getCharacter, getArchiveStory, saveCharacter, saveArchiveStory } from '@/lib/archive-db';
import { saveSummary } from '@/lib/summary-db';
import { closeDB, openDB } from '@/lib/idb';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';

/** 一小张「PNG」：内容无所谓，只验字节原样往返 */
const cardBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 250, 251, 252]);
const portraitBytes = new Uint8Array([0xff, 0xd8, 0xff, 9, 8, 7]);

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const character = (over: Partial<ArchiveCharacter> = {}): ArchiveCharacter => ({
  id: 'char-1',
  name: '赫敏',
  card: { name: '赫敏', description: '设定' } as ArchiveCharacter['card'],
  pngBase64: toBase64(cardBytes),
  tags: ['卡面/SFW'],
  status: '未开始',
  rating: 8.5,
  notes: [{ id: 'n1', body: '好卡', at: 100 }],
  portraitRows: [{
    id: 'row-1',
    title: '日常',
    items: [{
      id: 'p1', source: 'manual', name: '立绘1',
      dataBase64: toBase64(portraitBytes), mime: 'image/jpeg', addedAt: 200,
    }],
  }],
  // 这三个是本机专有的，不该进包
  attachments: [{ id: 'a1', title: '攻略.html', path: '角色/赫敏/附件/攻略.html', size: 10, addedAt: 1 }],
  assets: [{ kind: 'worldbook', assetId: 'wb-1' }],
  sourcePath: 'D:/ST/characters/赫敏.png',
  createdAt: 1,
  updatedAt: 1000,
  ...over,
});

const story = (over: Partial<ArchiveStory> = {}): ArchiveStory => ({
  id: 'story-1',
  characterId: 'char-1',
  title: '主线',
  session: {
    id: 's1', title: '主线', createdAt: 1,
    character: { name: '赫敏' }, user: { name: '我' },
    messages: [
      { id: 'm1', role: 'assistant', content: '第一楼' },
      { id: 'm2', role: 'user', content: '第二楼' },
    ],
  } as unknown as ArchiveStory['session'],
  markers: [{ messageId: 'm1', messageIndex: 0, title: '第一章' } as never],
  favorites: ['m1'],
  meta: { modelsUsed: ['gpt'], playTimeMs: 1000 },
  status: '进行中',
  rating: 7,
  lastFloor: 42,
  lastViewedAt: 9999,
  sourcePath: 'D:/ST/chats/赫敏/主线.jsonl',
  writebacks: [{ at: 1, floors: 2 }],
  createdAt: 1,
  updatedAt: 2000,
  ...over,
});

const summary = (over: Partial<SummaryItem> = {}): SummaryItem => ({
  id: 'sum-1',
  bookId: 'story-1',
  bookTitle: '主线',
  kind: 'volume',
  title: '第一卷',
  floorStart: 0,
  floorEnd: 1,
  content: '卷一内容',
  createdAt: 1,
  updatedAt: 1500,
  ...over,
});

function pack(over: {
  characters?: ArchiveCharacter[];
  stories?: ArchiveStory[];
  summaries?: SummaryItem[];
} = {}) {
  return buildReadingPack({
    characters: over.characters ?? [character()],
    stories: over.stories ?? [story()],
    summaries: over.summaries ?? [summary()],
    appVersion: 'v0.9.0',
    now: () => Date.UTC(2026, 8, 1),
  });
}

describe('阅读包 · 打包与解析', () => {
  it('manifest 带足认包所需的标记与清单', () => {
    const { manifest } = pack();
    expect(manifest.app).toBe('silly-tavern-explorer');
    expect(manifest.kind).toBe('reading-pack');
    expect(manifest.format).toBe(READING_PACK_FORMAT);
    expect(manifest.characters).toEqual([
      { id: 'char-1', name: '赫敏', updatedAt: 1000, storyCount: 1 },
    ]);
    expect(manifest.stories[0]).toMatchObject({ id: 'story-1', title: '主线', floors: 2 });
    expect(manifest.summaryCount).toBe(1);
    // 卡面 + 一张立绘
    expect(manifest.mediaCount).toBe(2);
  });

  it('图片走独立二进制条目，字节原样往返', () => {
    const parsed = parseReadingPackBytes(pack().bytes);
    const restored = restoreCharacter(parsed, parsed.characters[0]);
    expect(restored.pngBase64).toBe(toBase64(cardBytes));
    expect(restored.portraitRows?.[0].items[0].dataBase64).toBe(toBase64(portraitBytes));
    // 不是内联在 JSON 里
    expect(JSON.stringify(parsed.characters[0])).not.toContain(toBase64(cardBytes));
  });

  it('本机专有字段不进包：附件、资产引用、来源路径、写回历史', () => {
    const parsed = parseReadingPackBytes(pack().bytes);
    const c = parsed.characters[0] as unknown as Record<string, unknown>;
    expect(c.attachments).toBeUndefined();
    expect(c.assets).toBeUndefined();
    expect(c.sourcePath).toBeUndefined();
    const s = parsed.stories[0] as unknown as Record<string, unknown>;
    expect(s.sourcePath).toBeUndefined();
    expect(s.writebacks).toBeUndefined();
  });

  it('正文、章节标记、书签、评分、状态都带上了', () => {
    const parsed = parseReadingPackBytes(pack().bytes);
    const s = parsed.stories[0];
    expect(s.session.messages).toHaveLength(2);
    expect(s.markers).toHaveLength(1);
    expect(s.favorites).toEqual(['m1']);
    expect(s.rating).toBe(7);
    expect(s.status).toBe('进行中');
    expect(parsed.summaries[0].content).toBe('卷一内容');
  });

  it('只带属于被选故事的总结', () => {
    const { manifest } = pack({
      summaries: [summary(), summary({ id: 'sum-2', bookId: 'story-other' })],
    });
    expect(manifest.summaryCount).toBe(1);
  });

  it('客户端立绘只有文件名、字节不在库条目上时，保留条目但没有图', () => {
    const c = character({
      portraitRows: [{
        id: 'row-1', title: '日常',
        items: [{ id: 'p1', source: 'manual', fileName: '01.png', mime: 'image/png', addedAt: 1 }],
      }],
    });
    const parsed = parseReadingPackBytes(pack({ characters: [c] }).bytes);
    const restored = restoreCharacter(parsed, parsed.characters[0]);
    expect(restored.portraitRows?.[0].items).toHaveLength(1);
    expect(restored.portraitRows?.[0].items[0].dataBase64).toBeUndefined();
  });

  it('建议文件名：单角色用角色名，多角色报个数', () => {
    expect(suggestPackFileName(pack().manifest)).toBe('赫敏-2026-09-01.ste-reading');
    const multi = pack({ characters: [character(), character({ id: 'c2', name: '罗恩' })] });
    expect(suggestPackFileName(multi.manifest)).toBe('2 个角色-2026-09-01.ste-reading');
  });
});

describe('阅读包 · 拒绝坏输入', () => {
  it('不是 zip', () => {
    expect(() => parseReadingPackBytes(new Uint8Array([1, 2, 3, 4])))
      .toThrow(ReadingPackError);
  });

  /** 重打一个包，只把 manifest 换成指定内容 */
  const repackWithManifest = (manifest: unknown): Uint8Array => {
    const entries = unzipSync(pack().bytes);
    entries['manifest.json'] = strToU8(JSON.stringify(manifest));
    return zipSync(entries);
  };

  it('格式版本比当前新时明确拒绝，而不是猜着解', () => {
    const base = parseReadingPackBytes(pack().bytes).manifest;
    const bytes = repackWithManifest({ ...base, format: READING_PACK_FORMAT + 1 });
    expect(() => parseReadingPackBytes(bytes)).toThrow(/格式版本/);
  });

  it('缺 app/kind 标记的 zip 不当阅读包收', () => {
    const base = parseReadingPackBytes(pack().bytes).manifest;
    expect(() => parseReadingPackBytes(repackWithManifest({ ...base, app: 'other-app' })))
      .toThrow(/不像本应用/);
    expect(() => parseReadingPackBytes(repackWithManifest({ ...base, kind: 'full-backup' })))
      .toThrow(/不像本应用/);
  });

  it('没有 manifest 的 zip 直接拒绝', () => {
    const entries = unzipSync(pack().bytes);
    delete entries['manifest.json'];
    expect(() => parseReadingPackBytes(zipSync(entries))).toThrow(/没有 manifest/);
  });

  it('manifest 不是合法 JSON 时报到具体条目', () => {
    const entries = unzipSync(pack().bytes);
    entries['manifest.json'] = strToU8('{not json');
    expect(() => parseReadingPackBytes(zipSync(entries))).toThrow(/manifest\.json 不是合法 JSON/);
  });
});

describe('阅读包 · 去重与进度保护', () => {
  const emptyIndex = () => buildExistingIndex([], [], []);

  it('本地没有 = 全部新增', () => {
    const parsed = parseReadingPackBytes(pack().bytes);
    const preview = previewReadingPack(parsed, emptyIndex());
    expect(preview.totals).toEqual({ add: 3, overwrite: 0, skip: 0 });
  });

  it('重复导入同一个包 = 一条不写', () => {
    const parsed = parseReadingPackBytes(pack().bytes);
    const index = buildExistingIndex(
      [{ id: 'char-1', updatedAt: 1000 }],
      [{ id: 'story-1', updatedAt: 2000 }],
      [{ id: 'sum-1', updatedAt: 1500 }],
    );
    const preview = previewReadingPack(parsed, index);
    expect(preview.totals).toEqual({ add: 0, overwrite: 0, skip: 3 });
  });

  it('包里更新才覆盖，本地更新就保留本地', () => {
    const parsed = parseReadingPackBytes(pack().bytes);
    const index = buildExistingIndex(
      [{ id: 'char-1', updatedAt: 999 }],   // 包更新 → 覆盖
      [{ id: 'story-1', updatedAt: 3000 }], // 本地更新 → 跳过
      [],
    );
    const preview = previewReadingPack(parsed, index);
    expect(preview.characters[0].action).toBe('overwrite');
    expect(preview.stories[0].action).toBe('skip');
    expect(preview.stories[0].reason).toContain('保留本地');
    expect(preview.summaries[0].action).toBe('add');
  });

  /** 这条是阅读设备的要害：覆盖内容可以，撕书签不行 */
  it('覆盖故事时本地阅读进度必须留下', () => {
    const parsed = parseReadingPackBytes(pack().bytes);
    const local = story({ lastFloor: 777, lastViewedAt: 88888, lastViewedBranchId: 'br-9' });
    const restored = restoreStory(parsed.stories[0], local);

    expect(restored.lastFloor).toBe(2);
    expect(restored.lastViewedAt).toBe(88888);
    // 不复活已被接收端删除的分支。
    expect(restored.lastViewedBranchId).toBeUndefined();
    // 内容仍然来自包
    expect(restored.session.messages).toHaveLength(2);
    expect(restored.rating).toBe(7);
    // 本机专有字段不被抹掉
    expect(restored.sourcePath).toBe('D:/ST/chats/赫敏/主线.jsonl');
    expect(restored.writebacks).toHaveLength(1);
  });

  it('本地没有这篇故事时，用包里的进度（可能是别的设备读到的地方）', () => {
    const parsed = parseReadingPackBytes(pack().bytes);
    const restored = restoreStory(parsed.stories[0]);
    expect(restored.lastFloor).toBe(2);
  });
});

const sessionWithFloors = (count: number): ArchiveStory['session'] => ({
  ...story().session,
  messages: Array.from({ length: count }, (_, i) => ({
    id: `m${i}`, role: 'assistant', content: `Floor ${i + 1}`,
  })),
});

const branch = (id: string, count: number, lastFloor?: number): StoryBranch => ({
  id, name: id, session: sessionWithFloors(count), lastFloor,
  markers: [], createdAt: 1, updatedAt: 2,
});

describe('reading pack field ownership', () => {
  it.each([false, true])('strips injected device fields (overwrite=%s)', (overwrite) => {
    const parsed = parseReadingPackBytes(pack().bytes);
    const injected = JSON.parse(JSON.stringify({
      ...parsed.characters[0],
      attachments: character().attachments,
      assets: character().assets,
      unresolvedAssets: [{ kind: 'worldbook', name: 'injected', relation: 'primary' }],
      sourcePath: 'C:/other-device/card.png',
      pngBase64: 'injected',
    }));
    const local = overwrite ? character({
      attachments: undefined, assets: undefined, unresolvedAssets: undefined, sourcePath: undefined,
    }) : undefined;
    const restored = restoreCharacter(parsed, injected, local);
    for (const key of ['attachments', 'assets', 'unresolvedAssets', 'sourcePath'] as const) {
      expect(restored[key]).toBeUndefined();
    }
    expect(restored.pngBase64).toBe(toBase64(cardBytes));
    const restoredStory = restoreStory(JSON.parse(JSON.stringify({
      ...parsed.stories[0], sourcePath: 'C:/other-device/chat', writebacks: [{ at: 1, floors: 2 }],
      assets: character().assets, unresolvedAssets: injected.unresolvedAssets,
    })), overwrite ? story({
      sourcePath: undefined, writebacks: undefined, assets: undefined, unresolvedAssets: undefined,
    }) : undefined);
    for (const key of ['sourcePath', 'writebacks', 'assets', 'unresolvedAssets'] as const) {
      expect(restoredStory[key]).toBeUndefined();
    }
  });

  it('keeps receiver fields but imports new content', () => {
    const parsed = parseReadingPackBytes(pack().bytes);
    const local = character({ name: 'Local old content', unresolvedAssets: [
      { kind: 'worldbook', name: 'local', relation: 'primary' },
    ] });
    const restored = restoreCharacter(parsed, parsed.characters[0], local);
    expect(restored.name).toBe(character().name);
    for (const key of ['attachments', 'assets', 'unresolvedAssets', 'sourcePath'] as const) {
      expect(restored[key]).toEqual(local[key]);
    }
  });
});

describe('reading pack branch progress', () => {
  it('merges by ID, clamps to the new content and never resurrects removed branches', () => {
    const incoming = story({ session: sessionWithFloors(50), lastFloor: 3, branches: [
      branch('keep', 100, 2), branch('short', 20, 2), branch('new', 10, 99), branch('empty', 0, 1),
    ] });
    const local = story({ lastFloor: 40, lastViewedAt: 900, lastViewedBranchId: 'keep', branches: [
      branch('keep', 100, 80), branch('short', 100, 80), branch('removed', 10, 8),
    ] });
    const restored = restoreStory(incoming, local);
    expect(restored.lastFloor).toBe(40);
    expect(restored.lastViewedAt).toBe(900);
    expect(restored.lastViewedBranchId).toBe('keep');
    expect(restored.branches?.map(b => [b.id, b.lastFloor])).toEqual([
      ['keep', 80], ['short', 20], ['new', 10], ['empty', undefined],
    ]);
    expect(restoreStory(incoming, { ...local, lastViewedBranchId: 'removed' }).lastViewedBranchId)
      .toBeUndefined();
  });

  it('absent local progress wins over sender progress, including omitted properties', () => {
    const incoming = story({ lastViewedBranchId: 'keep', branches: [branch('keep', 100, 70)] });
    const local = story({ branches: [branch('keep', 100)] });
    delete local.lastFloor;
    delete local.lastViewedAt;
    delete local.lastViewedBranchId;
    delete local.branches![0].lastFloor;
    const restored = restoreStory(incoming, local);
    expect(restored.lastFloor).toBeUndefined();
    expect(restored.lastViewedAt).toBeUndefined();
    expect(restored.lastViewedBranchId).toBeUndefined();
    expect(restored.branches?.[0].lastFloor).toBeUndefined();
  });

  it.each([[-5, 1], [1.9, 1], [99, 2], [NaN, undefined], [Infinity, undefined]])(
    'clamps new mainline and branch floor %s to %s', (floor, expected) => {
      const restored = restoreStory(story({ lastFloor: floor, branches: [branch('new', 2, floor)] }));
      expect(restored.lastFloor).toBe(expected);
      expect(restored.branches?.[0].lastFloor).toBe(expected);
      expect(restoreStory(story({ session: sessionWithFloors(0), lastFloor: floor })).lastFloor)
        .toBeUndefined();
    },
  );
});

describe('reading pack apply uses current records', () => {
  const makeInput = (existing = true) => ({
    parsed: parseReadingPackBytes(pack({ summaries: [] }).bytes), origin: 'test.ste-reading',
    existing: {
      characters: existing ? [{ id: 'char-1', updatedAt: 1 }] : [],
      stories: existing ? [{ id: 'story-1', updatedAt: 1 }] : [], summaries: [],
    },
  });
  const makeSink = (localCharacter?: ArchiveCharacter, localStory?: ArchiveStory): ImportSink => ({
    getCharacter: vi.fn().mockResolvedValue(localCharacter),
    getStory: vi.fn().mockResolvedValue(localStory),
    saveCharacter: vi.fn(), saveStory: vi.fn(), saveSummary: vi.fn(),
  });

  it('does not resurrect overwrite targets deleted after inspect', async () => {
    const input = makeInput();
    const plan = await readingPackSource.inspect(input);
    const sink = makeSink();
    const result = await readingPackSource.apply(input, plan, sink);
    expect(result.skipped).toBe(2);
    expect(result.warnings).toHaveLength(2);
    expect(sink.saveCharacter).not.toHaveBeenCalled();
    expect(sink.saveStory).not.toHaveBeenCalled();
  });

  it.each([true, false])('redecides after a receiver update or concurrent add (existed=%s)', async (existed) => {
    const input = makeInput(existed);
    const plan = await readingPackSource.inspect(input);
    const sink = makeSink(character({ updatedAt: 9999 }), story({ updatedAt: 9999 }));
    const result = await readingPackSource.apply(input, plan, sink);
    expect(result.skipped).toBe(2);
    expect(sink.saveCharacter).not.toHaveBeenCalled();
    expect(sink.saveStory).not.toHaveBeenCalled();
  });

  it('propagates a fresh-read failure without writing', async () => {
    const input = makeInput();
    const sink = makeSink();
    vi.mocked(sink.getCharacter).mockRejectedValue(new Error('read failed'));
    await expect(readingPackSource.apply(input, await readingPackSource.inspect(input), sink))
      .rejects.toThrow('read failed');
    expect(sink.saveCharacter).not.toHaveBeenCalled();
    expect(sink.saveStory).not.toHaveBeenCalled();
  });
});

describe('reading pack persistence roundtrip', () => {
  beforeEach(() => { closeDB(); vi.stubGlobal('indexedDB', new IDBFactory()); });
  afterEach(() => { setActiveVault(null); closeDB(); vi.unstubAllGlobals(); });

  it.each(['vault', 'idb'] as const)('preserves receiver fields after reopening %s', async (backend) => {
    const fs = createMemFs();
    setActiveVault(backend === 'vault' ? createVault(fs) : null);
    const connection = backend === 'idb' ? await openDB() : undefined;
    const localCharacter = character({ pngBase64: undefined, portraitRows: [], updatedAt: 1,
      unresolvedAssets: [{ kind: 'worldbook', name: 'local', relation: 'primary' }],
    });
    const localStory = story({ updatedAt: 1, lastFloor: 2, branches: [branch('keep', 100, 80)] });
    await saveCharacter(localCharacter);
    await saveArchiveStory(localStory);
    const attachment = localCharacter.attachments![0];
    await fs.writeText(attachment.path, 'local attachment bytes');
    const input = {
      parsed: parseReadingPackBytes(pack({ characters: [character({ pngBase64: undefined, portraitRows: [], rating: 9 })],
        stories: [story({ branches: [branch('keep', 100, 1)] })], summaries: [],
      }).bytes),
      origin: 'test.ste-reading', existing: { characters: [localCharacter], stories: [localStory], summaries: [] },
    };
    await readingPackSource.apply(input, await readingPackSource.inspect(input), {
      getCharacter, getStory: getArchiveStory, saveCharacter, saveStory: saveArchiveStory, saveSummary,
    });
    if (backend === 'vault') setActiveVault(createVault(fs));
    else { closeDB(); expect(await openDB()).not.toBe(connection); }
    const restored = await getCharacter(localCharacter.id);
    expect(restored?.rating).toBe(9);
    for (const key of ['attachments', 'assets', 'unresolvedAssets', 'sourcePath'] as const) {
      expect(restored?.[key]).toEqual(localCharacter[key]);
    }
    expect(await fs.readText(attachment.path)).toBe('local attachment bytes');
    const restoredStory = await getArchiveStory(localStory.id);
    expect(restoredStory?.lastFloor).toBe(2);
    expect(restoredStory?.branches?.[0].lastFloor).toBe(80);
    expect(restoredStory?.sourcePath).toBe(localStory.sourcePath);
    expect(restoredStory?.writebacks).toEqual(localStory.writebacks);
  });
});

describe('阅读包 · 双向', () => {
  /**
   * 手机 → 电脑走的是同一份代码，所以这里只需要验 producedBy 记住了来路：
   * 接收端据此知道包是从哪种壳出来的（将来做进度合并要用）。
   */
  it('manifest 记下产出方的运行环境与版本', () => {
    const { manifest } = pack();
    // node 测试环境里既没有 __TAURI_INTERNALS__ 也没有 Capacitor → web
    expect(manifest.producedBy).toEqual({ runtime: 'web', appVersion: 'v0.9.0' });
  });
});
