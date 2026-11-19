# STE 文件库格式与版本保护

核对日期：2026-11-20，Codex；11月12日建立，本次补充角色可恢复保存与格式3。本文记录当前实现。路径相对 STE 库根，使用 `/`；ST 来源、STE 库、工作副本和导出包分别对待。

## 库级版本与打开规则

`库信息.json` 的 `schemaVersion` 是整个库的兼容性版本，当前为 **3**，单一常量在 `src/lib/archive-schema.ts`。记录身份固定为 `id: "archive-schema"`，还有 `updatedAt`，可选 `libraryTags`、`presetTags`、`roleplay` 等偏好；`tagMigrationVersion` 单独记录旧标签迁移完成度。这与应用版本 `0.9.9`、IndexedDB 的 `DB_VERSION`、世界的存档 revision 都不同。

桌面启动、引导页选库、运行中选择已注册库或新增库，在激活／记录下一次启动目标前调用同一个 `assertCompatibleVault`，直接读 `库信息.json`，不创建或扫描库后端。数值版本高于当前支持的3时停止，提示“这个库被更新版本的 STE 使用过，请用新版本打开”；保留选择其他库的入口，不向被拦截的库写入文件。运行中拦截不替换当前后端，也不切换下次启动目标。系统配置恢复或原生目录授权不是库内文件写入。代码：`src/lib/vault/vault-format.ts`、`bootstrap.ts` 的 `bootVault`、`vault-registry-runtime.ts` 的 `assertVaultDirectory`；界面为 `VaultGate`、`VaultSwitcher` 和设置页原有错误提示。

版本等于／低于当前值、缺失或非数值时继续既有流程；缺少元信息文件及 JSON 解析失败也交给既有后端处理。文件读取本身失败不会当成兼容：启动回到选库，切换拒绝。网页 IndexedDB 库不加此文件库闸门。

格式3新增角色档案／PNG与目录改名的恢复清单。首次需要该保存流程时，先原子写入并回读库级版本3，再发布恢复清单，确保保存中断也有兼容性门禁；目录与图片都不变的单档案保存仍走原子单文件路径。较旧的元信息快照不能把库版本降回2，也不能丢掉已记录的迁移进度。角色／故事／世界正式记录的既有形态不因本轮改变。

支持版本2且已经有打开保护的旧程序（例如11月12日收尾包）会拒绝格式3库；更早、没有版本闸门的程序不能依赖这道保护。不要手动降低版本号以强行打开，也不能把两款不同时期程序同时写同一库视为受支持操作。

**以后任何可能让旧版本读错或写坏的磁盘变化，必须在写入新形态前提升这个库级版本号。** 只增加子文件版本不能替代库级版本。闸门针对打开时的版本；不提供云盘、外部并发改写或多版本同时写库的兼容协议。

旧数据迁移由 `MigrationNotice` 调用 `runArchiveMigration`：角色标签与 NSFW 回填、故事字数／末消息时间回填，所有记录成功后才将 `tagMigrationVersion` 记为2并推进库兼容版本。没有此字段时，以 `min(schemaVersion, 2)` 推断旧进度；保存提前写入版本3时会先保留原迁移进度。因此迁移中断即使库版本已是3，下次仍能重试，已完成的记录不重复改写；既有格式2库也不会仅因当前兼容版本变成3而重扫标签。代码 `src/lib/archive-migrate.ts`、`src/lib/archive-db.ts` 与 `src/lib/vault/character-save.ts`；回归见 `archive-migrate.test.ts`、`vault-write-consistency.test.ts`。

同运行时的库变更共享队列，运行资料的路径解析与读写也参与，避免父角色改名时写进旧目录；同库句柄共用独立的角色保存恢复队列，防止重复回滚同一清单。原生进程还持有库占用标记，另一个使用同机制的进程无法同时读写或恢复该库。Windows用库规范路径摘要命名的系统对象，最后句柄释放即结束占用，不在受检查库内创建文件；非Windows使用系统临时目录中的锁文件，尚无本轮原生实测。此机制不约束外部编辑器、云盘或不支持占用标记的老程序，见 `src-tauri/src/library_lease.rs`。

## 记录与目录

