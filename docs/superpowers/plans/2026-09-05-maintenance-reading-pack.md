# 阅读包导入安全与本机字段修复 Implementation Plan

**执行更新（2026-09-08）：** P1-P4 已完成，实际 Edge Worker 也已验证；设备峰值内存和原生平台体验仍未验收。
完整证据：[维护修复验证记录](../../reviews/2026-09-05-maintenance-fix-verification.md)。以下设计片段保留为原方案，最终实现以源码和验证报告为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 关闭 F02、F06、F12：阅读包覆盖不抹掉接收端角色字段和阅读进度，分支进度按 id 合并，ZIP 在解压过程中受预算约束，并且 worker 取消/关闭不会留下大 buffer 或过期响应。

**Architecture:** 继续使用 parse → inspect → apply 两阶段导入，但去掉 `reading-pack-source.ts` 的全局 `lastParsed` 缓存。同步解析核心保持纯函数供 node 测试；文件入口通过一次性 worker 执行有界解析，UI 只保留当前计划需要的 ParsedReadingPack，并以 request id/AbortSignal 丢弃过期结果。覆盖写入前、写入时都重新读取当前角色/故事，明确区分内容字段与本机字段。

**Tech Stack:** TypeScript、React、Vitest、fflate `Unzip`/`UnzipInflate`、Web Worker、Structured Clone、现有 VaultBackend/IndexedDB sink。

---

## 0. 字段所有权和安全预算

1. 包拥有角色/故事内容、评分、状态、正文、章节和新分支；接收端拥有角色附件、资产引用、未解析资产、sourcePath、故事 sourcePath/writebacks/assets/unresolvedAssets，以及匹配实体的本机阅读进度。
2. 覆盖不是把 stale local whole record spread 到 incoming：只从 fresh local snapshot 提取列明的本机字段。
3. 匹配分支的 `lastFloor` 本机值优先，包括本机值为 `undefined` 的情况；新分支可继承包值，但必须按新消息数 clamp。被删除的分支不复活，`lastViewedBranchId` 不指向不存在的分支。
4. 输入压缩字节上限 **300 MiB**；条目数最多 **4096**；单条展开上限 **64 MiB**；所有条目展开总量最多 **300 MiB**；单个 JSON 条目最多 **64 MiB**。限制在解压 callback 中计数，不能等 `unzipSync` 完成后才计算。
5. 任何 parse/inspect/worker 取消或错误都不得调用 sink 的 save；成功 apply 后立即释放 worker、解析引用和大 media map。

## Task P1：角色覆盖保留接收端本机字段（F02）

**Files:**
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/types/reading-pack.ts`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/reading-pack/import.ts`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/settings/ReadingPackImportDialog.tsx`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/data-source/types.ts`（ImportSink 定义）
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/data-source/reading-pack-source.ts`（inspect/apply 与 restore 调用）
- Inspect / 保持 re-export 一致: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/data-source/index.ts`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/reading-pack.test.ts`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/archive-db.test.ts`

- [x] **P1.1 — 扩展 sink 合约并先写覆盖 RED。**

`ImportSink` 增加精确方法：

~~~ts
export interface ImportSink {
  getCharacter(id: string): Promise<ArchiveCharacter | undefined>;
  saveCharacter(character: ArchiveCharacter): Promise<void>;
  saveStory(story: ArchiveStory): Promise<void>;
  saveSummary(summary: SummaryItem): Promise<void>;
  getStory(id: string): Promise<ArchiveStory | undefined>;
}
~~~

在 `src/lib/data-source/types.ts` 只新增 getCharacter，保留已有 saveCharacter/getStory/saveStory/saveSummary。`ReadingPackImportDialog.tsx` 从 archive-db import 真实 `getCharacter` 并加入传给 apply 的 sink；`reading-pack.test.ts` 新增 DataSource 集成 fixture，所有 mock sink 同步实现。fixture 创建两个同 id 角色：包角色没有 attachments/assets/unresolvedAssets/sourcePath，接收端有这些字段；apply overwrite 后断言包内容更新但四个字段逐字保留。再次 reopen 使用真实 `createVault(memfs)` 和新的 backend 实例检查物理记录；IDB 测试使用新连接读取，不能用同一内存对象或“重开”变量别名代替。

