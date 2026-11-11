# Batch 1 收尾：双视图统一记忆中枢与短事实

> 后续仅方案：已按实际项目链接和参考原图重写为[v3原生世界方案](2026-11-07-play-world-v3.md)。用户选定沙盘优先；本历史方案不再执行，v3尚未获实施授权。

> 当前状态（2026-11-07）：用户否决本轮成果，两轮实现均已回退。本文仅保留历史讨论，不再是执行依据；此前批准和技术测试不代表游玩体验认可。见[回退记录](../../verification/2026-11-07-multimode-rollback.md)。

> 2026-11-07 执行更新：用户与Antigravity已联合批准本修订版并授权完成全部批次。Batch 1～4源码已实现，当前实现映射、验证证据、差异及平台未验项以[全批次交付](../../verification/2026-11-07-two-pillars.md)为准。下文保留11月6日规划快照中的拟议接口和验收目标；其“尚未实施/仅文档”描述不再代表当前状态。未打包、发布或推送。

2026-11-06 · Codex · v2实施计划，**尚未实施**。用户在旧Batch 1试看后指出方向偏差，当前是重新规划。本文件取代旧实施计划作为后续依据；历史代码与测试保留在[v1快照](2026-11-06-batch1-memory-choices-v1-archive.md)和[旧验证记录](../../verification/2026-11-06-memory-choices.md)，不等同新版验收。

总架构与统一额度以[两大支柱架构](2026-11-06-multimode-transparent-memory.md)为准。以下新增路径是拟议名称，实施前按真实仓储和接口核对；不重写ST聊天运行时、不重新开发原文选项。

## 1. 用户能完成的四件事

1. 点“记忆”，在**剧情时间线 / 状态与事件**两个同级Tab间切换；回顾已有小总结、日记与章节总结，搜到内容后跳原楼层。
2. 从楼层记一件事：选类型、对象，写一句话或引用已有小总结，保存到状态与事件。默认不出现整层原文。
3. 对确认事实逐条启停、改正、删除/恢复，分清持久状态与“本轮是否使用”；已停用内容不在旧Ledger里偷偷继续生效。
4. 可选周期提取随现有总结/维护执行，候选需玩家确认。旧摘录保留可整理入口，不直接冒充确认事实。

Batch 1只有记忆中枢收尾和已有选项兼容验证；GAL视觉舞台、RPG和房间不提前塞进此批。

## 2. UI与交互状态稿

桌面侧栏宽度建议420～480px，手机单张Sheet宽100%，沿当前主题、圆角与字体。顶栏维持单行，“记忆”始终可达。面板两个Tab各占一半；搜索放其下，类型/状态过滤收为轻胶囊。低频“维护来源/旧摘录/提取设置”位于更多，不形成数据库表单。

| 区域/状态 | 玩家所见与操作 | 数据与反馈 |
| --- | --- | --- |
| 时间线默认 | 小总结/日记/章节卡按楼层排列；标签、范围、两三行摘要 | 只读投影，无网络调用/Prompt变化 |
| 时间线空态 | “这个分支还没有总结”，可去现有总结工具 | 不自动总结整个故事，不展示错误的其他分支资料 |
| 搜索/定位 | 匹配词高亮；点“回到第N楼” | 按稳定消息身份定位；范围失配则解释，不错跳 |
| 长日记/大总结 | 点击展开，章节可折叠；“编辑原记录” | 编辑沿原入口；返回恢复面板筛选与锚点 |
| 状态与事件 | 类型＋对象＋一句话、状态、Switch、来源 | 文字/颜色双标识；详情显示本轮是否用及原因 |
| 事实编辑中 | 原卡局部编辑、保存/取消 | 只锁当前卡；expectedDigest冲突保留草稿并重读 |
| 失效/已删除 | 失效说明来源变化；删除项在筛选内可恢复 | 不注入；恢复默认停用，不能恢复旧Ledger |
| 待确认 | 同一事实视图中的“待确认(N)”筛选/卡片 | 逐条改/接受/拒绝；未确认无启用Switch |
| 抽屉默认 | 类型默认事件、对象默认当前角色、空一句话、示例placeholder | 主按钮“保存事实”空时禁用，无标题/权重必填 |
| 引用小总结 | 有结果才显示；可预览并引用 | 只复制summary，不带userText；过长需选取/提炼，不静默截断 |
| 保存中/失败 | 按钮loading立即防双击；失败保留全部草稿 | 同operationId安全重试；成功收起并指向事实Tab |
| 旧摘录 | “旧摘录待整理”卡片，可展开全文 | 显示“尚未作为短事实使用”，支持提炼或收录原总结 |
| 390px/键盘 | Sheet内部滚动、底部保存可见，输入16px | visualViewport/safe-area；热区≥44×44、无横向溢出 |

