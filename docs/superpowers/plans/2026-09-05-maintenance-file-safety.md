# 文件数据安全修复 Implementation Plan

**执行更新（2026-09-08）：** D1-D5 代码和回归已完成；Windows symlink 特权用例报错 1314，真实壳验收未完成。部分早期 RED 命令日志及 S0 原始快照未在交接目录找到，相关历史步骤保持未勾选。
完整证据：[维护修复验证记录](../../reviews/2026-09-05-maintenance-fix-verification.md)。以下设计片段保留为原方案，最终实现以源码和验证报告为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 关闭 F01、F03、F13、F14、F15、F16：附件永远在当前角色作用域内解析，原生删除只接受普通文件，立绘替换/批量移动可恢复，元数据与物理文件的提交顺序不会毁掉唯一副本。

**Architecture:** 先在 Tauri 和前端 fs 边界提供带错误码的普通文件删除；附件记录只保存角色相对路径，兼容旧记录但不兼容旧角色目录回退。立绘操作使用角色写入队列内的 prepare → metadata persist → finalize 协议，并在角色目录的保留控制目录写 durable journal；重启、persist 失败和清理失败都按 journal 判定，不靠内存回调猜测状态。

**Tech Stack:** TypeScript、React、现有 VaultBackend/memfs/IndexedDB、Tauri Rust、`trash`、Vitest。

---

## 0. 数据安全不变量

1. 所有附件读、预览、外开、存在性检查和删除都由 `characterId + attachmentId` 重新读取当前角色后解析；UI 里的 `path` 只能展示，不能作为授权操作路径。
2. 文件名只能是当前角色目录下附件/立绘目录的一层普通文件名；绝对路径、`..`、内嵌分隔符、符号链接、Windows reparse point、目录都拒绝。
3. 任何角色档案 persist 成功前，旧立绘仍在旧位置或旧 `dataBase64` 中；新文件只使用本次 journal 记录的路径。
4. journal 自身只能写在 `.ste-control/portrait-journal/`；journal 中的媒体路径只能来自本角色受管的 `立绘/<行目录>/<文件名>`。控制文件与媒体文件分别校验，不能把“媒体必须在 .ste-control 内”作为规则；无法证明归属时阻塞清理。
5. 物理删除/回收站失败时不返回“删除成功”，也不先从档案删除记录；清理 journal 失败是已提交记录的可恢复 warning，不伪报 metadata 失败。

## Task D1：原生普通文件删除边界与错误码（F16、F14 基础）

**Files:**
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src-tauri/src/lib.rs`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/vault/tauri-fs.ts`
- Create: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/tauri-fs-mutation.test.ts`
- Preserve / regression: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/tauri-fs-stat.test.ts`
- Create: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/vault/fs-mutation-error.ts`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/vault/fs.ts`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src-tauri/src/lib.rs` Rust unit tests

- [ ] **D1.1 — 先写失败测试，不读真实用户库。**

真实 helper 是 `fn remove_file_impl(path: &Path) -> Result<(), String>`；command 是两个独立 wrapper，均为 `(roots: tauri::State<'_, AuthorizedRoots>, root: String, path: String) -> Result<(), String>`。保留 `vault_remove_file` / `vault_trash_file` 的名字、参数与注册，不把 helper 误标为 command。

Rust 测试用临时目录创建普通文件、空目录、非空目录和链接。原文件删除测试调用 `remove_file_impl(&path)`；共享校验测试用计数 closure 代替真实回收站，断言不安全目标从未进入 operation。另对授权根内的父目录链接、`../`、绝对路径和已不存在路径测试。Windows junction/reparse 测试置于 `#[cfg(windows)]`；平台/权限不支持时明确记录未验收，不能把未运行记为通过。前端 mock `invoke` 返回结构化、JSON string、畸形和旧 string 四种错误。

- [x] **D1.2 — 两个 wrapper 共用普通文件校验。**

在 `src-tauri/src/lib.rs` 增加下列 helper；现有路径解析在调用前仍负责逐层根约束，最终校验与真实 operation 紧邻：

~~~rust
fn fs_mutation_error(code: &str, path: &Path, detail: impl std::fmt::Display) -> String {
    serde_json::json!({
        "code": code, "path": path.to_string_lossy(), "message": detail.to_string()
    }).to_string()
}

fn fs_io_mutation_error(path: &Path, error: std::io::Error) -> String {
    let code = match error.kind() {
        std::io::ErrorKind::NotFound => "not-found",
        std::io::ErrorKind::PermissionDenied => "permission-denied",
        _ => "io",
    };
    fs_mutation_error(code, path, error)
}

fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))] { let _ = metadata; false }
}

