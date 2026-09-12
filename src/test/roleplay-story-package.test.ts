// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { buildCharacterFromCard, buildStoryFromSession, readCharacterInQueue, saveArchiveStory, updateArchiveStory, withArchiveStoryLock } from '@/lib/archive-db';
import { closeDB, openDB } from '@/lib/idb';
import { getCurrentRepo } from '@/lib/repo';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { getActiveVault, setActiveVault } from '@/lib/vault/active';
import { createRuntimeStore } from '@/lib/roleplay/runtime-store';
import { digest } from '@/lib/roleplay/fingerprint';
import { branchKey } from '@/lib/roleplay/paths';
import { parsePreset } from '@/lib/preset-parser';
import { parseWorldBook, type WorldBookItem } from '@/types/worldbook';
import { embedCharaInPng, __test as png } from '@/lib/png-writer';
import { extractCharacterFromPngBuffer } from '@/lib/png-parser';
import { base64ToBytes, bytesToBase64 } from '@/lib/utils';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import type { PresetItem } from '@/types/preset';
import type { RegexCollectionItem } from '@/types/regex';
import { createStoryPackageAdapter, parseStoryPackage, STORY_PACKAGE_LIMITS, type StoryPackage } from '@/lib/roleplay/story-package';

function browserLibrary() { closeDB(); vi.stubGlobal('indexedDB', new IDBFactory()); setActiveVault(null); }
function desktopLibrary(fs = createMemFs()) { setActiveVault(createVault(fs)); return fs; }
beforeEach(browserLibrary);
afterEach(() => { setActiveVault(null); closeDB(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const journalPath = `.ste-control/roleplay/main/memory-journal/${digest('pending')}.json`;
const journalText = JSON.stringify({ schema: 1, operationId: 'pending', proposalDigest: 'a'.repeat(64), status: 'prepared',
  sourceRefs: [], manual: true, changes: [{ path: 'state.md', before: '旧文\r\n', after: '新文\r\n' }], foreign: { intact: true } }, null, 2).replaceAll('\n', '\r\n') + '\r\n';

async function seed() {
  const character: ArchiveCharacter & { foreign: unknown } = { ...buildCharacterFromCard({ spec: 'chara_card_v2',
    data: { name: '林', description: '未知卡字段应当保留', extensions: { foreign: { content: '留存' } } } }),
  id: 'character-one', createdAt: 1, updatedAt: 1, foreign: { archive: true }, assets: [{ kind: 'regex', assetId: 'regex-one' }] };
  const story: ArchiveStory & { foreign: unknown } = { ...buildStoryFromSession({ id: 'session-one', title: '雨夜', createdAt: 1,
    character: { name: '林' }, user: { name: '我' }, rawMetadata: { chat_metadata: { foreign: ['keep'] } },
    messages: [{ id: 'u1', role: 'user', content: '问路' }, { id: 'a1', role: 'assistant', content: '北门',
      rawData: { mes: '北门', swipe_id: 1, swipes: ['东门', '北门'], swipe_info: [{ foreign: 1 }, { foreign: 2 }],
        extra: { ste_runtime: { candidateId: 'candidate-original', turnId: 'successful-original' }, foreign: { keep: true } } } }] }, character.id),
  id: 'story-one', createdAt: 1, updatedAt: 1, foreign: { archive: ['keep'] },
  assets: [{ kind: 'worldbook', assetId: 'world-one', relations: ['primary'] }, { kind: 'preset', assetId: 'preset-one' }],
  branches: [{ id: '分支/一', name: '另一条路', createdAt: 2, updatedAt: 3,
    session: { id: 'branch-session', title: '分支', createdAt: 2, user: { name: '我' }, character: { name: '林' },
      messages: [{ id: 'b1', role: 'assistant', content: '西门', rawData: { foreign: true } }] }, markers: [], favorites: ['b1'] }] };
  const world: WorldBookItem & { foreign: unknown } = { id: 'world-one', title: '城', createdAt: 1, updatedAt: 1,
    worldbook: parseWorldBook({ entries: { 0: { uid: 0, key: ['城'], content: '一座旧城', foreign: { retain: true } } }, foreign: ['top'] }), foreign: { record: true } };
  const preset: PresetItem & { foreign: unknown } = { id: 'preset-one', title: '叙述', createdAt: 1, updatedAt: 1,
    preset: parsePreset({ prompts: [{ identifier: 'system', name: '系统', role: 'system', content: '继续故事', foreign: true }],
      prompt_order: [{ character_id: 100000, order: [{ identifier: 'system', enabled: true }] }], temperature: 0.9, foreign: { original: true } }), foreign: 'record' };
  const regex: RegexCollectionItem & { foreign: unknown } = { id: 'regex-one', title: '阅读规则', createdAt: 1, updatedAt: 1,
    rules: [{ id: 'r1', name: '旧→新', findRegex: '/旧/g', replaceString: '新', disabled: false, placement: ['assistant'], _raw: { foreign: true } }], foreign: { record: true } };
  await getCurrentRepo<ArchiveCharacter>('characters').put(character);
  await getCurrentRepo<WorldBookItem>('worldbooks').put(world);
  await getCurrentRepo<PresetItem>('presets').put(preset);
  await getCurrentRepo<RegexCollectionItem>('regexes').put(regex);
  await getCurrentRepo<RegexCollectionItem>('regexes').put({ ...regex, id: 'unrelated', title: '不相关' });
  await saveArchiveStory(story);
  const runtime = createRuntimeStore(story.id);
  await runtime.write('memory/main/state.md', '旧文\r\n');
  await runtime.write(`memory/${branchKey(story.branches![0].id)}/state.md`, '分支记忆\n');
  await runtime.write(journalPath, journalText);
  await runtime.write('.ste-control/roleplay/main/turns/pending.json', '{"status":"prepared","turnId":"pending","foreign":true}\n');
  return { character, story, world, preset, regex, runtime };
}

async function packageFixture() { const fixture = await seed(); return { ...fixture, output: await createStoryPackageAdapter().exportStory(fixture.story.id) }; }

it('exports complete branches, raw swipes, references and exact runtime bytes without recovering prepared work', async () => {
  const { story, runtime, output } = await packageFixture();
  const value = parseStoryPackage(output.text);
  expect(output.fileName).toMatch(/\.ste-play$/);
  expect(value.story).toEqual(story);
  expect(value.characters.map(item => item.id)).toEqual(['character-one']);
  expect(value.assets.regexes.map(item => item.id)).toEqual(['regex-one']);
  expect(value.assets.worldbooks.map(item => item.id)).toEqual(['world-one']);
  expect(value.assets.presets.map(item => item.id)).toEqual(['preset-one']);
  expect(value.files.find(file => file.path === journalPath)?.text).toBe(journalText);
  expect(await runtime.read(journalPath)).toBe(journalText);
  expect(value.files.find(file => file.path.endsWith('/turns/pending.json'))?.text).toContain('"prepared"');
});

it.each(['browser', 'desktop'] as const)('restores original identities and unknown fields in a fresh %s library', async backend => {
  const { output } = await packageFixture();
  if (backend === 'browser') browserLibrary(); else desktopLibrary();
  const adapter = createStoryPackageAdapter();
  const preview = await adapter.previewImport(output.text);
  expect(preview.canApply).toBe(true);
  expect(await getCurrentRepo<ArchiveStory>('archiveStories').list()).toEqual([]);
  expect(await adapter.applyImport(preview)).toMatchObject({ storyId: 'story-one', status: 'imported' });
  const reread = await adapter.exportStory('story-one');
  expect(reread.package.story).toEqual(output.package.story);
  expect(reread.package.characters).toEqual(output.package.characters);
  expect(reread.package.assets).toEqual(output.package.assets);
  expect(reread.package.files).toEqual(output.package.files);
});

it('does not write during preview, and identical replay does not rewrite files or timestamps', async () => {
  const { output } = await packageFixture(); const fs = desktopLibrary(); const adapter = createStoryPackageAdapter();
  const before = fs.dump(); const preview = await adapter.previewImport(output.package);
  expect(fs.dump()).toEqual(before);
  await adapter.applyImport(preview);
  const after = fs.dump(); const writes = vi.spyOn(fs, 'writeText');
  expect(await adapter.applyImport(await adapter.previewImport(output.text))).toMatchObject({ status: 'identical' });
  expect(writes).not.toHaveBeenCalled(); expect(fs.dump()).toEqual(after);
});

it('refuses any different asset before creating the story or changing another record', async () => {
  const { output, world } = await packageFixture(); const fs = desktopLibrary();
  await getCurrentRepo<WorldBookItem>('worldbooks').put({ ...world, title: '当地修改' });
  const before = fs.dump(); const adapter = createStoryPackageAdapter();
  const preview = await adapter.previewImport(output.package);
  expect(preview.canApply).toBe(false); expect(preview.conflicts.length).toBeGreaterThan(0);
  await expect(adapter.applyImport(preview)).rejects.toThrow(/冲突|不同/);
  expect(fs.dump()).toEqual(before);
});

it('rechecks stale previews and never treats an edited story or missing runtime file as identical', async () => {
  const { output } = await packageFixture(); desktopLibrary(); const adapter = createStoryPackageAdapter();
  const ready = await adapter.previewImport(output.text);
  await saveArchiveStory({ ...output.package.story, title: '本地新内容' });
  await expect(adapter.applyImport(ready)).rejects.toThrow(/冲突|变化|不同/);
  expect(await getCurrentRepo<ArchiveCharacter>('characters').list()).toEqual([]);
  desktopLibrary(); const next = createStoryPackageAdapter(); await next.applyImport(await next.previewImport(output.text));
  const old = await next.previewImport(output.text);
  await createRuntimeStore('story-one').remove('memory/main/state.md');
  await expect(next.applyImport(old)).rejects.toThrow(/冲突|变化|不同/);
  expect(await createRuntimeStore('story-one').read('memory/main/state.md')).toBeNull();
});

it('rejects previews from another adapter and stale vault epochs, including switches away and back', async () => {
  const { output } = await packageFixture(); desktopLibrary(); const original = getActiveVault();
  const adapter = createStoryPackageAdapter(); const preview = await adapter.previewImport(output.text);
  await expect(createStoryPackageAdapter().applyImport(preview)).rejects.toThrow(/预览/);
  setActiveVault(null); setActiveVault(original);
  await expect(adapter.applyImport(preview)).rejects.toThrow(/切换/);
  expect(await getCurrentRepo<ArchiveStory>('archiveStories').list()).toEqual([]);
});

it('does not capture or mutate another vault after an import waits in the story queue', async () => {
  const { output } = await packageFixture(); const old = desktopLibrary(); const adapter = createStoryPackageAdapter();
  const preview = await adapter.previewImport(output.text); let entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const blocking = withArchiveStoryLock('story-one', async () => { entered(); await gate; }); await reached;
  const applying = adapter.applyImport(preview); const rejected = expect(applying).rejects.toThrow(/切换/);
  const fresh = desktopLibrary(); release(); await blocking; await rejected;
  expect(old.dump()).toEqual({}); expect(fresh.dump()).toEqual({});
});

it('stops a switched import before queued character reads can recover old portrait journals', async () => {
  const { output, character } = await packageFixture(); const fs = desktopLibrary(); const vault = getActiveVault()!;
  await vault.repo<ArchiveCharacter>('characters').put(character);
  const directory = await vault.pathOf('characters', character.id); const adapter = createStoryPackageAdapter();
  const preview = await adapter.previewImport(output.text);
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const blocking = readCharacterInQueue(character.id, async () => { entered(); await gate; }); await reached;
  const operationId = '22222222-2222-4222-8222-222222222222'; const created = `立绘/行/.ste-portrait-${operationId}-0.png`;
  await fs.writeBinary(directory + '/' + created, 'AA==');
  await fs.writeText(directory + '/.ste-control/portrait-journal/' + operationId + '.json', JSON.stringify({ version: 1,
    operationId, characterId: character.id, status: 'prepared', beforeRows: [],
    afterRows: [{ id: 'row', title: '行', items: [{ id: 'portrait', source: 'manual', fileName: created.split('/').at(-1), addedAt: 1 }] }],
    createdFiles: [created], cleanupFiles: [], createdAt: 1 }));
  const before = fs.dump(); const applying = adapter.applyImport(preview); const rejected = expect(applying).rejects.toThrow(/切换/);
  await new Promise(resolve => setTimeout(resolve, 5)); const fresh = desktopLibrary(); release(); await blocking; await rejected;
  expect(fs.dump()).toEqual(before); expect(fresh.dump()).toEqual({});
});

it('stops staging after a vault switch and retries without exposing incomplete story files', async () => {
  const { output } = await packageFixture(); const fs = desktopLibrary(); const adapter = createStoryPackageAdapter();
  const preview = await adapter.previewImport(output.text); const fresh = createMemFs(); let switched = false;
  const write = fs.writeText.bind(fs);
  fs.writeText = async (path, text) => { await write(path, text); if (!switched && path.startsWith('.ste-control/story-packages/')) {
    switched = true; setActiveVault(createVault(fresh)); } };
  await expect(adapter.applyImport(preview)).rejects.toThrow(/切换/); expect(fresh.dump()).toEqual({});
  setActiveVault(createVault(fs)); expect(await getCurrentRepo<ArchiveStory>('archiveStories').list()).toEqual([]);
  const retry = createStoryPackageAdapter(); await retry.applyImport(await retry.previewImport(output.text));
  expect(await createRuntimeStore('story-one').read(journalPath)).toBe(journalText);
});

it('recovers an atomic publication whose successful rename lost its acknowledgment', async () => {
  const { output } = await packageFixture(); const fs = desktopLibrary(); const rename = fs.rename.bind(fs);
  fs.rename = async (from, to) => { await rename(from, to); throw new Error('发布响应丢失'); };
  const adapter = createStoryPackageAdapter(); await adapter.applyImport(await adapter.previewImport(output.text));
  expect(await getCurrentRepo<ArchiveStory>('archiveStories').list()).toHaveLength(1);
  expect(await createRuntimeStore('story-one').read(journalPath)).toBe(journalText);
  setActiveVault(createVault(fs)); const reopened = createStoryPackageAdapter();
  expect(await reopened.applyImport(await reopened.previewImport(output.text))).toMatchObject({ status: 'identical' });
});

it('keeps failed staging invisible and retries after reopening the desktop library', async () => {
  const { output } = await packageFixture(); const fs = desktopLibrary();
  const write = fs.writeText.bind(fs); let fail = true;
  fs.writeText = async (path, text) => { if (path.startsWith('.ste-control/story-packages/') && path.endsWith(journalPath) && fail) {
    fail = false; throw new Error('模拟磁盘中断'); } await write(path, text); };
  const adapter = createStoryPackageAdapter();
  await expect(adapter.applyImport(await adapter.previewImport(output.text))).rejects.toThrow(/中断/);
  expect(await getCurrentRepo<ArchiveStory>('archiveStories').list()).toEqual([]);
  expect(Object.keys(fs.dump()).filter(path => path.endsWith('故事.json') && !path.startsWith('.ste-control/'))).toEqual([]);
  setActiveVault(createVault(fs)); const retry = createStoryPackageAdapter();
  await retry.applyImport(await retry.previewImport(output.text));
  expect(await createRuntimeStore('story-one').read(journalPath)).toBe(journalText);
  expect(await getCurrentRepo<ArchiveStory>('archiveStories').list()).toHaveLength(1);
});

it('publishes only a fully staged story and can retry a failed directory rename', async () => {
  const { output } = await packageFixture(); const fs = desktopLibrary();
  const rename = fs.rename.bind(fs); let fail = true;
  fs.rename = async (from, to) => { if (from.startsWith('.ste-control/story-packages/') && from.endsWith('/story') && fail) { fail = false; throw new Error('模拟发布中断'); }
    if (from.startsWith('.ste-control/story-packages/') && from.endsWith('/story')) expect(await fs.readText(from + '/' + journalPath)).toBe(journalText);
    await rename(from, to); };
  const adapter = createStoryPackageAdapter(); const preview = await adapter.previewImport(output.package);
  await expect(adapter.applyImport(preview)).rejects.toThrow(/发布中断/);
  expect(await getCurrentRepo<ArchiveStory>('archiveStories').list()).toEqual([]);
  await adapter.applyImport(preview);
  expect(await createRuntimeStore('story-one').read(journalPath)).toBe(journalText);
});

it('aborts a browser transaction without publishing any partial story, asset or runtime data', async () => {
  const { output } = await packageFixture(); browserLibrary(); const adapter = createStoryPackageAdapter();
  const preview = await adapter.previewImport(output.text); const db = await openDB(); const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, 'transaction').mockImplementation((stores, mode, options) => {
    const tx = transaction(stores, mode, options);
    if (mode === 'readwrite') queueMicrotask(() => tx.abort());
    return tx;
  });
  await expect(adapter.applyImport(preview)).rejects.toThrow(); spy.mockRestore();
  expect(await getCurrentRepo<ArchiveStory>('archiveStories').list()).toEqual([]);
  expect(await getCurrentRepo<ArchiveCharacter>('characters').list()).toEqual([]);
  expect(await getCurrentRepo<WorldBookItem>('worldbooks').list()).toEqual([]);
  await adapter.applyImport(preview);
  expect(await createRuntimeStore('story-one').read(journalPath)).toBe(journalText);
});

it('serializes export with story edits and uses the same captured story/runtime snapshot', async () => {
  const fs = desktopLibrary(); const { story } = await seed(); const adapter = createStoryPackageAdapter();
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const read = fs.readText.bind(fs); let once = true;
  fs.readText = async path => { const text = await read(path); if (once && path.endsWith('/memory/main/state.md')) { once = false; entered(); await gate; } return text; };
  const exporting = adapter.exportStory(story.id); await reached; let finished = false;
  const editing = updateArchiveStory(story.id, current => ({ title: '改名', session: { ...current.session, messages: [] } })).then(() => { finished = true; });
  try { await new Promise(resolve => setTimeout(resolve, 5)); expect(finished).toBe(false); } finally { release(); }
  const result = await exporting; await editing;
  expect(result.package.story.title).toBe('雨夜'); expect(result.package.story.session.messages).toHaveLength(2);
  expect(result.package.files.find(file => file.path === 'memory/main/state.md')?.text).toBe('旧文\r\n');
});

it('includes worldbooks referenced by historical version files even when no current attachment remains', async () => {
  const { story, runtime } = await seed();
  await updateArchiveStory(story.id, () => ({ assets: [] }));
  await runtime.write('.ste-control/roleplay/main/worldbook-versions/entry/history.json', '{"worldId":"world-one","status":"draft"}\n');
  const { package: value } = await createStoryPackageAdapter().exportStory(story.id);
  expect(value.assets.worldbooks.map(item => item.id)).toEqual(['world-one']);
});

it('detaches machine paths, excludes credentials and executable packages, and keeps safe provenance and unknown fields', async () => {
  const { character, preset, story } = await seed();
  const card = { ...character.card, sourcePath: 'C:\\Private\\original.png', data: { ...character.card.data,
    extensions: { api_key_openai: 'SECRET-CARD', foreign: { keep: true }, installedBaiBai: { files: { 'dist/index.js': 'dangerous()' } } } } };
  const imageBytes = png.encodeChunks([{ type: 'IHDR', data: new Uint8Array([0,0,0,1,0,0,0,1,8,6,0,0,0]) },
    { type: 'IDAT', data: new Uint8Array([0x78,0x9c,0x62,0,1,0,0,5,0,1]) },
    { type: 'tEXt', data: new TextEncoder().encode('private\0C:\\Private\\SECRET-METADATA') }, { type: 'IEND', data: new Uint8Array() }]);
  await getCurrentRepo<ArchiveCharacter>('characters').put({ ...character, card,
    pngBase64: bytesToBase64(embedCharaInPng(imageBytes.buffer as ArrayBuffer, card)), sourcePath: 'D:/Personal/cards/original.png' });
  await getCurrentRepo<PresetItem>('presets').put({ ...preset, sourcePath: '/home/private/preset.json',
    preset: { ...preset.preset, originalData: { ...preset.preset.originalData, max_tokens: 4000,
      provenance: { sourcePath: 'https://person:SECRET-SOURCE@source.example/original.json?api_key=SECRET-SOURCE-QUERY' },
      headers: { Authorization: 'SECRET-PRESET' }, apiKey: 'SECRET-API', custom_url: 'https://name:SECRET-PASSWORD@example.com/v1?api_key=SECRET-QUERY' } } });
  await updateArchiveStory(story.id, () => ({ sourcePath: 'C:/Private/chat.jsonl' }));
  const { package: value, text } = await createStoryPackageAdapter().exportStory(story.id);
  expect(text).not.toContain('SECRET'); expect(text).not.toContain('C:/Private'); expect(text).not.toContain('/home/private');
  expect(value.story.sourcePath).toBeUndefined(); expect(value.omissions.some(item => item.name === 'chat.jsonl')).toBe(true);
  expect(value.characters[0].card.data?.extensions).toMatchObject({ foreign: { keep: true } });
  expect(value.assets.presets[0].preset.originalData.max_tokens).toBe(4000);
  const restoredPng = base64ToBytes(value.characters[0].pngBase64!);
  expect(JSON.stringify(extractCharacterFromPngBuffer(restoredPng.buffer as ArrayBuffer))).not.toContain('SECRET');
  expect(png.extractChunks(restoredPng).filter(chunk => chunk.type === 'tEXt')).toHaveLength(1);
  desktopLibrary(); const adapter = createStoryPackageAdapter(); await adapter.applyImport(await adapter.previewImport(value));
  expect((await adapter.exportStory(story.id)).package.story).toEqual(value.story);
});

it('rejects unsafe runtime JSON instead of rewriting recovery journal bytes', async () => {
  const { story, runtime } = await seed(); await runtime.write(journalPath, '{"status":"prepared","api_key":"must-not-travel"}');
  await expect(createStoryPackageAdapter().exportStory(story.id)).rejects.toThrow(/凭据|安全|运行文件/);
  expect(await runtime.read(journalPath)).toContain('must-not-travel');
});

it.each(['memory/main/local.ini', 'memory/main/state.md', '.ste-control/roleplay/main/history.jsonl'])('rejects credential configuration in %s without changing it', async path => {
  const { story, runtime } = await seed();
  const text = path.endsWith('.jsonl') ? '{"event":"first"}\n{"headers":{"Authorization":"secret"}}\n' : 'api_key = "secret"\n';
  await runtime.write(path, text);
  await expect(createStoryPackageAdapter().exportStory(story.id)).rejects.toThrow(/凭据|安全|运行文件/);
  expect(await runtime.read(path)).toBe(text);
});

it('preserves ordinary unknown filename and attachment metadata that is not an external character file', async () => {
  const { story } = await seed();
  await updateArchiveStory(story.id, () => ({ foreign: { filename: 'chapter-01.md', attachments: { annotation: 'retain' } } } as Partial<ArchiveStory>));
  const value = (await createStoryPackageAdapter().exportStory(story.id)).package;
  expect((value.story as unknown as Record<string, unknown>).foreign).toEqual({ filename: 'chapter-01.md', attachments: { annotation: 'retain' } });
});

it('round-trips a preset with inline regex originals and unknown normalized container fields', async () => {
  const { preset, world, story } = await seed();
  const withRegex = parsePreset({ prompts: [{ identifier: 'system', name: 'System', role: 'system', content: '原文' }],
    prompt_order: [{ character_id: 100000, order: [{ identifier: 'system', enabled: true }] }],
    extensions: { regex_scripts: [{ scriptName: 'Native', findRegex: '/x/g', replaceString: 'y', placement: [2], foreign: 'original' }] } });
  Object.assign(withRegex.promptOrder[0], { foreign: { group: true } });
  Object.assign(withRegex.promptOrder[0].order[0], { foreign: { entry: true } });
  Object.assign(withRegex, { foreign: { wrapper: true } });
  await getCurrentRepo<PresetItem>('presets').put({ ...preset, preset: withRegex });
  Object.assign(world.worldbook, { foreign: { wrapper: true } }); await getCurrentRepo<WorldBookItem>('worldbooks').put(world);
  const output = await createStoryPackageAdapter().exportStory(story.id); desktopLibrary(); const adapter = createStoryPackageAdapter();
  await adapter.applyImport(await adapter.previewImport(output.text));
  expect((await adapter.exportStory(story.id)).package.assets).toEqual(output.package.assets);
  const vault = getActiveVault()!; const path = (await vault.pathOf('presets', preset.id))!;
  const native = JSON.parse(await vault.fs.readText(path)); native.prompts[0].content = '外部编辑';
  await vault.fs.writeText(path, JSON.stringify(native));
  const changed = await adapter.exportStory(story.id);
  expect(changed.package.assets.presets[0].preset.prompts[0].content).toBe('外部编辑');
});

it('omits executable helpers.json while preserving chat variables and reports the omission after re-export', async () => {
  const { story, runtime } = await seed(); const path = '.ste-control/roleplay/main/helpers.json';
  await runtime.write(path, '{"schema":1,"scripts":[{"content":"execute()","enabled":true}],"html":{"enabled":true}}');
  const output = await createStoryPackageAdapter().exportStory(story.id);
  expect(output.package.files.some(file => file.path === path)).toBe(false);
  expect(output.package.omissions).toContainEqual({ field: path, reason: 'executable' });
  const unsafe = structuredClone(output.package); unsafe.files.push({ path, text: '{}' });
  expect(() => parseStoryPackage(JSON.stringify(unsafe))).toThrow(/运行文件/);
  desktopLibrary(); const adapter = createStoryPackageAdapter(); await adapter.applyImport(await adapter.previewImport(output.text));
  expect((await adapter.exportStory(story.id)).package.omissions).toEqual(output.package.omissions);
});

it('does not run portrait-journal recovery when previewing an existing character', async () => {
  const { output, character } = await packageFixture(); const fs = desktopLibrary(); const vault = getActiveVault()!;
  await vault.repo<ArchiveCharacter>('characters').put(character);
  const directory = await vault.pathOf('characters', character.id);
  const operationId = '11111111-1111-4111-8111-111111111111';
  const created = `立绘/行/.ste-portrait-${operationId}-0.png`;
  await fs.writeBinary(directory + '/' + created, 'AA==');
  await fs.writeText(directory + '/.ste-control/portrait-journal/' + operationId + '.json', JSON.stringify({ version: 1,
    operationId, characterId: character.id, status: 'prepared', beforeRows: [],
    afterRows: [{ id: 'row', title: '行', items: [{ id: 'portrait', source: 'manual', fileName: created.split('/').at(-1), addedAt: 1 }] }],
    createdFiles: [created], cleanupFiles: [], createdAt: 1 }));
  const before = fs.dump(); await createStoryPackageAdapter().previewImport(output.text);
  expect(fs.dump()).toEqual(before);
});

it('keeps a failed character PNG import invisible and retryable', async () => {
  const { character, story } = await seed();
  const bytes = png.encodeChunks([{ type: 'IHDR', data: new Uint8Array([0,0,0,1,0,0,0,1,8,6,0,0,0]) },
    { type: 'IDAT', data: new Uint8Array([0x78,0x9c,0x62,0,1,0,0,5,0,1]) }, { type: 'IEND', data: new Uint8Array() }]);
  await getCurrentRepo<ArchiveCharacter>('characters').put({ ...character, pngBase64: bytesToBase64(embedCharaInPng(bytes.buffer as ArrayBuffer, character.card)) });
  const output = await createStoryPackageAdapter().exportStory(story.id); const fs = desktopLibrary();
  const write = fs.writeBinary.bind(fs); let fail = true;
  fs.writeBinary = async (path, base64) => { if (fail && path.endsWith('/卡片.png')) { fail = false; throw new Error('卡面写入中断'); } await write(path, base64); };
  const adapter = createStoryPackageAdapter(); const preview = await adapter.previewImport(output.text);
  await expect(adapter.applyImport(preview)).rejects.toThrow(/中断/);
  expect(await getCurrentRepo<ArchiveStory>('archiveStories').list()).toEqual([]);
  expect(await getCurrentRepo<ArchiveCharacter>('characters').list()).toEqual([]);
  setActiveVault(createVault(fs)); const retry = createStoryPackageAdapter();
  await retry.applyImport(await retry.previewImport(output.text));
  expect((await retry.exportStory(story.id)).package.characters).toEqual(output.package.characters);
});

it('detects a malformed orphan runtime row before committing a browser import', async () => {
  const { output } = await packageFixture(); browserLibrary();
  const db = await openDB(); const tx = db.transaction('roleplayFiles', 'readwrite');
  tx.objectStore('roleplayFiles').put({ id: 'wrong-id', storyId: 'story-one', path: 'memory/main/state.md', text: '旧文\r\n', updatedAt: 1 });
  await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); });
  const adapter = createStoryPackageAdapter(); const preview = await adapter.previewImport(output.text);
  await expect(adapter.applyImport(preview)).rejects.toThrow(/运行文件|身份/);
  expect(await getCurrentRepo<ArchiveStory>('archiveStories').list()).toEqual([]);
});