抽屉高级设置仅包括可见范围/固定事实等必要项；UUID、原路径、revision只在诊断，不给玩家填。秘密类别需可见对象选择；普通单角色故事把当前角色绑定为稳定principal，后续房间导入映射成actor实例，不能用显示姓名作为安全键。

“当前维护者：原生 / 柏宝书 / 未自动维护”用说明和原设置入口呈现，不把切Tab变为维护权切换。没有稳定写接口的插件条目显示只读和“在原工具中编辑”，不显示无效Switch。

## 3. 领域合同与持久化

### 3.1 TimelineRecord（派生，不另存正文）

```ts
interface TimelineRecord {
  id: string; kind: 'mini' | 'diary' | 'volume';
  storyId: string; branchId: string | null;
  sourceId: string; // SummaryItem.id或messageId/candidateId/regex摘要
  range: { start: number; end: number } | null;
  anchor?: SourceRef;
  association: 'candidate-verified' | 'range-only' | 'detached' | 'stale';
  title: string; excerpt: string; sourceRevision: string;
}
interface TimelinePage {
  items: TimelineRecord[];
  nextCursor?: string; revision: string;
}
// listTimeline(scope, query, cursor, signal)
// readTimelineBody(id, expectedRevision)
// locateTimelineSource(id, expectedRevision)
```

时间线数据源原库唯一真源；源正文按需读，投影不存复制正文进memory。SummaryItem.bookId与当前故事关联按现有归档约定核验，branchId缺省仅主线。旧范围按当前故事/分支校验，rangeDetached/provenance不能作为目的地跳楼锚点。归档或分支删除后保留原记录管理入口，不误搬到当前分支。小总结候选切换重算，不用floor当长期身份。

已有组件正则设置抽到共享helper，保留localStorage现值和默认；范围设置扩展时才加story/branch override，不强制迁移全局用户偏好。长故事扫描分段/worker且可取消，初始40项，缓存只随相关revision失效，流式中不重扫。

### 3.2 FactDraft与提案

```ts
interface FactDraft {
  category: 'promise' | 'state' | 'event' | 'secret' | 'agreement';
  subject: { actorId?: string; label: string };
  body: string; // <=160 Unicode码点，最终仍写Markdown body
  audience: { kind: 'shared' } | { kind: 'actors'; actorIds: string[] };
  sourceRefs: SourceRef[];
}
interface FactProposal {
  id: string; scope: { storyId: string; branchId: string | null };
  inputDigest: string; sourceRefs: SourceRef[];
  status: 'pending' | 'accepted' | 'rejected' | 'stale';
  draft: FactDraft; replaces?: { path: string; expectedDigest: string };
}
// confirmFact({operationId, expectedDigest, draft})
// reviewProposal({id, expectedRevision, action, editedDraft?})
// selectFacts({scope, actorId, query, budget, policyVersion})
```

新确认事实沿`memory/<branchKey>/entries/<id>.md`和schema3 frontmatter；保留原body、sourceRefs、owner、revision/digest/enabled/deletedAt事务。未确认提案、提取水位及去重指纹位于`.ste-control/roleplay/<branchKey>/fact-proposals/`等受限路径，先由本地schema验证。策略版本、选择回执按原runtime-store存，桌面Vault与Web/Android IDB共用。

category/subject/audience/approval都进policyDigest，不能只校验body。多条“替代事实”提交以原journal原子停旧/加新；不直接外部写Markdown绕锁；不嵌套故事锁造成死锁。scope/vaultEpoch/selectionEpoch在读取、提交与发送前检查。

### 3.3 旧数据升级策略

| 对象 | 处理 | 禁止行为 |
| --- | --- | --- |
| 旧Batch 1 schema2 entries | 标legacy-excerpt，保全文/原控制/来源，暂停作为新事实注入 | 按字数推定事实、截断全文直接继续注入 |
| 旧原生Agent文件 | 按原记忆体系保留，标维护来源，仍受原有效性/禁用过滤 | 把所有文件停用或自动转新事实 |
| 原小总结/日记/章节记录 | 只读聚合，原库编辑 | 全量复制到memory或修改源聊天 |
| 提炼后的短事实 | 新ID、schema3、用户确认，链接旧来源 | 删除原摘录、自动带入旧隐私范围 |
| 新私密事实 | 新版支持actor/principal过滤；导出/继承按策略 | 老二进制回读同库仍宣称隔离 |