下表的必填项是当前写入方使用的类型契约；扫描器通常只以字符串 `id` 识别条目，并非逐字段验证器。除特别说明外均无单独文件版本，受库级版本约束。所有记录保留 `id`、`updatedAt`，多数还有 `createdAt`；可选字段见对应类型，未知 JSON 元数据尽量往返保留。名称经 `safeName` 清理，重名追加 `·N`；文件夹名称不是记录身份。代码：`src/lib/vault/naming.ts`、`vault-backend.ts:68`（11种 store）、`:83`（目录常量）、`:543`（读取分派）、`:754`（写入分派）。

| 文件类型／路径 | 真源、必填与可选字段 | 写入方与代码位置 |
| --- | --- | --- |
| `库信息.json` | 库级元信息；`id/schemaVersion/updatedAt`，可选标签与玩法偏好；不存 API 密钥 | `archive-db.ts:31,294`；`vault-backend.ts:792` |
| `角色/<名>/档案.json` | 角色真源；`id/name/card/tags/status/createdAt/updatedAt`。`status` 是保留的旧字段；可选展示名、类型、备注、评分、简介、资产引用、立绘行、附件与来源路径 | `src/types/archive.ts:116`；`vault-backend.ts` 的 `putCharacter/readCharacter` |
| 同目录 `卡片.png` | 可选卡面二进制；`pngBase64` 拆出为此文件，读取时装回记录。卡 JSON 与 PNG 可能含不同用途的元数据，不应只手换一个文件来编辑整张卡 | `vault-backend.ts` 的 `putCharacter/readCharacter` |
| `角色/<名>/故事/<标题>/故事.json`；未绑定时 `临时/<标题>/故事.json` | 故事唯一真源；`id/title/session/markers/meta/createdAt/updatedAt`。可选 `characterId`、`branches`、收藏／阅读位置、标签／评分／状态、来源与写回历史。分支有自己的 `id/name/session/markers/createdAt/updatedAt` | `src/types/archive.ts` 的 `ArchiveStory/StoryBranch`；`vault-backend.ts:640` 起 `putStory` |
| 故事目录 `聊天.jsonl`、`分支·<名>.jsonl` | 派生的 ST 工作副本，只写不读；正文保存时由故事的 session／branches 重生成，旧规格内分支文件随之清理。手改不会回写到 `故事.json` | `vault-backend.ts:655`；`src/lib/adapters/st/chat-jsonl.ts` |
| 故事目录 `分卷总结·<名>.md`、`角色日记·<名>.md`、`DIY 创作·<名>.md`；孤儿在 `临时/记录/` | Markdown 正文是真源，头部含除 `content` 外的记录字段；必需 `id/bookId/bookTitle/kind/title/floorStart/floorEnd/createdAt/updatedAt`，`bookId` 可为 null；可选分支、卷号、生成参数、来源锚点与迁移来源 | `src/types/summary.ts:45`；`vault-backend.ts:759` |
| 故事目录 `故事树·<名>.json`；孤儿在 `临时/记录/` | `id/bookId/bookTitle/title/nodes/createdAt/updatedAt`；可选分支、自动暂存、来源；nodes 内节点 id 与 parentId 构成树 | `src/types/story-tree.ts:69`；`vault-backend.ts:764` |
| `临时/卡片/<标题>.json` 与同名可选 `.png` | 处理区卡片，与角色库档案分开；`id/title/card/createdAt/updatedAt`，可选 autoSaved；图片同样拆出 | `src/types/character-card.ts:9`；`vault-backend.ts:682` |
| `资产/世界书/<标题>.json` | ST 兼容世界书，顶层 entries 和原始键；`__ste` 保存 STE 的 `id/title/createdAt/updatedAt` 及可选来源、派生、内嵌、全局引用等元数据 | `src/types/worldbook.ts:41`；`vault-backend.ts:491,739` |
| `资产/预设/<系列>/<标题>.json` | ST 原生 prompts／prompt_order 等，与 `__ste` 内的 `id/title/createdAt/updatedAt` 和可选 catalog／packageFiles／来源分开。无系列时用作者，再无则 `未分系列`；兼容递归读取旧子目录 | `src/types/preset.ts:63`；`vault-backend.ts:503,746,773` |
| `资产/正则/<标题>.json` | `{ __ste, rules }`；`__ste` 包含 `id/title/createdAt/updatedAt` 和可选派生、来源、内嵌关系 | `src/types/regex.ts:17`；`vault-backend.ts:523,778` |
| `资产/模板/总结模板·<标题>.md` | `id/title/kind/createdAt/updatedAt` 在头部，content 为正文，kind 支持 `any`；代码内置模板不写入 | `src/types/summary.ts:101`；`vault-backend.ts:782` |
| `资产/模板/评分模板·<标题>.json` | `id/title/dimensions/prompt/createdAt/updatedAt`，维度必需 name／weight，可选 hint；可选 builtin | `src/types/rating.ts:20`；`vault-backend.ts:786` |