fn with_regular_file(
    path: &Path,
    operation: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| fs_io_mutation_error(path, e))?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(fs_mutation_error("unsafe-path", path, "link or reparse point"));
    }
    if !metadata.is_file() {
        return Err(fs_mutation_error("not-file", path, "ordinary file required"));
    }
    operation(path)
}

fn remove_file_impl(path: &Path) -> Result<(), String> {
    with_regular_file(path, |target| {
        fs::remove_file(target).map_err(|e| fs_io_mutation_error(target, e))
    })
}

fn trash_file_impl(path: &Path) -> Result<(), String> {
    with_regular_file(path, |target| {
        trash::delete(target).map_err(|e| fs_mutation_error("io", target, e))
    })
}

fn authorized_mutation_path(
    roots: &AuthorizedRoots, root: &str, relative: &str,
) -> Result<PathBuf, String> {
    let canonical = roots.resolve_root(root)
        .map_err(|e| fs_mutation_error("unsafe-path", Path::new(root), e))?;
    rooted_path_from_canonical(canonical, relative)
}

#[tauri::command]
fn vault_remove_file(
    roots: tauri::State<'_, AuthorizedRoots>, root: String, path: String,
) -> Result<(), String> {
    remove_file_impl(&authorized_mutation_path(&roots, &root, &path)?)
}

#[tauri::command]
fn vault_trash_file(
    roots: tauri::State<'_, AuthorizedRoots>, root: String, path: String,
) -> Result<(), String> {
    trash_file_impl(&authorized_mutation_path(&roots, &root, &path)?)
}
~~~

同步局部修改真实 `rooted_path_from_canonical(mut resolved: PathBuf, relative: &str) -> Result<PathBuf, String>`：拒绝空串、绝对路径、非 Normal component、反斜杠、冒号与 NUL；逐层 `symlink_metadata` 同时拒绝 symlink/reparse point；词法/链接错误用 `fs_mutation_error("unsafe-path", ...)`，其他 IO 用 `fs_io_mutation_error`；NotFound 可留给最终普通文件检查。保持 String wire 兼容，但不要再把路径错误全部归为 not-found。授权根失效统一记 unsafe-path；trash crate 无可识别 IO kind 的错误保守记 io，绝不按 message 推测权限。

不得用 `stat_impl` 的 exists=false 兼容结果授权删除，也不得把最终目标 canonicalize 后才检查链接。此边界防止错误/恶意路径及静态链接；不声称仅靠路径校验消除了外部进程在检查与 operation 之间替换目录的所有 TOCTOU 风险。

- [x] **D1.3 — 前端统一解析 mutation error。**

新增 `src/lib/vault/fs-mutation-error.ts`，由 tauri-fs/memfs/store 共用，避免纯 store 引入 Tauri runtime：

~~~ts
export const FS_MUTATION_CODES = [
  'not-found', 'not-file', 'unsafe-path', 'permission-denied', 'io',
] as const;
export type FsMutationCode = typeof FS_MUTATION_CODES[number];
export interface FsMutationError { code: FsMutationCode; path: string; message: string; }

export function isFsMutationError(value: unknown): value is FsMutationError {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.code === 'string'
    && FS_MUTATION_CODES.some(code => code === record.code)
    && typeof record.path === 'string' && typeof record.message === 'string';
}