迁移需`migrationVersion`及before/after恢复证据，单故事/分支逐次执行，不扫描全库改写。先恢复旧prepared journal，再迁移并提交新标记；崩溃恢复必须校验expectedDigest，不因旧after-image把已停用/已删项复活。未完成迁移时读取层保守排除旧entries的新事实注入并提示；副作用发生在明确迁移操作，打开时间线仍只读。

新故事没有旧摘录就不显示迁移提示。用户“提炼”保存新事实后原摘录仍保留；“收录为总结/日记”沿record-capture指定区间，是否重复由用户确认，不自动搬所有历史。回退用升级前副本；完整备份、可分享包和迁移恢复记录区分处理。

## 4. 实施顺序与文件清单

路径均以仓库根为基准。以下步骤在本次文档任务中均未执行。

| 子步骤/退出条件 | 修改现有 | 拟新增 | 核心接口/验证 |
| --- | --- | --- | --- |
| 1A：双视图能读真实资料 | MemoryPanel.tsx、Roleplay.tsx、ChatWorkbench.tsx、MiniSummaryPanel.tsx | src/components/roleplay/MemoryTimeline.tsx；src/lib/roleplay/memory-timeline.ts；src/lib/mini-summary-settings.ts | listTimeline/readBody/locate；三源、分支、陈旧范围和跳楼 |
| 1B：事实合同与迁移 | src/lib/roleplay/memory.ts、memory-selection.ts、context-ledger.ts、agent-runtime.ts、tavern-host.ts | src/lib/roleplay/memory-facts.ts、memory-migration.ts | schema3、确认资格、policyDigest；迁移中断、旧journal/ledger、工具读取 |
| 1C：短事实抽屉与卡片 | MemoryCaptureSheet.tsx、memory.css、memory-capture.ts、MemoryPanel.tsx、ChatPreview.tsx、src/tavern/play-controls.js | 可选FactCard.tsx（拆分原卡片而非重复实现） | readMemoryCapture返回source与summarySuggestion；输入默认空；保存幂等 |
| 1D：后台候选提取 | src/lib/summary-engine.ts、summary-templates.ts、roleplay/agent-runtime.ts、tool-agent.ts、tavern-host.ts | src/lib/roleplay/fact-extraction.ts、fact-proposals.ts | 提示词侧段、输出验证、计数水位、pending审阅；无独立AI框架 |
| 1E：继承/分享/恢复 | src/lib/roleplay/branch-inheritance.ts、story-package.ts、runtime-store.ts、paths.ts（仅必要） | 无第二数据仓储 | 来源/Audience/提案/旧摘录的传播策略；完整备份不冒充分享 |
| 1F：交互与兼容验收 | src/test现有相关文件、scripts/smoke/playtest-20261106-memory-choices.mjs（保留旧证据） | 新memory-console相关测试、独立本批smoke脚本 | 新期望不能抹掉旧记录；标准/原文选项行为回归 |

1A只读适配可先单独体验；1B与1C一起交新写入路径，避免“UI说短事实、宿主仍接长摘录”；1D是本批小型后台任务，不拆成下一大批。1E必须在交付前完成，不能先让新schema分享后补过滤。

## 5. 选择、任务与错误处理

- 确认事实总预算建议384token、≤8条、硬上限768，所有STE事实入口共享；先过滤权限与有效性再相关性排序。无匹配可以0条，不为填满额度塞背景。
- 提取默认每5个成功采用assistant回合；自动维护已在工作时附侧段，未开维护才安排一次小调用，柏宝书接管不并行原生提取。
- 侧段最多6条，严格来源/短句验证；任务重入用source range＋digest去重，提案编辑/确认也带revision。任务失败不影响已保存主聊天，不自动修复重试。
- 来源失效/换候选时提案stale；旧事实仍按SourceRef有效性处理。手写固定约定可显式设固定，仍保留来源与适用branch，不能靠固定绕过audience。
- 新调用预算和取消接现有provider路径；不悄悄引入新的付费模型或把本地原文上传到未知端点。
- 用户停用事实时使索引、工具检索、Ledger及待发送准备失效；已发送请求不会改变。过程面板区分“允许用”“本轮用”和“未用原因”。
- 分支只继承分叉前来源有效事实；候选/提案默认不跨branch搬；旧摘录的暂停状态不能通过继承计划复活。
- 分享仅允许确认、有效、启用且可分享的当前事实；省略私密/未确认/已删除及含正文的日志/ledger/旧计划，需给出省略说明。公开聊天原文含秘密不能用事实过滤消除。