Markdown 头部是 `---` 包围的 `key: <JSON值>` 行，字符串保留引号、数组／对象用单行 JSON；不是任意 YAML。未知键保留，缺头部或错误行沿用宽容解析。代码：`src/lib/vault/frontmatter.ts:21,41`。世界书和预设在必要时于 `__ste.__ste_normalized_v1` 保存 `format/digest/payload` 表示提示；原生内容摘要匹配才用 payload，否则以原生内容解析，见 `vault-backend.ts:119`。

## 旁路文件、运行记录与恢复资料

这些文件由专门存储器写入，不属于上面的11种 Repo store。`.ste` 与 `.ste-control` 不是一个可以整体删除的缓存目录。

| 路径／类别 | 格式与用途 | 写入／读取依据 |
| --- | --- | --- |
| `.ste-control/character-saves/<operationId>/manifest.json`、`before-profile/after-profile`、可选 `before-png/after-png`、`committed.json` | 格式3引入的角色保存恢复资料；manifest 的 `schema:1/operationId/characterId/from/to/files`，files记录前后摘要；committed保存清单摘要。未提交时先校验全部备份及目标再回滚，已提交时完成清理；未知文件变化阻止恢复并保留现场。不能按缓存删除 | `src/lib/vault/character-save.ts`；正式索引只在保存完成后发布 |
| `角色/<名>/立绘/<行名>/<文件>`；`立绘/立绘.json` | 图片字节与档案 portraitRows 的行／图片 id 相互关联。JSON 是只写不读的可重建结构快照，键为“说明／当前卡面条目／行”；真源仍是档案 | `src/lib/portrait-store.ts:179,256`；`portrait-snapshot.ts:5` |
| `角色/<名>/附件/<文件>`，也兼容既有附件位置 | 任意字节；档案 attachments 必需 `id/title/path/size/addedAt`，新记录 `pathBase:"character"`，旧记录可用库相对路径；使用解析器定位，不能直接改路径前缀 | `src/types/archive.ts:97`；`attachment-store.ts:189`；`vault/character-relative-path.ts` |
| 角色下 `.ste-control/portrait-journal/<operationId>.json` | `version:1`，operationId／characterId／status／beforeRows／afterRows／createdFiles／cleanupFiles／createdAt；可选 deletion。用于提交或回滚，未知版本保留并阻止有关写入，不是日志缓存 | `src/lib/portrait-journal.ts:9,84,138` |
| `.ste/retained/<operationId>/manifest.json`、`files/<原相对路径>`、`committed.json` | 回收资料；manifest 的 `schema:1`，operationId／store／id／createdAt／deleteFiles／files，可选 recycleAfter；files 中记录 path／size／version 指纹。committed 保存 manifest 摘要。缺少完成标记按恢复规则处理 | `src/lib/vault/file-maintenance.ts:41,419,626,640` |
| `.ste/moves/<operationId>/manifest.json`、`before`、`after`、`committed.json` | 移动事务 `schema:1`；operationId／from／to／before／after，版本指纹与目标内容必须一致；不能手改、按缓存删除 | `file-maintenance.ts:783,814,845` |
| `.ste/写回备份/<storyId>/*.jsonl` | 显式写回或恢复 ST 前保存的原文；故事 writebacks 保存关联信息。与来源及派生聊天分别对待，备份不是可重建缓存 | `src/lib/vault/st-writeback.ts:16,105,181` |
| `资产/其他/SillyTavern/<kind>/<原相对路径>` | 导入时选择的其他资产原样副本；生成的身份清单 `personas.json` 为 `version:1`，必需 personas／personaDescriptions，可选 defaultPersona／personaSortOrder | `src/lib/vault/st-import.ts:518,1230,1252`；`other-assets.ts` |
| `说明/SillyTavern 导入说明.md`、`SillyTavern 最近一次导入.json` | 每次导入更新；JSON 为 sourceRoot／importedAt／summary，无独立版本；中途取消仍记录实际结果 | `st-import.ts:1279` |
| 故事下 `memory/<main或branch-编码id>/**/*.md` | 记忆正文与 JSON值头部：schema／id／kind／operationId／sourceRefs 等，不能只因是 Markdown 就当普通导出。`index.md` 是可重建索引；其他记忆正文与来源锚点要保留 | `src/lib/roleplay/paths.ts:1`；`memory.ts:167,276` |
| 故事下 `.ste-control/roleplay/<分支>/settings.json`、`context.json`、`draft.json`、`helpers.json`、`frontend.json` | 运行配置、上下文账本、未完成草稿和脚本／成品前端状态。settings 为 mode／memoryOwner；context、helpers、frontend 当前 schema 为1；draft 随宿主存储结构保存。这些均有恢复或游玩语义，不能整体清空 | `runtime-store.ts:29`；`agent-runtime.ts:83,216`；`context-ledger.ts:31`；`tavern-host.ts:562`；`helper-settings.ts:45`；`src/lib/frontend-workbench-store.ts:19` |
| 同分支下 `turns/`、`memory-journal/`、`memory-updates/`、`maintenance/`、`receipts/`、`inputs/`、`inheritance.json`、`worldbook-versions/<摘要>/<摘要>.json` | operationId／turnId 等经摘要构成文件名；账本、记忆事务、维护事务、继承计划与世界书版本记录目前 schema 为1，并校验状态、来源锚点或摘要；receipt／input 按各自类型，无统一子版本。保留未完成操作及证据 | `context-ledger.ts:17,38`；`memory.ts:32,64`；`agent-runtime.ts:30,40,49,133,199,235`；`branch-inheritance.ts:22,121`；`worldbook-versions.ts:63,103,129` |
| `世界/<worldId>/<六位revision>.json` | 不可变存档链；`schema:1/id/worldId/title/revision/parent/hash/updatedAt/kind/deleted/state/events`，可选 origin／command。从0连续编号、校验 parent/hash；新增先写 pending临时文件再无覆盖 rename；未知schema停止在最后完整版本 | `src/play/storage/world-commit.ts:5,12`；`world-repo.ts:10,63,143` |
| `世界素材/<SHA256>.json` | `id/mime/data/width/height/updatedAt`，无独立schema；内容寻址、不可变，与世界中的引用相连；不是可以随时重新生成的缓存 | `src/play/media/asset.ts:3`；`media-repo.ts:6,27` |
| `.ste-control/index/story-summaries-v2.json` | 可丢弃缓存：`schema:2/entries`，条目包含路径、stamp／digest／summary；用文件时间／大小与摘要校验。损坏、不支持的schema或超限时从故事重建，写入失败不阻止读库 | `src/lib/vault/story-summary-index.ts:5,20,51` |
| `.ste-control/index/record-identities-v2.json` | 可丢弃的总结／故事树身份缓存，复用schema2索引容器；仍实时发现目录和文件，仅稳定大小／修改时间一致时复用身份。改名、删除、孤儿、损坏或缺少稳定时间戳时按实际文件重建 | `vault-backend.ts` 的 `buildIndex`、`story-summary-index.ts` |
| `.ste-control/story-packages/<摘要>/story`、`dependencies/<store>/<id摘要>`；`.ste/preset-exports/<token>` | 导入和导出的阶段目录，分别存待发布故事／资产与预设文件；只有发布完成后才成为正式记录。中断现场不是一般缓存，保留以便判断是否已提交 | `src/lib/roleplay/story-package.ts:401`；`vault-backend.ts:967,1003`；`src/lib/preset-package.ts:184` |