export function parseFsMutationError(error: unknown, path = ''): FsMutationError {
  if (isFsMutationError(error)) return error;
  if (typeof error === 'string') {
    try {
      const parsed: unknown = JSON.parse(error);
      if (isFsMutationError(parsed)) return parsed;
    } catch { /* 旧 string 错误保守归为 io */ }
  }
  return { code: 'io', path, message: error instanceof Error ? error.message : String(error) };
}
~~~

`removeFile`、`trashFile` 捕获 invoke rejection 后抛出 `parseFsMutationError(error, path)`。memfs 对缺失和目录使用相同结构；链接守卫用注入的假 fs 或 Rust fixture 验证，不假装 memfs 已有 symlink API。store 只按合法 code 分支，UI 显示已解析对象的 message 而不是 String(object)。保留 ST WIP Channel 修改和原有 stat 测试，不整文件重排。

- [ ] **D1.4 — 运行原生与前端门禁。**

~~~powershell
cargo test --offline --manifest-path src-tauri/Cargo.toml --lib
npm test -- src/test/tauri-fs-mutation.test.ts src/test/tauri-fs-stat.test.ts --reporter=dot
~~~

Expected：目录和链接永不进入 trash；普通文件成功；错误 code 在前端可稳定判断。离线依赖不可用时记录阻断原因，不用 pinned HEAD 的 Rust 结果冒充当前 WIP。

## Task D2：附件角色作用域、旧记录兼容与删除提交顺序（F01、F14）

**Files:**
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/types/archive.ts`
- Create: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/vault/character-relative-path.ts`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/attachment-store.ts`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/character/AttachmentPreview.tsx`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/character/AssetSection.tsx`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/attachment-store.test.ts`

- [ ] **D2.1 — 先写跨角色复用旧名的 RED 测试。**

测试建立角色 A、B：A 改名前记录为 `角色/A/附件/攻略.html`，改名后当前目录为 `角色/A2`；B 的目录中另有同名 `攻略.html`。重开库后对 A 的附件执行 preview/open/remove，断言只访问 `角色/A2/附件/攻略.html`；当前文件缺失时返回 `not-found`，绝不回退到 B 或旧 A 目录。测试还覆盖 Windows 分隔符、绝对路径、`../`、`附件/a/b`、空文件名和符号链接。

- [x] **D2.2 — 明确新旧路径格式。**

`AttachedFile` 增加可选 `pathBase?: 'character'`。新写入记录固定为 `path: '附件/<safeFileName>'`、`pathBase: 'character'`；不得把角色名写入新记录。旧记录只接受这一种已知形状：`角色/<single-safe-folder>/附件/<single-safe-basename>`，解析时只提取 basename，然后拼接**当前** `pathOf('characters', characterId)`；旧记录中任何第二层附件路径、绝对路径、越界段或非 basename 路径都标记 invalid，不调用 fs。

添加并测试两层纯解析：先检查安全段，再检查已知形状。`isSafeFileSegment` 和 `isCharacterRelativeSafePath` 在 D3 新模块 `portrait-journal.ts` 之外的共享文件 `src/lib/vault/character-relative-path.ts` 定义，附件与 journal 均直接 import：

~~~ts
export function isSafeFileSegment(segment: string): boolean {
  return segment.length > 0 && segment !== '.' && segment !== '..'
    && !/[\/\\:\u0000-\u001f<>"|?*]/.test(segment)
    && !/[. ]$/.test(segment)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment);
}

export function resolveAttachmentRelativePath(record: AttachedFile): string | undefined {
  const parts = record.path.replaceAll('\\', '/').split('/');
  if (!parts.every(isSafeFileSegment)) return undefined;
  if (record.pathBase === 'character') {
    return parts.length === 2 && parts[0] === '附件' ? parts.join('/') : undefined;
  }
  if (record.pathBase !== undefined) return undefined;
  return parts.length === 4 && parts[0] === '角色' && parts[2] === '附件'
    ? `附件/${parts[3]}` : undefined;
}
~~~

