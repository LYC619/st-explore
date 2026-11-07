import { readCharacterInQueue, withArchiveStoryLock } from '@/lib/archive-db';
import { serializeChatJsonl } from '@/lib/adapters/st/chat-jsonl';
import { openDB, type StoreName } from '@/lib/idb';
import { KeyedSerialQueue } from '@/lib/keyed-serial-queue';
import { getCurrentRepo, type Repo } from '@/lib/repo';
import { crc32, embedCharaInPng } from '@/lib/png-writer';
import { base64ToBytes, bytesToBase64 } from '@/lib/utils';
import { getActiveVault, getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { ensureUnique, safeName } from '@/lib/vault/naming';
import type { ArchiveCharacter, ArchiveStory, AssetRef } from '@/types/archive';
import type { ChatSession, RegexRule } from '@/types/chat';
import type { PresetItem } from '@/types/preset';
import type { RegexCollectionItem } from '@/types/regex';
import type { WorldBookItem } from '@/types/worldbook';
import { digest, stableJson } from './fingerprint';
import { isRuntimePath, runtimeFileId } from './paths';
import { createRuntimeStore, type RuntimeFile } from './runtime-store';

export const STORY_PACKAGE_LIMITS = Object.freeze({ bytes: 64 * 1024 * 1024, fileBytes: 4 * 1024 * 1024,
  runtimeBytes: 32 * 1024 * 1024, files: 2048, records: 256, messages: 100_000, depth: 64, nodes: 1_000_000 });
export interface StoryPackageOmission {
  field: string;
  reason: 'credential' | 'machine-path' | 'executable' | 'external-file';
  /** A source filename is useful provenance; the machine-specific directory is never included. */
  name?: string;
}
export interface StoryPackage {
  format: 'ste-play';
  version: 1;
  story: ArchiveStory;
  characters: ArchiveCharacter[];
  assets: { worldbooks: WorldBookItem[]; presets: PresetItem[]; regexes: RegexCollectionItem[] };
  files: { path: string; text: string }[];
  omissions: StoryPackageOmission[];
}
type Kind = 'story' | 'character' | 'worldbook' | 'preset' | 'regex';
type RecordValue = ArchiveStory | ArchiveCharacter | WorldBookItem | PresetItem | RegexCollectionItem;
type Action = 'create' | 'identical' | 'conflict';
export interface StoryPackagePreview {
  packageId: string;
  story: { id: string; title: string };
  records: { kind: Kind; id: string; title: string; action: Action }[];
  files: { path: string; action: Action }[];
  omissions: StoryPackageOmission[];
  conflicts: string[];
  canApply: boolean;
}
export interface StoryPackageExport { package: StoryPackage; text: string; fileName: string }
export interface StoryPackageImportResult { storyId: string; status: 'imported' | 'identical' }
export interface StoryPackageAdapterOptions { isCurrent?: () => boolean }

const imports = new KeyedSerialQueue();
const stores: Record<Kind, StoreName> = { story: 'archiveStories', character: 'characters', worldbook: 'worldbooks', preset: 'presets', regex: 'regexes' };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
// eslint-disable-next-line no-control-regex -- JSON identifiers and filenames must not contain control characters.
const controlCharacters = /[\x00-\x1f]/;
const id = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 1024 && !controlCharacters.test(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const stamp = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const keyOf = (kind: Kind, value: string) => stableJson([kind, value]);
const versionOf = (value: unknown) => value === undefined ? null : digest(stableJson(value));
function byteLength(text: string, maximum: number, description: string): number {
  assert(text.length <= maximum, `${description}超过大小限制`);
  const size = new TextEncoder().encode(text).length;
  assert(size <= maximum, `${description}超过大小限制`); return size;
}

/** Validate the JSON tree before inspecting permissive ST extension fields. */
function jsonTree(value: unknown, depth = 0, count = { value: 0 }): void {
  assert(depth <= STORY_PACKAGE_LIMITS.depth && ++count.value <= STORY_PACKAGE_LIMITS.nodes, '故事包结构过深或条目过多');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { assert(Number.isFinite(value), '故事包含无效数值'); return; }
  assert(Array.isArray(value) || object(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), '故事包必须为普通 JSON 数据');
  for (const [key, child] of Object.entries(value)) {
    assert(!['__proto__', 'prototype', 'constructor'].includes(key), '故事包含不安全的字段');
    jsonTree(child, depth + 1, count);
  }
}
function envelope(value: Record<string, unknown>, keys: string[]) {
  assert(Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key)), '故事包结构无效或包含不支持的资源');
}
function base(value: unknown): asserts value is Record<string, unknown> & { id: string } {
  assert(object(value) && id(value.id) && stamp(value.createdAt) && stamp(value.updatedAt), '故事包记录身份或时间无效');
}
function refs(value: unknown): asserts value is AssetRef[] | undefined {
  assert(value === undefined || Array.isArray(value) && value.every(ref => object(ref)
    && ['worldbook', 'preset', 'regex'].includes(String(ref.kind)) && id(ref.assetId)
    && (ref.relations === undefined || strings(ref.relations) && ref.relations.every(relation => ['embedded', 'primary', 'extra', 'chat'].includes(relation)))), '故事包资产引用无效');
}
function session(value: unknown): asserts value is ChatSession {
  assert(object(value) && id(value.id) && typeof value.title === 'string' && stamp(value.createdAt)
    && object(value.user) && typeof value.user.name === 'string' && object(value.character) && typeof value.character.name === 'string'
    && Array.isArray(value.messages) && value.messages.length <= STORY_PACKAGE_LIMITS.messages, '故事包会话格式无效');
  const seen = new Set<string>();
  for (const message of value.messages) {
    assert(object(message) && id(message.id) && !seen.has(message.id) && ['user', 'assistant', 'system'].includes(String(message.role))
      && typeof message.content === 'string' && (message.rawData === undefined || object(message.rawData)), '故事包消息格式无效或身份重复');
    seen.add(message.id);
  }
}
function markers(value: unknown) {
  assert(Array.isArray(value) && value.every(marker => object(marker) && id(marker.messageId) && typeof marker.title === 'string'
    && Number.isSafeInteger(marker.messageIndex) && Number(marker.messageIndex) >= 0 && stamp(marker.createdAt)), '故事包章节格式无效');
}
function rules(value: unknown): asserts value is RegexRule[] {
  assert(Array.isArray(value), '故事包正则格式无效'); const seen = new Set<string>();
  for (const rule of value) {
    assert(object(rule) && id(rule.id) && !seen.has(rule.id) && typeof rule.name === 'string' && typeof rule.findRegex === 'string'
      && typeof rule.replaceString === 'string' && typeof rule.disabled === 'boolean' && strings(rule.placement)
      && rule.placement.every(position => ['all', 'user', 'assistant'].includes(position)), '故事包正则规则无效或身份重复');
    seen.add(rule.id);
  }
}
function validateRecord(kind: Kind, value: unknown) {
  base(value);
  assert(typeof value[kind === 'character' ? 'name' : 'title'] === 'string', '故事包记录名称无效');
  if (kind === 'story') {
    session(value.session); markers(value.markers); refs(value.assets);
    assert(value.characterId === undefined || id(value.characterId), '故事包角色引用无效');
    assert(object(value.meta) && strings(value.meta.modelsUsed) && (value.meta.playTimeMs === null || stamp(value.meta.playTimeMs)), '故事包元数据无效');
    assert(value.branches === undefined || Array.isArray(value.branches), '故事包分支格式无效');
    const seen = new Set<string>();
    for (const branch of value.branches as unknown[] ?? []) {
      base(branch); assert(!seen.has(branch.id) && typeof branch.name === 'string', '故事包分支身份重复或名称无效');
      seen.add(branch.id); session(branch.session); markers(branch.markers);
    }
  } else if (kind === 'character') {
    refs(value.assets);
    assert(object(value.card) && (value.card.data === undefined || object(value.card.data)) && strings(value.tags)
      && ['未开始', '进行中', '暂停', '已完成', '已弃置'].includes(String(value.status)), '故事包角色卡格式无效');
    assert(value.pngBase64 === undefined || typeof value.pngBase64 === 'string', '故事包卡面格式无效');
  } else if (kind === 'worldbook') {
    assert(object(value.worldbook) && object(value.worldbook.entries), '故事包世界书格式无效');
    for (const entry of Object.values(value.worldbook.entries)) {
      assert(object(entry) && Number.isSafeInteger(entry.uid) && typeof entry.content === 'string' && strings(entry.key), '故事包世界书条目格式无效');
    }
  } else if (kind === 'preset') {
    const preset = value.preset;
    assert(object(preset) && Array.isArray(preset.prompts) && Array.isArray(preset.promptOrder)
      && object(preset.originalData) && typeof preset.hasRegexExtension === 'boolean', '故事包预设格式无效');
    assert(preset.prompts.every(prompt => object(prompt) && id(prompt.identifier) && typeof prompt.name === 'string'
      && (prompt.content === undefined || typeof prompt.content === 'string') && (prompt.role === undefined || ['system', 'user', 'assistant'].includes(String(prompt.role)))), '故事包提示词格式无效');
    assert(preset.promptOrder.every(group => object(group) && Number.isSafeInteger(group.character_id) && Array.isArray(group.order)
      && group.order.every(entry => object(entry) && id(entry.identifier) && typeof entry.enabled === 'boolean')), '故事包提示词顺序无效');
    rules(preset.regexRules);
  } else rules(value.rules);
}

const normalizedKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const credential = (key: string) => /apikey|password|passwd|clientsecret|secretkey|accesstoken|refreshtoken|authtoken|bearertoken|authorization|credentials/.test(normalizedKey(key))
  || ['cookie', 'setcookie', 'secrets', 'apiprofiles', 'apiconfig', 'connectionprofiles', 'authentication'].includes(normalizedKey(key));
const executable = /\.(?:[cm]?js|jsx|tsx?|html?|wasm|exe|dll|sh|bat|cmd|ps1|py|zip|tar|gz)$/i;
const metadataPath = (key: string) => /path|directory|folder|root|filename|source|origin|avatar|uri|url|endpoint|backupfile/i.test(key);
const machinePath = (value: string) => /^(?:[a-z]:[\\/]|[\\/]{2}|file:|\/(?!\/)|~[\\/])/i.test(value);
function filename(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let path = value;
  if (/^[a-z]+:\/\//i.test(value)) { try { path = new URL(value).pathname; } catch { return undefined; } }
  return [...path.split(/[\\/]/).at(-1) ?? ''].filter(character => !controlCharacters.test(character)
    && !/[:*?"<>|]/.test(character)).join('').slice(0, 255);
}

/** Only metadata/configuration fields are scrubbed. Story prose and journal before/after strings are never rewritten. */
function portable(value: unknown, field: string, omissions: StoryPackageOmission[], key = ''): unknown {
  if (typeof value === 'string' && metadataPath(key)) {
    if (machinePath(value)) { omissions.push({ field, reason: 'machine-path', name: filename(value) }); return undefined; }
    if (/^(?:javascript:|data:(?:text\/html|(?:text|application)\/javascript))/i.test(value)) { omissions.push({ field, reason: 'executable' }); return undefined; }
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value); let changed = !!url.username || !!url.password; url.username = ''; url.password = '';
      for (const name of [...url.searchParams.keys()]) if (credential(name) || ['token', 'key'].includes(normalizedKey(name))) { url.searchParams.delete(name); changed = true; }
      if (changed) { omissions.push({ field, reason: 'credential' }); return url.href; }
    }
  }
  if (Array.isArray(value)) return value.map((child, index) => portable(child, `${field}[${index}]`, omissions, key)).filter(child => child !== undefined);
  if (!object(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [name, child] of Object.entries(value)) {
    const location = `${field}.${name}`, normalized = normalizedKey(name);
    let reason: StoryPackageOmission['reason'] | undefined;
    if (credential(name) || normalized === 'token' && typeof child === 'string') reason = 'credential';
    else if (['installedbaibai', 'pluginpackage', 'pluginpackages', 'executableplugins'].includes(normalized)
      || object(child) && object(child.files) && Object.keys(child.files).some(path => executable.test(path))) reason = 'executable';
    else if (['sourcepath', 'stglobalsources', 'backupfile'].includes(normalized)) reason = 'machine-path';
    else if (/^characters\[\d+\]\.(?:attachments|portraitRows)$/.test(location)) reason = 'external-file';
    if (reason) { omissions.push({ field: location, reason, ...(reason === 'machine-path' ? { name: filename(child) } : {}) }); continue; }
    const next = portable(child, location, omissions, name);
    if (next !== undefined) output[name] = next;
  }
  return output;
}

/** Keep PNG pixels but remove all opaque metadata before embedding the portable card JSON. */
function portablePng(base64: string, card: unknown): string {
  assert(base64.length <= STORY_PACKAGE_LIMITS.bytes / 2 && base64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(base64), '故事包 PNG 编码无效或过大');
  const bytes = base64ToBytes(base64), view = new DataView(bytes.buffer);
  assert(bytes.length >= 45 && [137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n), '故事包 PNG 格式无效');
  const pieces = [bytes.slice(0, 8)]; let offset = 8, ended = false, data = false;
  const keep = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'acTL', 'fcTL', 'fdAT']);
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset), end = offset + 12 + length;
    assert(end <= bytes.length, '故事包 PNG 数据截断');
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    assert(crc32(bytes.subarray(offset + 4, end - 4)) === view.getUint32(end - 4), '故事包 PNG 校验失败');
    assert(offset !== 8 || type === 'IHDR' && length === 13, '故事包 PNG 缺少图像头');
    if (keep.has(type)) pieces.push(bytes.slice(offset, end));
    if (type === 'IDAT') data = true;
    offset = end;
    if (type === 'IEND') { assert(length === 0 && offset === bytes.length, '故事包 PNG 尾部无效'); ended = true; break; }
  }
  assert(data && ended, '故事包 PNG 缺少完整图像');
  const clean = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0)); let position = 0;
  for (const piece of pieces) { clean.set(piece, position); position += piece.length; }
  return bytesToBase64(embedCharaInPng(clean.buffer, JSON.parse(stableJson(card))));
}