- [x] **P1.2 — 定义媒体恢复和本机字段提取的实际 helper。**

`src/lib/reading-pack/import.ts` 从 `src/types/reading-pack.ts` 补 import `PackPortraitRow`。保留包内 portraitRows 类型，不与 `Partial<ArchiveCharacter>` 的 portraitRows 做交叉类型。将当前媒体转换代码提取为文件内纯函数，缺图继续保留可显示的缺图条目；包里混入的 fileName/dataBase64 不传播：

~~~ts
type CharacterLocalFields = Pick<
  ArchiveCharacter, 'attachments' | 'assets' | 'unresolvedAssets' | 'sourcePath'
>;

function pickCharacterLocalFields(local: ArchiveCharacter): CharacterLocalFields {
  return {
    attachments: local.attachments,
    assets: local.assets,
    unresolvedAssets: local.unresolvedAssets,
    sourcePath: local.sourcePath,
  };
}

function restoreCharacterMedia(
  pack: ParsedReadingPack,
  cardMediaPath: string | undefined,
  packedRows: PackPortraitRow[] | undefined,
): Pick<ArchiveCharacter, 'pngBase64' | 'portraitRows'> {
  const cardBytes = cardMediaPath?.startsWith(`${PACK_MEDIA_DIR}/`)
    ? pack.media.get(cardMediaPath) : undefined;
  const portraitRows: PortraitRow[] | undefined = packedRows?.map(row => ({
    id: row.id,
    title: row.title,
    items: row.items.map(item => {
      const bytes = item.mediaPath?.startsWith(`${PACK_MEDIA_DIR}/`)
        ? pack.media.get(item.mediaPath) : undefined;
      return {
        id: item.id, source: item.source, name: item.name,
        dataBase64: bytes ? bytesToBase64(bytes) : undefined,
        mime: item.mime, addedAt: item.addedAt,
      };
    }),
  }));
  return { pngBase64: cardBytes ? bytesToBase64(cardBytes) : undefined, portraitRows };
}

export function restoreCharacter(
  pack: ParsedReadingPack,
  packChar: PackCharacter,
  local?: ArchiveCharacter,
): ArchiveCharacter {
  const {
    attachments: _attachments, assets: _assets,
    unresolvedAssets: _unresolvedAssets, sourcePath: _sourcePath,
    pngBase64: _pngBase64, cardMediaPath, portraitRows: packedRows,
    ...content
  } = packChar as PackCharacter & Partial<CharacterLocalFields>
    & { pngBase64?: string };
  return {
    ...content,
    ...restoreCharacterMedia(pack, cardMediaPath, packedRows),
    ...(local === undefined ? {} : pickCharacterLocalFields(local)),
  };
}
~~~

`local` 中即使值为 undefined 也要显式保留，不使用 truthiness fallback。测试从 JSON 强行注入 runtime 字段，确保新增和覆盖两条路径均剥离；不把完整 local spread 到结果。忽略字段若触发 lint，使用该项目支持的 unused 解构规则或明确删除的副本实现，不能关闭文件 lint。

- [x] **P1.3 — inspect/apply 使用 fresh snapshot 和覆盖重判定。**

inspect 阶段保留 input.existing 的 id/updatedAt；apply 每一项保存前再次 `sink.getCharacter(id)` 或 `sink.getStory(id)`。将 import.ts 中现有 `decide(incomingUpdatedAt: number, existing: number | undefined)` 改为 export，source 直接复用，不另写不一致的策略。对于 overwrite，若目标在 inspect 后消失，跳过该项并加入 warning，不凭 stale plan 重建已删除对象；若目标的 `updatedAt` 已变化，重新调用现有 `decide`，把 skip/add/overwrite 结果写入 apply report。overwrite 时调用 `restoreCharacter(parsed, packChar, current)`；本机字段由 P1.2 helper 提取。原计划为 add 而当前已存在时也必须重新 decide，不能覆盖并发新增对象。故事采取相同规则，原 `restoreStory(packStory, local?)` 签名保持不变。