只对已知旧记录/附件输入将 Windows 分隔符归一化；journal 写入必须直接采用 `/`。合法 `a..png` 不等同于上跳目录；旧目录段本身也要校验，不能只检验 basename。
解析结果只作为角色相对路径；调用方基于 fresh 当前角色目录 join，并在 native boundary 逐层检查链接/普通文件。同名新文件使用现有唯一命名函数，不接受 UI 指定任意绝对路径。

- [x] **D2.3 — 所有动作按身份重新读取记录。**

把 store 对外动作收敛为 `characterId + attachmentId`：`getAttachmentPath(characterId, attachmentId)`、`openAttachmentExternally(characterId, attachmentId, reveal)`、`readAttachment(characterId, attachmentId)`、`removeAttachment(characterId, attachmentId, trash)`。每个动作从当前仓库重新获取角色和附件，再调用 `resolveAttachmentRelativePath`；返回给 UI 的 view 可带 `resolvedPath`，但 UI 再次动作不得把该字段传回 store。同步更新 `AttachmentPreview.tsx` 的 effect、`AssetSection.tsx` 的 open/remove 调用。

- [x] **D2.4 — 删除先物理成功，后修改档案。**

`removeAttachment` 顺序固定：重新读取角色 → 解析并检查当前普通文件 → 执行 `trashFile`/`removeFile` → 成功后通过 `updateCharacter` 以 attachment id 过滤生成 patch。整段重新读取/物理删除/生成 patch 在现有角色写队列的 updater 内执行，不能在排队前拿 stale 路径删文件。删除失败直接抛带 code 的错误，档案记录保持不变；`not-found` 也不自动删除记录，界面提供“仅移除失效记录”的明确另一个动作，避免把回收站失败吞掉。若 metadata 更新失败，物理文件已经删除，返回“文件已删除但记录未更新”的可见错误并安排下次扫描，不伪造完整回滚。

- [x] **D2.5 — 运行附件门禁。**

~~~powershell
npm test -- src/test/attachment-store.test.ts src/test/tauri-fs-mutation.test.ts src/test/tauri-fs-stat.test.ts --reporter=dot
npx tsc -p tsconfig.app.json --noEmit
npm run lint -- --quiet
~~~

Expected：改名、重开、同名跨角色、外开、预览、失败删除和失效记录都符合不越界规则。

## Task D3：角色准备式更新与 durable portrait journal（F03、F13 基础）

**Files:**
- Create: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/character-mutation.ts`
- Create: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/portrait-journal.ts`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/archive-db.ts`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/character-write.ts`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/pages/CharacterPage.tsx`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/vault/vault-backend.ts`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/portrait-store.test.ts`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/archive-db.test.ts`

- [ ] **D3.1 — 先建立准备式更新契约和 RED。**

`character-mutation.ts` 定义：

~~~ts
import type { ArchiveCharacter } from '@/types/archive';

export interface MutationCleanupReport { warnings: string[]; }
export interface MutationRecoveryReport { action: 'finalized' | 'rolled-back' | 'blocked'; warnings: string[]; }
export interface PreparedCharacterMutation {
  patch: Partial<ArchiveCharacter>;
  commitAfterPersist(): Promise<MutationCleanupReport>;
  recoverAfterPersistFailure(readPersisted: () => Promise<ArchiveCharacter | undefined>): Promise<MutationRecoveryReport>;
}
export type CharacterUpdaterResult = Partial<ArchiveCharacter> | PreparedCharacterMutation | undefined;
export function isPreparedCharacterMutation(value: CharacterUpdaterResult): value is PreparedCharacterMutation {
  return typeof value === 'object' && value !== null && 'commitAfterPersist' in value && 'recoverAfterPersistFailure' in value;
}
~~~