it('validates envelope, references, messages, file sizes, traversal and portable path collisions', async () => {
  const { output } = await packageFixture();
  const invalid = (change: (value: StoryPackage) => void) => { const value = structuredClone(output.package); change(value); expect(() => parseStoryPackage(JSON.stringify(value))).toThrow(); };
  invalid(value => { Object.assign(value, { plugins: [{ files: { 'x.js': 'run()' } }] }); });
  invalid(value => { value.story.session.messages[0].role = 'unknown' as 'user'; });
  invalid(value => { value.story.session.messages[1].id = value.story.session.messages[0].id; });
  invalid(value => { value.characters = []; });
  invalid(value => { value.assets.worldbooks = []; });
  invalid(value => { value.story.sourcePath = '/Users/private/chat.jsonl'; });
  for (const path of ['../story.json', '/memory/main/state.md', 'memory/main/../../story.json', 'memory\\main\\x.md',
    'memory/main/CON.txt', 'memory/main/file.md.', '.ste-control/roleplay/main/run.js', 'memory/main/%2e%2e/x.md']) {
    invalid(value => { value.files[0].path = path; });
  }
  invalid(value => { value.files.push({ path: 'memory/main/STATE.md', text: 'other' }); });
  invalid(value => { value.files.push({ path: 'memory/main/state.md/child.txt', text: 'other' }); });
  invalid(value => { value.files[0].text = '界'.repeat(Math.floor(STORY_PACKAGE_LIMITS.fileBytes / 3) + 1); });
  expect(() => parseStoryPackage('{"format":"ste-play","__proto__":{"polluted":true}}')).toThrow();
});