apply 逻辑必须在每一项保存前完成 fresh read，只有得到目标状态后才调用 `saveCharacter`；parse 失败、用户取消、worker 过期和 fresh read 失败均不保存。导入对话用现有 ImportResult 的 written/skipped/warnings 展示重判定，不虚构不存在的 per-row report 字段。该读取发生于保存前，不声称提供跨进程 CAS；重判定测试必须涵盖 inspect 后目标删除、更新和原 add 目标新增。

- [x] **P1.4 — 运行角色字段门禁。**

~~~powershell
npm test -- src/test/reading-pack.test.ts src/test/archive-db.test.ts --reporter=dot
npx tsc -p tsconfig.app.json --noEmit
~~~

调用点必须同步：source 的角色恢复传第三参 current，故事恢复继续传第二参 local；现有 reading-pack.test.ts 的两参数角色恢复/单参数故事恢复仍覆盖新增路径，再补 local 覆盖和 source/sink 集成路径。Expected：角色内容可以被包更新，接收端 attachments/assets/unresolvedAssets/sourcePath 不消失；新 backend/新 IDB 连接可读回同样字段；删除目标不会被 stale plan 复活。

## Task P2：主线和分支阅读进度按身份合并（F06）

**Files:**
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/reading-pack/import.ts`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/reading-pack.test.ts`

- [x] **P2.1 — 先写分支 RED 和边界 fixture。**

构造 incoming/local 两份 `ArchiveStory`：incoming 包含 `br-keep`（消息 100 条）、`br-short`（消息 20 条）、`br-new`；local 的 `br-keep.lastFloor=80`、`br-short.lastFloor=80`、`br-new` 不存在、另有 `br-local-only`，顶层 `lastFloor=40`、`lastViewedAt=900`、`lastViewedBranchId='br-keep'`。断言恢复后：顶层值仍来自 local；keep=80；short clamp 到 20；new 保留包值但不超过消息数；local-only 不复活；`lastViewedBranchId` 指向删除分支时为 undefined。fixture 的 messages 数量必须真实达到断言的楼层，不用一个少于 80 条消息的短数组去测试 clamp。

再测本机分支 progress 为 undefined：匹配后结果仍为 undefined；incoming 长度为 0 时 progress 为 undefined；不匹配的新分支使用包值并 clamp 到 `[1, messageCount]`。

- [x] **P2.2 — 定义完整的 branch progress 合并函数。**

在 `import.ts` 使用 `ArchiveStory`/`StoryBranch` 的 `session.messages.length` 定义有效楼层：空分支为 undefined，非空为 `Math.max(1, Math.min(floor, count))`。实现：

~~~ts
function clampBranchFloor(floor: number | undefined, messageCount: number): number | undefined {
  if (typeof floor !== 'number' || !Number.isFinite(floor) || messageCount === 0) return undefined;
  return Math.max(1, Math.min(Math.trunc(floor), messageCount));
}

function mergeBranchProgress(incoming: StoryBranch, local: StoryBranch | undefined): StoryBranch {
  const sourceFloor = local === undefined ? incoming.lastFloor : local.lastFloor;
  return { ...incoming, lastFloor: clampBranchFloor(sourceFloor, incoming.session.messages.length) };
}
~~~

从 `src/types/archive.ts` import 实际 `StoryBranch`。`restoreStory(packStory: PackStory, local?: ArchiveStory): ArchiveStory` 先从包剥离可能注入的 sourcePath/writebacks/assets/unresolvedAssets，再还原包内容，并按 branch id map 仅合并 incoming 分支；local 只用于已有同 id 分支。顶层 `lastFloor`、`lastViewedAt`、`lastViewedBranchId` 在 local 存在时取 local；主线 lastFloor 也通过 clampBranchFloor 按新的 session.messages.length 限制；最后用还原后的 branch id 集合校验 `lastViewedBranchId`，失效就删除。local-only branches、local sourcePath/writebacks/assets/unresolvedAssets 不从包分支数组复原，原有故事本机字段继承逻辑仍保留。

- [x] **P2.3 — 运行进度门禁。**

~~~powershell
npm test -- src/test/reading-pack.test.ts --reporter=dot
~~~