`archive-db.updateCharacter` 的 updater 参数类型改为 `updater: (current: ArchiveCharacter) => CharacterUpdaterResult | Promise<CharacterUpdaterResult>`。它仍先捕获当前 repo，再在 `characterWrites.enqueue(id, async () => { ... })` 内读取 current、执行 updater、合并 `mutation.patch`、`repo.put`。`repo.put` 成功后才调用 `commitAfterPersist()`；commit cleanup 失败只得到 warnings 并返回已保存角色，不把 warning 存进档案。为 `updateCharacter` 和 `PersistCharacterPatch` 增加可选第三参数 `options?: { onWarning?: (report: MutationCleanupReport) => void }`，保留原 `Promise<ArchiveCharacter | undefined>` 返回类型；`commitCharacterPatch` 可选第五参数透传该 options。肖像 UI 的 onWarning 展示 toast，异常 observer 不得改变保存结论。`repo.put` 抛错时调用 `recoverAfterPersistFailure(() => repo.get(id))`，恢复函数内部以重新读到的真实档案判断 before/after，不把内存中的 `next` 当作事实。若 action=finalized，重新返回实际已保存角色并发 warning；rolled-back 抛原保存错误；blocked 抛结构化恢复错误。

同步修改 `CharacterPatch`、`PersistCharacterPatch`、`commitCharacterPatch` 和 `CharacterPage.tsx` 的标签/更新时间包装，使 envelope 只在 archive-db 边界被识别，不能把 `commitAfterPersist` 字段写进 `档案.json`。先写一个 updater 返回 prepared mutation、注入 `repo.put` 失败、重开 repo 后检查的测试。

- [x] **D3.2 — 写 durable journal，且 journal 在第一次文件 IO 前落盘。**

`portrait-journal.ts` 使用当前角色目录下 `.ste-control/portrait-journal/<operationId>.json`，类型固定为：

~~~ts
export interface PortraitMutationJournal {
  version: 1;
  operationId: string;
  characterId: string;
  status: 'prepared' | 'committed';
  beforeRows: PortraitRow[];
  afterRows: PortraitRow[];
  createdFiles: string[];
  cleanupFiles: string[];
  createdAt: number;
}
~~~

在 D2 的 `character-relative-path.ts` 增加以下完整签名和形状校验（不是 OS containment 的替代）：

~~~ts
export function isCharacterRelativeSafePath(
  relativePath: string,
  kind: 'portrait' | 'journal',
): boolean {
  const parts = relativePath.split('/');
  if (parts.length !== 3 || !parts.every(isSafeFileSegment)) return false;
  if (kind === 'portrait') return parts[0] === '立绘';
  return parts[0] === '.ste-control' && parts[1] === 'portrait-journal'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i.test(parts[2]);
}
~~~

所有媒体路径按当前 row 目录和文件名生成，再以 kind=portrait 验证；journal 自身用 kind=journal。`createdFiles` 预先列出本次 operation 唯一的临时与最终路径；`cleanupFiles` 只能取 beforeRows 引用集合减去 afterRows 引用集合，禁止删除 afterRows 仍引用的文件。创建路径还要排除 beforeRows 引用、磁盘现存文件和散图，不能通过 journal 自述取得任意文件删除权。journal 原子写成功后才写/改任何媒体；失败不碰旧文件。现有 `VaultFs` 没有 copy，统一使用 `readBinary → writeBinary(temp) → rename(temp, final)`，rename 不覆盖。

- [x] **D3.3 — 恢复不得误回滚同进程的活跃操作。**

在 `portrait-journal.ts` 定义 `recoverCharacterJournals(characterDir: string, characterId: string, fs: VaultFs): Promise<MutationRecoveryReport[]>`，只依赖 `src/lib/vault/fs.ts` 与类型/路径 helper，不反向 import archive-db。扫描固定控制目录，校验 schema/id/路径和引用归属，以原始 fs 读取真实 `档案.json`，避免通过 repo.get 再次递归触发恢复。`立绘/立绘.json` 始终只是派生 projection。