it('guards the vault publication seam against outside staging paths, identity mismatches and symlinks', async () => {
  const { story, character } = await seed(); const fs = desktopLibrary(); const vault = getActiveVault()!;
  await vault.repo<ArchiveCharacter>('characters').put(character);
  const stage = '.ste-control/story-packages/' + digest('test') + '/story'; await fs.writeText(stage + '/故事.json', JSON.stringify(story));
  for (const path of ['outside/story', '.ste-control/story-packages/../story', '/.ste-control/story-packages/x/story']) {
    await expect(vault.publishStoryDirectory!(story.id, path)).rejects.toThrow();
  }
  await expect(vault.publishStoryDirectory!('wrong-id', stage)).rejects.toThrow(/身份|匹配|ID/);
  const list = fs.list.bind(fs);
  fs.list = async path => (await list(path)).map(entry => path === '.ste-control' && entry.name === 'story-packages' ? { ...entry, isSymlink: true } : entry);
  await expect(vault.publishStoryDirectory!(story.id, stage)).rejects.toThrow(/链接|路径/);
  fs.list = list;
  await vault.publishStoryDirectory!(story.id, stage);
  expect(await vault.repo<ArchiveStory>('archiveStories').get(story.id)).toEqual(story);
  await fs.writeText(stage + '/故事.json', JSON.stringify(story));
  await expect(vault.publishStoryDirectory!(story.id, stage)).rejects.toThrow(/存在/);
});