Expected：相同分支进度不被包覆盖；缩短内容不产生越界页；删除分支不留下悬挂 selected branch；旧的无 local `restoreStory(packStory)` 调用继续工作。

## Task P3：有界流式解压、worker 和取消生命周期（F12）

**Files:**
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/types/reading-pack.ts`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/reading-pack/import.ts`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/data-source/reading-pack-source.ts`
- Create: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/reading-pack/reading-pack.worker.ts`
- Create: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/reading-pack/reading-pack-worker-client.ts`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/settings/ReadingPackImportDialog.tsx`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/reading-pack.test.ts`
- Create: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/reading-pack-worker.test.ts`

- [x] **P3.1 — 固定策略常量和带 code 的错误。**

在 `reading-pack.ts` 导出：

~~~ts
export const MAX_READING_PACK_BYTES = 300 * 1024 * 1024;
export const MAX_READING_PACK_ENTRIES = 4096;
export const MAX_READING_PACK_ENTRY_BYTES = 64 * 1024 * 1024;
export const MAX_READING_PACK_UNCOMPRESSED_BYTES = 300 * 1024 * 1024;
export const MAX_READING_PACK_JSON_BYTES = 64 * 1024 * 1024;
~~~

`ReadingPackError` 增加 `code: 'input-too-large' | 'entry-limit' | 'entry-too-large' | 'uncompressed-limit' | 'invalid-path' | 'duplicate-entry' | 'unsupported-compression' | 'truncated-zip' | 'invalid-format' | 'cancelled'`，message 同时给出预算名、累计值和上限。保留 300 MiB 压缩上限；原审查中 347KB → 301MiB 的压缩炸弹须在解压前或 callback 内拒绝：若为单条则先触发 64MiB entry limit；另用多条各低于 64MiB、合计超过 300MiB 的 fixture 验证总量限制，不能误要求单条走 total code。

~~~ts
export type ReadingPackErrorCode =
  | 'input-too-large' | 'entry-limit' | 'entry-too-large' | 'uncompressed-limit'
  | 'invalid-path' | 'duplicate-entry' | 'unsupported-compression'
  | 'truncated-zip' | 'invalid-format' | 'cancelled';

export class ReadingPackError extends Error {
  constructor(public readonly code: ReadingPackErrorCode, message: string) {
    super(message);
    this.name = 'ReadingPackError';
  }
}

const READING_PACK_ERROR_CODES: readonly ReadingPackErrorCode[] = [
  'input-too-large', 'entry-limit', 'entry-too-large', 'uncompressed-limit',
  'invalid-path', 'duplicate-entry', 'unsupported-compression', 'truncated-zip',
  'invalid-format', 'cancelled',
];

function isReadingPackError(value: unknown): value is ReadingPackError {
  if (value instanceof ReadingPackError) return true;
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { code?: unknown; message?: unknown };
  return typeof record.message === 'string'
    && typeof record.code === 'string'
    && READING_PACK_ERROR_CODES.includes(record.code as ReadingPackErrorCode);
}
~~~

- [x] **P3.2 — 先写 RED：不制造 300 MiB 测试样本。**

在 `reading-pack.test.ts` 保留现有合法包、压缩输入超限、manifest/format 错误，并新增：5000 个空 entries 触发 entry-limit；恶意/fixture 元数据声称超过 64MiB 的单条触发 entry-too-large；通过内部 `UnzipBudget` 注入 `{ ...DEFAULT_LIMITS, maxEntries: 3, maxEntryBytes: 1024 * 1024, maxUncompressedBytes: 2 * 1024 * 1024 }`，用 3×1MiB 小块触发 total limit，验证同一路径。另用合成小压缩数据触发 invalid path、duplicate、unsupported/truncated，并断言 `ParsedReadingPack` 不产生。

- [x] **P3.3 — 用 fflate Unzip 按 4KiB 输入块计数。**

将同步核心定义为 `unzipReadingPack(bytes: Uint8Array, limits: UnzipBudget = DEFAULT_LIMITS): Record<string, Uint8Array>`，注册 `UnzipInflate`，不要再调用 `unzipSync`。在 import.ts 定义以下 helper 和限制对象，测试只注入更小预算；生产不能由导入文件声明自己的预算：