同一 vault backend 的活跃 operation 集合按 fs 实例 + characterId 隔离；prepare 写 journal 前注册，persist/finalize 或显式失败恢复完成后才在 finally 释放。`repo.get/list/put` 的自动恢复跳过活跃 journal，不能看见 prepared + beforeRows 就回滚；活跃跳过不记为已恢复，之后需重试。`recoverAfterPersistFailure` 是事务拥有者的显式恢复，可检查自己的 journal，但仍只以真实档案判定。角色修改/改名/删除与 prepare/persist/finalize 必须在同一写队列串行，恢复 hook 不再次抢持有中的队列导致死锁。重开 backend 时没有活跃标记；先恢复再暴露可写角色。该内存标记不被当作跨进程文件锁。

对非活跃 journal 比较完整 beforeRows/afterRows；无改变的操作在 prepare 前作为 no-op 返回，不产生相同 before/after 的含糊日志：

1. 当前等于 after：按 `cleanupFiles − 当前引用集合` 清理旧媒体；`createdFiles` 中仅清理不被 after/当前引用的残留临时文件，**绝不能删新提交的最终文件**。更新派生 snapshot 并移除 journal；任何清理失败保留 committed journal + warning。
2. 当前等于 before：仅清理 `createdFiles − 当前引用集合`；旧文件不动。全部清理成功后移除 journal，否则保留 journal + warning。
3. 两者都不等、档案缺失、schema 损坏或无法证明路径归属：不删任何媒体；使用 code=`portrait-recovery-required` 的结构化阻断信息（包含 characterId、operationId、message），禁止继续破坏性修改，要求显式恢复。只读错误展示不得打印完整档案。

恢复以当前角色目录为根，不回旧名字目录；prepared/committed 状态仅是提示，真实 metadata 才是事实。测试覆盖每个中断点和重复恢复幂等性，以及：prepare 后 repo.put 内部读取不触发回滚；after 分支保留全部新图；共享旧文件仍被其他 item 引用时不清理；畸形/outside-scope 不触碰任何媒体。

- [x] **D3.4 — 运行事务基础门禁。**

~~~powershell
npm test -- src/test/archive-db.test.ts src/test/portrait-store.test.ts --reporter=dot
npx tsc -p tsconfig.app.json --noEmit
~~~

Expected：prepared mutation 始终在同一角色写队列内完成 prepare/persist/finalize；后续角色更新不会插入 journal 尚未提交的窗口；重启后 before/after 判定可重复。

## Task D4：立绘替换改为 copy-on-write（F03、F15）

**Files:**
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/portrait-store.ts`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/character/PortraitSection.tsx`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/portrait-store.test.ts`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/portrait-lazy-load.test.tsx`

- [ ] **D4.1 — 先写每个中断点的 RED。**

故障注入覆盖：写新文件失败、写 journal 失败、metadata `repo.put` 失败、post-commit 清理失败、旧文件缺失。断言写新文件失败/metadata 失败后旧文件仍能读；清理失败返回 saved character + warning 且 journal 留存；未知路径 never delete。

- [x] **D4.2 — 实现替换顺序。**

文件库分支固定为：计算当前条目和旧文件 → 生成角色目录内唯一临时名与唯一最终文件名 → 写 durable journal → 写临时文件 → 将临时文件 rename 到最终文件（不覆盖）→ 返回 `PreparedCharacterMutation`，其中 `patch.portraitRows` 是深拷贝，目标 item 设置新 `fileName`/`mime`、明确 `dataBase64: undefined`，journal 的 `cleanupFiles` 才列旧文件。metadata persist 成功后标记 committed，再 best-effort 删除旧文件和 journal；persist 报错后重新读取档案，按 D3 的 before/after/blocked 三分支恢复，不统一当作 rollback；只有 before 分支才回滚 createdFiles。

网页/IndexedDB 分支不创建磁盘文件，继续把新图片写入 `dataBase64`。无论分支如何，返回 patch 必须清除互斥来源字段；客户端 `loadPortraitViews` 与 `loadPortraitImage` 因而都会显示新文件，不会优先使用旧 inline 数据。