运行文件读写统一受 storyId、branchId 和当前库 epoch 限制（`runtime-store.ts`），但各子格式仍各自解释。日志只在应用日志目录；API 配置／库注册表在系统配置目录，不属于库格式。正式配置不能由 Codex 的 MSIX 重定向视图代替用户桌面视图。

## 导出包与各自版本的现状

| 格式 | 当前版本与接受规则 | 依据 |
| --- | --- | --- |
| `.ste-reading` ZIP | manifest 的 app／format／producedBy 与各类条目清单，format 当前1；拒绝非数值或大于1的版本，再验证条目。media 为独立字节，包不含原机来源路径 | `src/types/reading-pack.ts:31,109`；`src/lib/reading-pack/import.ts:247` |
| `.ste-play` JSON | `format:"ste-play",version:1,story,characters,assets,files,omissions`；严格接受1，预览与导入分离，校验引用和附件 | `src/lib/roleplay/story-package.ts:28,256` |
| 世界包 JSON | `app:"ste-world",version:2,scope,codec:"gzip-per-commit",entries,assets`；严格接受2，逐版本验证链和素材 | `src/play/storage/world-package.ts:16,20` |
| 完整备份 JSON | app 标记、version 为当时 DB_VERSION、exportedAt 和各store数组；读取时只记录数值version，不以“更高版本”拒绝；只遍历已知store，按现有预览／确认流程导入 | `src/lib/storage-utils.ts:90,185,212` |
| 预设文件／ZIP／导出文件夹 | ST JSON 与随包原文；catalog.version 是作者版本文字，无包级兼容号；导出副本按现有路径与无覆盖流程产生 | `src/lib/preset-package.ts:129,166` |