~~~ts
export interface UnzipBudget {
  maxInputBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxUncompressedBytes: number;
}
export const DEFAULT_LIMITS: UnzipBudget = {
  maxInputBytes: MAX_READING_PACK_BYTES,
  maxEntries: MAX_READING_PACK_ENTRIES,
  maxEntryBytes: MAX_READING_PACK_ENTRY_BYTES,
  maxUncompressedBytes: MAX_READING_PACK_UNCOMPRESSED_BYTES,
};

function validatePackEntryName(name: string): string {
  const parts = name.split('/');
  if (name.length === 0 || /[\\:\u0000]/.test(name)
    || parts.some(part => !part || part === '.' || part === '..' || part.length > 255)) {
    throw new ReadingPackError('invalid-path', `不安全条目路径：${name}`);
  }
  if (name === PACK_MANIFEST_PATH) return name;
  if (parts.length !== 2 || ![
    PACK_CHARACTER_DIR, PACK_STORY_DIR, PACK_SUMMARY_DIR, PACK_MEDIA_DIR,
  ].includes(parts[0])) {
    throw new ReadingPackError('invalid-path', `未知条目路径：${name}`);
  }
  return name;
}

function concatChunks(chunks: Uint8Array[], byteLength: number): Uint8Array {
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function readZipEndRecord(bytes: Uint8Array): {
  entryCount: number;
  centralOffset: number;
  centralSize: number;
  eocdOffset: number;
} {
  const minimumLength = 22;
  const start = Math.max(0, bytes.length - minimumLength - 0xffff);
  for (let offset = bytes.length - minimumLength; offset >= start; offset--) {
    if (bytes[offset] !== 0x50 || bytes[offset + 1] !== 0x4b
      || bytes[offset + 2] !== 0x05 || bytes[offset + 3] !== 0x06) continue;
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, minimumLength);
    const diskNumber = view.getUint16(4, true);
    const centralDisk = view.getUint16(6, true);
    const entriesOnDisk = view.getUint16(8, true);
    const entryCount = view.getUint16(10, true);
    const centralSize = view.getUint32(12, true);
    const centralOffset = view.getUint32(16, true);
    const commentLength = view.getUint16(20, true);
    if (offset + minimumLength + commentLength !== bytes.length) continue;
    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount
      || centralOffset + centralSize !== offset
      || centralOffset + centralSize > bytes.length) continue;
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new ReadingPackError('invalid-format', '不支持 ZIP64 阅读包');
    }
    return { entryCount, centralOffset, centralSize, eocdOffset: offset };
  }
  throw new ReadingPackError('truncated-zip', 'ZIP 缺少完整的中央目录结束记录');
}

function validateZipCentralDirectory(
  bytes: Uint8Array,
  end: { entryCount: number; centralOffset: number; centralSize: number; eocdOffset: number },
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  let offset = end.centralOffset;
  const centralEnd = end.centralOffset + end.centralSize;
  for (let index = 0; index < end.entryCount; index++) {
    if (offset + 46 > centralEnd || view.getUint32(offset, true) !== 0x02014b50) {
      throw new ReadingPackError('truncated-zip', 'ZIP 中央目录条目不完整');
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > centralEnd) throw new ReadingPackError('truncated-zip', 'ZIP 中央目录长度不一致');
    offset = next;
  }
  if (offset !== end.eocdOffset) {
    throw new ReadingPackError('truncated-zip', 'ZIP 中央目录条目数或长度不一致');
  }
}
~~~

函数体先检查 bytes.length 不超过 limits.maxInputBytes，再调用 `readZipEndRecord(bytes)` 保存标准 ZIP 的中央目录条目数，随后按以下流程解压。使用 seenPaths 在接收 header 时去重、completedEntries 统计 final；结束时必须所有已开始条目都 final，且 `entryCount` 与 EOCD 条目数一致；异常统一转 ReadingPackError，畸形包不得产出半成品。当前格式限制在标准 ZIP EOCD 范围内，不为 ZIP64 伪造普通条目数，遇到不支持格式返回 `invalid-format` 或 `truncated-zip`。