## 6. Vitest与真实入口验收

拟新增`src/test/roleplay-memory-timeline.test.ts`、`roleplay-memory-facts.test.ts`、`roleplay-fact-extraction.test.ts`、`memory-console.test.tsx`；现有memory/controls/context-ledger/agent-runtime/tavern-host/branch/story-package测试扩展。新增测试验证行为，不靠源码字符串或把主要仓储/组件mock掉通过。

| 验收场景 | 必须观察到的结果 |
| --- | --- |
| 同故事三种资料混合且重叠 | 时间线来源标签正确、楼层排序稳定，搜索可定位；打开无模型请求 |
| 不同branch、移动记录、孤立范围 | 不串branch、不误跳；range-only/detached/stale说明正确 |
| 正则改变/候选变更/4000楼 | 内容刷新，只处理需要的范围；可取消、不每token全扫描 |
| 空输入/普通小总结/过长小总结 | 空不可保存，短总结可引用，多事实需提炼；原楼全文从未默认进输入 |
| 手动一句话、secret对象 | schema3与来源保存，指定principal正确；未知角色不退公开 |
| 待确认/拒绝/来源变化 | 最终Prompt均不含这些候选；恢复/重开不自动接受 |
| schema2旧长摘录＋中途断写 | 全文可找回，暂停注入；重开恢复幂等，不从旧journal/branch复活 |
| 启停/编辑/删除＋旧Ledger | 下一次实际host请求已更新；工具search/read和缓存同样排除 |
| 维护者切换/已启柏宝书 | 不双维护；只读界面能力真实；不偷偷改插件内部数据 |
| 分享/完整备份 | 分享省略私密等所有载体，备份保原资料；列表说明准确 |
| 实际ST楼层与回顾入口 | 同事实仓储、来源跳楼、保存返回、草稿保留、单次提交 |
| 旧Quick Choices | 双击一次派发、slash为文本、草稿只追加、候选变化拒旧按钮 |

已知可运行命令（下列是未来验收清单，本轮未执行产品测试）：

```powershell
npx vitest run src/test/mini-summary.test.ts src/test/summary.test.ts src/test/record-capture.test.tsx src/test/roleplay-memory.test.ts src/test/roleplay-memory-controls.test.ts src/test/roleplay-context-ledger.test.ts src/test/roleplay-agent-runtime.test.ts src/test/roleplay-tavern-host.test.ts src/test/roleplay-branch-inheritance.test.ts src/test/roleplay-story-package.test.ts src/test/roleplay-choices.test.ts --maxWorkers=2
# 新文件创建后，定向运行上述拟新增4个测试文件。
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
npm run test:tavern-source
npm run test -- --maxWorkers=2
npm run build
```

ESLint只列本批实际修改TS/TSX路径。真实浏览器脚本运行本地模型夹具，覆盖1440×1000、390×844、390×460短视口，观察实际保存与请求体。先准备独立数据/服务入口，再跑脚本；不能只截图卡片就证明注入正确。

Windows WebView2再验Vault读写、迁移恢复；Android验键盘/IME、安全区、返回、后台恢复。人工检查四主题、卡片密度、两Tab易懂、44px热区、无横向溢出、失败时草稿仍在。未做的层明确记未验收。

## 7. 交付门槛与撤回

必须做到“看前情不增加token，记事实不复制长原文，开关真实控制新请求”，才能称Batch 1收尾完成。迁移、分享/继承和后台待确认链都属于此批。

回退UI可关闭新版中枢入口；schema读取/过滤仍保留，不能回滚到旧读者让暂停摘录重新注入。需要回旧二进制使用升级前副本。后续资料导出仅用明确的兼容副本，不降低当前库隐私合同。

交付附实际变更范围、界面截图、验证分层、模型/数据用途及未覆盖项，更新CURRENT和共享阅读档案。旧实现“测试通过”的历史保留，但新产品验收不得继承旧勾选。