- [x] **D4.3 — 更新 UI 提交流程。**

`PortraitSection.tsx` 的 replace 通过 `commitCharacterPatch(id, current => replacePortraitItemMutation(current,...), updateCharacter, setCharacter)`；成功后 reload views；失败不更新 views、不清空 lightbox，并显示 recovery warning。`writeSnapshot` 是 metadata commit 后的派生操作，失败只保留 journal/warning，不改变已保存角色结果。

- [x] **D4.4 — 运行替换门禁。**

~~~powershell
npm test -- src/test/portrait-store.test.ts src/test/portrait-lazy-load.test.tsx --reporter=dot
~~~

Expected：旧文件在 persist 失败时仍可读取；新文件在 persist 成功后显示；旧 inline 数据不会遮住新磁盘图。

## Task D5：批量移动使用 copy-on-write，避免共享对象和半成状态（F13）

**Files:**
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/portrait-store.ts`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/character/PortraitSection.tsx`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/portrait-store.test.ts`

- [ ] **D5.1 — 写 RED：第二项复制失败和 persist 失败。**

准备两个不同来源文件，第二次 copy/rename 故障注入；断言第一项回到“未提交”状态、第二项原文件仍在、原始 `rows/items` 的引用和字段未被改变、档案与 snapshot 没写目标状态。再注入 metadata persist 失败，断言所有新文件删除或由 journal 可恢复，旧文件仍在。

- [x] **D5.2 — 实现完整副本和 allow-list 回滚。**

先深拷贝 rows/items，按目标 row 计算一组不冲突的文件名；为每项 copy 到目标临时文件并记录 `createdFiles`，全部 copy 成功后把临时文件 rename 到最终文件，再返回一个 `PreparedCharacterMutation`，patch 只引用副本。任一步失败只删除本次 journal 的 `createdFiles`；删除失败保留 journal 并抛出“部分文件需要恢复”的结构化错误。不要逆序 rename 用户原文件，不在 prepare 期间修改传入 character 或嵌套 item。

commit 后 cleanup 删除旧文件；cleanup 失败是 warning + committed journal。内存/网页版只做深拷贝后的 rows patch，不执行文件动作。

- [x] **D5.3 — 运行批量移动门禁。**

~~~powershell
npm test -- src/test/portrait-store.test.ts --reporter=dot
npx tsc -p tsconfig.app.json --noEmit
npm run lint -- --quiet
~~~

Expected：成功是“全部新文件 + metadata”，失败不返回部分成功；共享 item 引用测试通过。

## Task D6：文件安全交付检查

D6 是 D1—D5 的组合验收，不新增业务修复范围；结果按 F01/F03/F13/F14/F15/F16 分别写入总计划 S2.4 验收记录。

- [x] **D6.1:** `rg -n "\.path|removeFile|trashFile|rename|copy" src/lib/attachment-store.ts src/components/character/AttachmentPreview.tsx src/components/character/AssetSection.tsx src/lib/portrait-store.ts`，确认 record path 只在兼容解析函数出现，所有 mutation 都走当前角色 + id 和 journal allow-list。
- [x] **D6.2:** 使用临时 memfs/合成 VaultBackend 做“改角色名→关闭→重开→旧名在另一角色存在→预览/删除”回归；不读取真实 `user/`。
- [x] **D6.3:** 执行 `npm test -- src/test/attachment-store.test.ts src/test/portrait-store.test.ts src/test/archive-db.test.ts --reporter=dot` 和 `cargo test --offline --manifest-path src-tauri/Cargo.toml --lib`。
- [ ] **D6.4:** 使用 S0 snapshot 比较 ST WIP 文件；不要以 `git diff -- lib.rs st_backup_import.rs` 为空作为成功条件。暂存只包含 D1 局部 hunk 和本 D 工作包，不能吞入现有导入/取消/进度改动。