~~~ts
const CHUNK_BYTES = 4 * 1024;
if (bytes.length > limits.maxInputBytes) {
  throw new ReadingPackError('input-too-large', `压缩输入 ${bytes.length} 超过 ${limits.maxInputBytes}`);
}
const zipEnd = readZipEndRecord(bytes);
validateZipCentralDirectory(bytes, zipEnd);
const entries = new Map<string, Uint8Array>();
const seenPaths = new Set<string>();
let completedEntries = 0;
let entryCount = 0;
let totalBytes = 0;
let callbackError: ReadingPackError | undefined;
let aborted = false;

const unzip = new Unzip((file) => {
  if (aborted) return;
  const path = validatePackEntryName(file.name);
  if (seenPaths.has(path)) { callbackError = new ReadingPackError('duplicate-entry', `重复条目 ${path}`); aborted = true; return; }
  seenPaths.add(path);
  entryCount++;
  if (entryCount > limits.maxEntries) { callbackError = new ReadingPackError('entry-limit', `条目数 ${entryCount} 超过 ${limits.maxEntries}`); aborted = true; return; }
  if (file.compression !== 0 && file.compression !== 8) {
    callbackError = new ReadingPackError('unsupported-compression', `条目 ${path} 使用不支持的 compression ${file.compression}`);
    aborted = true;
    return;
  }
  if (file.originalSize !== undefined && file.originalSize > limits.maxEntryBytes) {
    callbackError = new ReadingPackError('entry-too-large', `条目 ${path} 展开大小 ${file.originalSize} 超过 ${limits.maxEntryBytes}`); aborted = true; return;
  }
  const chunks: Uint8Array[] = [];
  let entryBytes = 0;
  file.ondata = (error, chunk, final) => {
    if (aborted) return;
    if (error) { callbackError = new ReadingPackError('truncated-zip', `条目 ${path} 解压失败：${error.message}`); aborted = true; return; }
    entryBytes += chunk.length;
    totalBytes += chunk.length;
    if (entryBytes > limits.maxEntryBytes) { callbackError = new ReadingPackError('entry-too-large', `条目 ${path} 已展开 ${entryBytes}，上限 ${limits.maxEntryBytes}`); aborted = true; return; }
    if (totalBytes > limits.maxUncompressedBytes) { callbackError = new ReadingPackError('uncompressed-limit', `累计展开 ${totalBytes}，上限 ${limits.maxUncompressedBytes}`); aborted = true; return; }
    chunks.push(chunk);
    if (final) {
      entries.set(path, concatChunks(chunks, entryBytes));
      chunks.length = 0;
      completedEntries++;
    }
  };
  try {
    file.start();
  } catch (error) {
    callbackError = new ReadingPackError(
      'invalid-format', `条目 ${path} 无法解压：${error instanceof Error ? error.message : String(error)}`,
    );
    aborted = true;
  }
});
unzip.register(UnzipInflate);
for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
  const end = Math.min(offset + CHUNK_BYTES, bytes.length);
  try {
    unzip.push(bytes.subarray(offset, end), end === bytes.length);
  } catch (error) {
    if (isReadingPackError(error)) {
      callbackError = error;
    } else if (!callbackError) {
      callbackError = new ReadingPackError(
        'invalid-format', `ZIP 解码失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    aborted = true;
  }
  if (aborted) break;
}
if (callbackError) throw callbackError;
if (aborted || completedEntries !== entryCount || zipEnd.entryCount !== entryCount) {
  throw new ReadingPackError('truncated-zip', 'ZIP 条目未完整解压或中央目录数量不一致');
}
return Object.fromEntries(entries);
~~~

实际实现同时拒绝空名、绝对路径、反斜杠、`..`、NUL、超过单段长度的路径和不在 `manifest.json`/`characters/`/`stories/`/`summaries/`/`media/` 下的条目；未知 compression 在 file.compression 不是 0/8 时于 start 前返回 unsupported-compression。加密位不在 UnzipFile API 中暴露，不能访问虚构 file.encrypted；此类输入若 parser/JSON 验证失败则归 invalid-format，不把未知解析错误误报成功。`concatChunks` 必须先按 `entryBytes` 分配一次并复制，不能把未受预算的 chunk 全部保留；callback 超限后不再 push，catch 后让 bytes/entries 脱离作用域。JSON 解析前检查条目长度不超过 `MAX_READING_PACK_JSON_BYTES`。这些是输入/展开预算，不是 JS 总堆内存上限；concat、JSON 和 base64 仍有有界倍数开销，必须在 Worker 中做设备峰值内存验收。

- [x] **P3.4 — 加入 worker client，不让 UI 主线程承受文件解析。**

`reading-pack.worker.ts` 只 import `parseReadingPackBytes`，接收 `{ type: 'parse', requestId, buffer }`，调用同步核心后回传 `{ type:'parsed', requestId, parsed }`；捕获 `ReadingPackError` 回传 `{ type:'error', requestId, code, message }`。`reading-pack-worker-client.ts` 导出 `parseReadingPackFile(file: File, signal?: AbortSignal): Promise<ParsedReadingPack>`：先检查 `file.size`，再 `arrayBuffer()`，用 `new Worker(new URL('./reading-pack.worker.ts', import.meta.url), { type: 'module' })`，只 transfer 本次 request 拥有的 buffer；Abort 时 `worker.terminate()`、reject code=cancelled、移除 listeners。signal 在 arrayBuffer 前/后均检查；Abort 不等待同步解析自己处理消息，直接 terminate。success/error/cancel 都移除 listener 并 terminate。不要在模块级保存 `lastParsed`、原始 bytes 或 worker。

`ReadingPackInput` 在 `reading-pack-source.ts` 将 `bytes: Uint8Array` 改为 `parsed: ParsedReadingPack`，其 origin/existing 字段保持；inspect/apply 直接用 input.parsed。删除 parseCached 和 lastParsed；parseReadingPackBytes 保留在 import.ts 供测试使用，不再由 source 隐式重解压。data-source/index.ts 保持该 input 的 re-export；测试先显式 parse 再构造同一 input 给 inspect/apply。

`ReadingPackImportDialog.tsx` 在 pick 时先清理前一请求、检查 File.size，再启动 request id；卸载、取消、重新选择时终止 worker，只有当前 request id 才能设置 input/plan/error/busy，包括 finally 里的 busy=false 和清理 input；旧请求的 finally 也不能影响新选择。parse error 清空 input 和 plan，不调用 apply；apply/close/error 后释放 parsed 引用并让 worker client 退出。保留 `parseReadingPackBytes` 供 node 纯函数测试，文件 UI 使用 worker client。

- [x] **P3.5 — 运行解压和生命周期门禁。**

~~~powershell
npm test -- src/test/reading-pack.test.ts src/test/reading-pack-worker.test.ts --reporter=dot
npx tsc -p tsconfig.app.json --noEmit
npm run lint -- --quiet
~~~

Expected：原 301MiB 展开压缩炸弹在实际解压过程中失败；失败/取消时 sink save 次数为 0；重新选择后旧 worker 响应不覆盖新 plan；关闭 dialog 后没有全局大 buffer。测试用内部小预算，不要求构造真实数百 MiB 样本。

## Task P4：阅读包交付检查

P4 是 P1—P3 的组合验收，不新增业务任务；分别为 F02/F06/F12 写入总计划 S2.4 的证据记录。

- [x] **P4.1:** `rg -n "restoreCharacter\(|restoreStory\(|ImportSink|lastParsed|unzipSync" src`，确认所有调用符合新签名；阅读包生产导入路径不存在 `unzipSync` 和模块级大缓存；其他备份功能的 unzipSync 不在本任务内顺手重写。
- [x] **P4.2:** 使用真实 `createVault(memfs)` apply → 关闭 → new backend reopen，确认物理附件、角色本机字段和故事进度不被覆盖；另跑 IDB 新连接测试。
- [x] **P4.3:** 运行 `npm test -- src/test/reading-pack.test.ts src/test/reading-pack-worker.test.ts src/test/archive-db.test.ts --reporter=dot`。无法使用浏览器 Worker 环境时，单独运行纯 worker message handler fixture，不能删掉取消和 stale request 断言。