已核实但本轮不改的子格式边界：`presetTags.schemaVersion` 高于2时仍按旧形态规整，保存会写回2（`src/lib/preset-tags.ts:30,74`）；显式重新导入会用生成的version1覆盖已有 `personas.json`（`st-import.ts:518,1257`）；更高schema的故事摘要缓存会被当前可重建缓存替换；完整备份不按更高DB_VERSION拒绝且不保留未知store。这些不等同于库级闸门，未来不兼容改动必须先提升库级版本；原代码的风险和缓存例外在最终报告分别列明。

## 外部编辑与不变标识

关闭 STE 并备份后，可以编辑自己放入的独立说明文件；可以修改总结／日记的 Markdown 正文，但须完整保留头部和记录身份，避免 STE 开着时用旧缓存覆盖。ST 兼容资产的原生字段可用相应格式工具编辑，必须保留 `__ste`；再次打开／刷新后重新读取。JSON 角色／故事含多方引用与派生字段，优先通过应用修改；直接编辑不享有应用内校验、事务或联动更新。`聊天.jsonl`、立绘快照、故事索引等派生文件的手改不会成为真源。依据为上文读写映射、`frontmatter.ts` 和 `vault-backend.ts` 的读取缓存／序列化逻辑。

不可改写的身份包括：角色、故事、分支、消息、故事树节点、独立资产、立绘行／图片、附件、operationId／turnId，以及 `archive-schema`；不能独立改引用端的 characterId／bookId／branchId／assetId／messageId／parentId。世界的 worldId／revision／id／parent／hash、素材摘要文件名与内容也不能手改。来源 sourcePath、附件 path 与相对作用域属于定位和恢复依据，不可用整库文本替换迁移。显示标题可以变，真实改名／移动交由应用完成。具体类型在 `src/types/archive.ts`、`story-tree.ts` 及上表各事务／世界类型。

## 集合核对与验证

核对方法：逐项对照 `VAULT_STORES` 的11个store、`readRecord/putRecord` 分派，再搜索 `src/lib`、`src/play` 的 `writeText/writeBinary` 和 runtime store 写入调用；分离剪贴板写入、ST显式写回、库旁路写入与导出包。核对结果为本页记录表11种store全部有映射，旁路表覆盖立绘／附件／事务／回收／写回备份／ST其他资产／导入说明／运行资料／世界／素材／缓存／阶段目录；`books` 已退役，不在文件库集合。未扫描用户库或私密正文。

`src/test/vault-format-gate.test.tsx` 用真实启动与切库协作、真实 VaultGate／VaultSwitcher 和原生调用替身验证高版本零库写入、提示和选库可恢复、旧版／当前／缺版本兼容；`archive-migrate.test.ts` 与 `vault-write-consistency.test.ts` 验证迁移失败不冒记完成、重试幂等、兼容性先落盘与保存中断恢复。11月20日独立标识原生测试进一步确认拒绝新版库时文件和目录零变化、两个实际进程排他及释放后可重开，详见[本轮执行记录](../maintenance/2026-11-19-review-hardening-execution.md)。本轮未打新发布包，用户桌面验收未完成。