const executableRuntime = (path: string) => executable.test(path) || /^\.ste-control\/roleplay\/[^/]+\/(?:helpers|frontend)\.json$/i.test(path);
const dataPath = (path: string) => isRuntimePath(path) && !executableRuntime(path) && /\.(?:md|txt|json|jsonl|ya?ml|toml|csv|tsv|log|ini)$/i.test(path)
  && path.split('/').every(part => part.length <= 255 && !/^(?:node_modules|plugins|extensions|\.git)$/i.test(part)
    && !/^(?:%2e){1,2}$/i.test(part));
function validateFile(file: unknown): asserts file is StoryPackage['files'][number] {
  assert(object(file), '故事包运行文件格式无效'); envelope(file, ['path', 'text']);
  assert(typeof file.path === 'string' && dataPath(file.path) && typeof file.text === 'string' && !file.text.includes('\0'), '故事包运行文件路径或文本无效');
  byteLength(file.text, STORY_PACKAGE_LIMITS.fileBytes, '运行文件');
  // Structured runtime data may contain credentials. Reject it, rather than altering
  // a prepared journal and invalidating its exact before/after recovery contract.
  if (/\.jsonl?$/i.test(file.path)) {
    for (const text of /\.jsonl$/i.test(file.path) ? file.text.split(/\r?\n/).filter(line => line.trim()) : [file.text]) {
      let value: unknown; try { value = JSON.parse(text); } catch { throw new Error(`运行文件 JSON 无效：${file.path}`); }
      jsonTree(value); const removed: StoryPackageOmission[] = []; portable(value, file.path, removed);
      assert(!removed.length, `运行文件包含凭据、本机路径或可执行包，不能安全携带：${file.path}`);
    }
  } else {
    // Cover frontmatter/INI/TOML-style assignments without modifying narrative text.
    for (const match of file.text.matchAll(/^\s*["']?([a-zA-Z_][\w .-]*)["']?\s*[:=]\s*(.+)$/gm)) {
      const [, key, value] = match;
      assert(!credential(key) && !(metadataPath(key) && machinePath(value.replace(/^["']/, ''))), `运行文件含凭据或本机路径，不能安全携带：${file.path}`);
    }
  }
}
function recordEntries(value: StoryPackage): { kind: Kind; value: RecordValue }[] {
  return [{ kind: 'story', value: value.story }, ...value.characters.map(value => ({ kind: 'character' as const, value })),
    ...value.assets.worldbooks.map(value => ({ kind: 'worldbook' as const, value })), ...value.assets.presets.map(value => ({ kind: 'preset' as const, value })),
    ...value.assets.regexes.map(value => ({ kind: 'regex' as const, value }))];
}
function referencedAssets(value: Pick<StoryPackage, 'story' | 'characters' | 'files'>): AssetRef[] {
  const result = [...value.story.assets ?? [], ...value.characters.flatMap(character => character.assets ?? [])];
  for (const file of value.files) if (/^\.ste-control\/roleplay\/[^/]+\/worldbook-versions\/.+\.json$/.test(file.path)) {
    const version: unknown = JSON.parse(file.text);
    if (object(version) && id(version.worldId)) result.push({ kind: 'worldbook', assetId: version.worldId });
  }
  return result;
}
function validatePackage(value: unknown): asserts value is StoryPackage {
  jsonTree(value); assert(object(value), '故事包格式无效');
  envelope(value, ['format', 'version', 'story', 'characters', 'assets', 'files', 'omissions']);
  assert(value.format === 'ste-play' && value.version === 1 && Array.isArray(value.characters) && object(value.assets)
    && Array.isArray(value.files) && value.files.length <= STORY_PACKAGE_LIMITS.files && Array.isArray(value.omissions), '故事包版本或格式无效');
  envelope(value.assets, ['worldbooks', 'presets', 'regexes']);
  const assets = value.assets;
  assert(['worldbooks', 'presets', 'regexes'].every(key => Array.isArray(assets[key])), '故事包资产格式无效');
  const pack = value as unknown as StoryPackage, entries = recordEntries(pack), identities = new Set<string>();
  assert(entries.length <= STORY_PACKAGE_LIMITS.records, '故事包资产数量过多');
  for (const entry of entries) {
    validateRecord(entry.kind, entry.value); const key = keyOf(entry.kind, entry.value.id);
    assert(!identities.has(key), '故事包记录身份重复'); identities.add(key);
    const omitted: StoryPackageOmission[] = []; portable(entry.value, entry.kind, omitted);
    assert(!omitted.length, '故事包包含凭据、本机路径或可执行插件包');
    if (entry.kind === 'character' && (entry.value as ArchiveCharacter).pngBase64) {
      const character = entry.value as ArchiveCharacter;
      assert(portablePng(character.pngBase64!, character.card) === character.pngBase64, '故事包 PNG 元数据未清理或角色卡不匹配');
    }
  }
  assert(pack.characters.length === (pack.story.characterId ? 1 : 0)
    && (!pack.story.characterId || identities.has(keyOf('character', pack.story.characterId))), '故事包缺少所需角色或含无关角色');
  const paths = new Set<string>(); let runtimeBytes = 0;
  for (const file of pack.files) {
    validateFile(file); const path = file.path.normalize('NFC').toLowerCase();
    assert(!paths.has(path), '故事包文件路径重复'); paths.add(path);
    runtimeBytes += byteLength(file.text, STORY_PACKAGE_LIMITS.fileBytes, '运行文件');
  }
  assert(runtimeBytes <= STORY_PACKAGE_LIMITS.runtimeBytes, '故事包运行文件总大小超限');
  for (const path of paths) { let parent = path; while (parent.includes('/')) { parent = parent.slice(0, parent.lastIndexOf('/')); assert(!paths.has(parent), '故事包文件与目录路径冲突'); } }
  const required = new Set(referencedAssets(pack).map(ref => keyOf(ref.kind, ref.assetId)));
  for (const key of required) assert(identities.has(key), '故事包缺少引用的资产');
  assert(entries.filter(entry => !['story', 'character'].includes(entry.kind)).every(entry => required.has(keyOf(entry.kind, entry.value.id))), '故事包含未引用的资产');
  for (const item of pack.omissions) assert(object(item) && Object.keys(item).every(key => ['field', 'reason', 'name'].includes(key))
    && typeof item.field === 'string' && item.field.length <= 4096 && !controlCharacters.test(item.field)
    && ['credential', 'machine-path', 'executable', 'external-file'].includes(item.reason)
    && (item.name === undefined || typeof item.name === 'string' && !/[\\/]/.test(item.name) && !controlCharacters.test(item.name)), '故事包来源说明格式无效');
}

export function parseStoryPackage(text: string): StoryPackage {
  assert(typeof text === 'string', '故事包必须为 JSON 文本'); byteLength(text, STORY_PACKAGE_LIMITS.bytes, '故事包');
  let value: unknown; try { value = JSON.parse(text); } catch { throw new Error('故事包 JSON 无效'); }
  validatePackage(value); return value;
}
export async function readStoryPackage(file: Blob): Promise<StoryPackage> {
  assert(file.size > 0 && file.size <= STORY_PACKAGE_LIMITS.bytes, '故事包文件过大或为空');
  return parseStoryPackage(await file.text());
}

interface TargetState { records: Map<string, RecordValue | undefined>; files: Map<string, string> }
interface PreviewState { value: StoryPackage; target: TargetState; conflicted: boolean }

/**
 * Portable data only. No global connection profiles or installed plugin store is read.
 * Each factory is bound to its concrete repos and vault epoch. Preview is read-only;
 * apply rechecks conflicts and refuses replacements, including changed runtime files.
 */
export function createStoryPackageAdapter(options: StoryPackageAdapterOptions = {}) {
  const vault = getActiveVault(), epoch = getVaultEpoch();
  const repos: Record<Kind, Repo<RecordValue>> = {
    story: getCurrentRepo('archiveStories'), character: getCurrentRepo('characters'), worldbook: getCurrentRepo('worldbooks'),
    preset: getCurrentRepo('presets'), regex: getCurrentRepo('regexes'),
  };
  const previews = new WeakMap<StoryPackagePreview, PreviewState>();
  const current = () => getVaultEpoch() === epoch && options.isCurrent?.() !== false;
  const check = () => assert(current(), '文件库或故事已切换，故事包操作已停止');
  const readRecord = (kind: Kind, id: string) => vault?.peekRecord ? vault.peekRecord<RecordValue>(stores[kind], id) : repos[kind].get(id);
  const runtime = (storyId: string) => { check(); const store = createRuntimeStore(storyId); return store.underStoryLock ?? store; };
  const withCharacter = <T>(characterId: string | undefined, action: () => Promise<T>) => {
    check();
    return characterId ? readCharacterInQueue(characterId, async () => { check(); return action(); }, { isCurrent: current }) : action();
  };

  async function target(value: StoryPackage): Promise<TargetState> {
    check(); const records = new Map<string, RecordValue | undefined>();
    await Promise.all(recordEntries(value).map(async ({ kind, value }) => records.set(keyOf(kind, value.id), await readRecord(kind, value.id))));
    const files = new Map<string, string>(), store = runtime(value.story.id);
    for (const path of await store.list()) { check(); const text = await store.read(path); assert(text !== null, '预览时运行文件发生变化'); files.set(path, text); }
    check(); return { records, files };
  }
  function assess(value: StoryPackage, state: TargetState, baseline?: TargetState): StoryPackagePreview {
    const conflicts: string[] = [], storyExists = !!state.records.get(keyOf('story', value.story.id));
    const records = recordEntries(value).map(({ kind, value }) => {
      const key = keyOf(kind, value.id), actual = state.records.get(key), prior = baseline?.records.get(key);
      const action: Action = actual === undefined ? prior === undefined ? 'create' : 'conflict'
        : versionOf(actual) === versionOf(value) ? 'identical' : 'conflict';
      if (action === 'conflict') conflicts.push(`${kind}：${value.id} 已有不同内容或在预览后变化`);
      return { kind, id: value.id, title: 'name' in value ? value.name : value.title, action };
    });
    const paths = new Set(value.files.map(file => file.path));
    const files = value.files.map(file => {
      const actual = state.files.get(file.path);
      const action: Action = actual === file.text ? 'identical' : actual === undefined && !storyExists && !baseline?.files.has(file.path) ? 'create' : 'conflict';
      if (action === 'conflict') conflicts.push(`运行文件：${file.path} 已有不同内容或缺失`);
      return { path: file.path, action };
    });
    for (const path of state.files.keys()) if (!paths.has(path)) {
      files.push({ path, action: 'conflict' }); conflicts.push(`运行文件：${path} 不在故事包中`);
    }
    return { packageId: digest(stableJson(value)), story: { id: value.story.id, title: value.story.title }, records, files,
      omissions: structuredClone(value.omissions), conflicts, canApply: !conflicts.length };
  }
  function allowed(value: StoryPackage, state: TargetState, baseline: TargetState) {
    const plan = assess(value, state, baseline); assert(plan.canApply, `故事包导入冲突：${plan.conflicts.join('；')}`); return plan;
  }

  async function applyBrowser(value: StoryPackage, baseline: TargetState): Promise<StoryPackageImportResult> {
    const db = await openDB(); check(); const entries = recordEntries(value);
    return new Promise((resolve, reject) => {
      const tx = db.transaction([...Object.values(stores), 'roleplayFiles'], 'readwrite');
      let failure: unknown, result: StoryPackageImportResult;
      const unsubscribe = subscribeActiveVault(() => { if (!current()) { failure = new Error('文件库已切换，故事包导入已取消'); try { tx.abort(); } catch { /* Already settled. */ } } });
      const failed = () => { unsubscribe(); reject(failure ?? tx.error ?? new Error('故事包导入事务已取消')); };
      tx.onabort = failed; tx.onerror = () => { failure ??= tx.error; };
      tx.oncomplete = () => { unsubscribe(); resolve(result); };
      const state: TargetState = { records: new Map(), files: new Map() }; let remaining = entries.length + 1;
      const ready = () => {
        if (--remaining) return;
        try {
          check(); const plan = allowed(value, state, baseline);
          for (const entry of entries) if (!state.records.get(keyOf(entry.kind, entry.value.id))) tx.objectStore(stores[entry.kind]).add(entry.value);
          for (const file of value.files) if (!state.files.has(file.path)) tx.objectStore('roleplayFiles').add({ id: runtimeFileId(value.story.id, file.path),
            storyId: value.story.id, path: file.path, text: file.text, updatedAt: value.story.updatedAt } satisfies RuntimeFile);
          result = { storyId: value.story.id, status: [...plan.records, ...plan.files].some(item => item.action === 'create') ? 'imported' : 'identical' };
        } catch (error) { failure = error; tx.abort(); }
      };
      try {
        for (const entry of entries) {
          const request = tx.objectStore(stores[entry.kind]).get(entry.value.id);
          request.onsuccess = () => { state.records.set(keyOf(entry.kind, entry.value.id), request.result); ready(); };
        }
        const files = tx.objectStore('roleplayFiles');
        const request = files.indexNames.contains('storyId') ? files.index('storyId').getAll(value.story.id) : files.getAll();
        request.onsuccess = () => {
          try {
            for (const file of request.result as RuntimeFile[]) if (file.storyId === value.story.id) {
              assert(isRuntimePath(file.path) && typeof file.text === 'string' && file.id === runtimeFileId(file.storyId, file.path), '已有运行文件身份无效，导入已停止');
              state.files.set(file.path, file.text);
            }
            ready();
          } catch (error) { failure = error; tx.abort(); }
        };
      } catch (error) { failure = error; tx.abort(); }
    });
  }

  async function stage(value: StoryPackage): Promise<string> {
    const fs = vault!.fs, directory = `.ste-control/story-packages/${digest(stableJson(value))}/story`;
    const expected = new Map(value.files.map(file => [file.path, file.text]));
    // Missing legacy timestamps must not turn identical staging retries into new bytes.
    const derived = (session: ChatSession) => serializeChatJsonl({ ...session, messages: session.messages.map(message =>
      message.rawData || message.timestamp !== undefined ? message : { ...message, timestamp: session.createdAt }) });
    expected.set('聊天.jsonl', derived(value.story.session));
    const names: string[] = [];
    for (const branch of value.story.branches ?? []) {
      const name = ensureUnique('分支·' + safeName(branch.name, '未命名分支'), names); names.push(name);
      expected.set(name + '.jsonl', derived(branch.session));
    }
    // Truth is the final staging write; staging itself is outside all archive indexes.
    expected.set('故事.json', JSON.stringify(value.story, null, 2));
    async function safeParents(path: string) {
      let parent = '';
      for (const part of path.split('/').slice(0, -1)) {
        const entry = (await fs.list(parent)).find(item => item.name === part);
        assert(!entry?.isSymlink && (!entry || entry.isDir), '故事暂存路径包含链接或非目录');
        parent += (parent ? '/' : '') + part;
      }
    }
    async function inspect(relative = '', found = new Set<string>()) {
      for (const entry of await fs.list(directory + (relative ? '/' + relative : ''))) {
        assert(!entry.isSymlink && !/[\\/]/.test(entry.name) && !['.', '..'].includes(entry.name), '故事暂存目录含链接或不安全路径');
        const path = relative ? relative + '/' + entry.name : entry.name;
        assert([...expected.keys()].some(key => entry.isDir ? key.startsWith(path + '/') : key === path), '故事暂存目录包含未知文件');
        if (entry.isDir) await inspect(path, found);
        else { assert(await fs.readText(directory + '/' + path) === expected.get(path), '故事暂存文件已有不同内容，请保留原文件并检查'); found.add(path); }
      }
      return found;
    }
    await safeParents(directory + '/故事.json'); await inspect();
    for (const [path, text] of expected) {
      check(); const full = directory + '/' + path; await safeParents(full);
      if (!(await fs.stat(full)).exists) { check(); await fs.writeText(full, text); }
    }
    assert((await inspect()).size === expected.size, '故事暂存文件不完整'); check(); return directory;
  }

  return {
    async exportStory(storyId: string): Promise<StoryPackageExport> {
      check(); assert(id(storyId), '故事身份无效');
      return withArchiveStoryLock(storyId, async () => {
        check(); const story = await readRecord('story', storyId) as ArchiveStory | undefined; assert(story, '故事不存在');
        return withCharacter(story.characterId, async () => {
          const characters: ArchiveCharacter[] = [];
          if (story.characterId) { const card = await readRecord('character', story.characterId) as ArchiveCharacter | undefined; assert(card, '故事引用的角色不存在'); characters.push(card); }
          const omissions: StoryPackageOmission[] = [], files: StoryPackage['files'] = [], store = runtime(storyId);
          for (const path of await store.list()) {
            check();
            if (!dataPath(path)) { omissions.push({ field: path, reason: executableRuntime(path) ? 'executable' : 'external-file' }); continue; }
            const text = await store.read(path); assert(text !== null, '导出时运行文件发生变化'); validateFile({ path, text }); files.push({ path, text });
          }
          const assets: StoryPackage['assets'] = { worldbooks: [], presets: [], regexes: [] }, seen = new Set<string>();
          for (const ref of referencedAssets({ story, characters, files })) {
            const key = keyOf(ref.kind, ref.assetId); if (seen.has(key)) continue; seen.add(key);
            const record = await readRecord(ref.kind, ref.assetId); assert(record, `故事引用的资产不存在：${ref.kind}/${ref.assetId}`); check();
            if (ref.kind === 'worldbook') assets.worldbooks.push(record as WorldBookItem);
            else if (ref.kind === 'preset') assets.presets.push(record as PresetItem); else assets.regexes.push(record as RegexCollectionItem);
          }
          const value: StoryPackage = { format: 'ste-play', version: 1,
            story: portable(story, 'story', omissions) as ArchiveStory,
            characters: characters.map((character, index) => {
              const clean = portable(character, `characters[${index}]`, omissions) as ArchiveCharacter;
              if (clean.pngBase64) clean.pngBase64 = portablePng(clean.pngBase64, clean.card); return clean;
            }),
            assets: portable(assets, 'assets', omissions) as StoryPackage['assets'], files, omissions,
          };
          // Safe source names must survive import and the next export, without restoring
          // a machine-specific sourcePath that could enable accidental writeback.
          const rawStory = value.story as unknown as Record<string, unknown>;
          const prior = rawStory.__ste_play;
          assert(prior === undefined || object(prior), '故事包来源说明字段冲突');
          const history = object(prior) && Array.isArray(prior.omissions) ? prior.omissions : [];
          if (omissions.length || history.length) {
            value.omissions = [...new Map([...history, ...omissions].map(item => [stableJson(item), item])).values()];
            rawStory.__ste_play = { ...prior as Record<string, unknown>, omissions: value.omissions };
          }
          const text = JSON.stringify(value, null, 2); const verified = parseStoryPackage(text); check();
          return { package: verified, text, fileName: safeName(story.title, '故事') + '.ste-play' };
        });
      });
    },
    async previewImport(input: string | StoryPackage): Promise<StoryPackagePreview> {
      check(); if (typeof input !== 'string') validatePackage(input);
      const value = parseStoryPackage(typeof input === 'string' ? input : JSON.stringify(input));
      return withArchiveStoryLock(value.story.id, async () => {
        const state = await target(value), preview = assess(value, state);
        previews.set(preview, { value, target: state, conflicted: !preview.canApply }); return preview;
      });
    },
    async applyImport(preview: StoryPackagePreview): Promise<StoryPackageImportResult> {
      check(); const stored = previews.get(preview); assert(stored, '请使用当前故事包适配器生成的预览');
      assert(!stored.conflicted, '故事包预览存在冲突，不能应用');
      const value = parseStoryPackage(JSON.stringify(stored.value));
      return imports.enqueue(String(epoch), () => withArchiveStoryLock(value.story.id, () => withCharacter(value.story.characterId, async () => {
        check(); const plan = allowed(value, await target(value), stored.target);
        if (![...plan.records, ...plan.files].some(item => item.action === 'create')) return { storyId: value.story.id, status: 'identical' };
        if (!vault) return applyBrowser(value, stored.target);
        assert(vault.publishStoryDirectory && vault.publishPackageDependency, '当前文件库不支持故事包原子发布');
        const newStory = plan.records[0].action === 'create'; const staged = newStory ? await stage(value) : undefined;
        for (const entry of recordEntries(value).filter(entry => entry.kind !== 'story')) {
          const actual = await readRecord(entry.kind, entry.value.id); check();
          assert(actual === undefined || versionOf(actual) === versionOf(entry.value), '导入时资产已有不同内容');
          assert(actual !== undefined || stored.target.records.get(keyOf(entry.kind, entry.value.id)) === undefined, '预览后资产已删除');
          if (actual === undefined) {
            await vault.publishPackageDependency(stores[entry.kind] as 'characters' | 'worldbooks' | 'presets' | 'regexes', entry.value, plan.packageId, current); check();
          }
        }
        allowed(value, await target(value), stored.target); check();
        if (staged) await vault.publishStoryDirectory(value.story.id, staged, current);
        check(); return { storyId: value.story.id, status: 'imported' };
      })));
    },
  };
}

export type StoryPackageAdapter = ReturnType<typeof createStoryPackageAdapter>;
