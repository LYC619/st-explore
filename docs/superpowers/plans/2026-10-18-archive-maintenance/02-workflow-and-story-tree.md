# B：归档操作与故事树 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `executing-plans`。先完成 A 的持久化基础；本批每个入口都要走真实页面。

**Goal:** 减少归档过程中的重复配置、复制粘贴、切页和成果搬运。

**Architecture:** 在现有详情/处理/世界书页面补直接操作，复用已有仓储和生成组件；不建立全局 Agent、不自动语义分卷、不改整体阅读布局。

**Tech Stack:** React/TypeScript、现有 ST 宿主桥、IndexedDB/VaultFs、Vitest/Playwright。

## 执行状态（2026-10-19）

B1–B6 实现与自动化已完成；B/C 稳定浏览器批次 11 条通过，最终审查后补验复制、收录和树完整请求。U04 已记录类型/排序保留、返回滚动 631→0，未扩大字体/阅读改版。完整用户多卷资料→真实 ST 回导仍未覆盖，保留对应复选框。详见 [验证记录](../../../verification/2026-10-18-archive-maintenance.md)。

## B1. 批量设置类型与全文悬浮（U01/U02）

**修改：** `src/pages/Library.tsx`、`src/components/library/LibraryToolbar.tsx`、`src/components/library/TagManagerDialog.tsx`、`src/components/character/StoryRecordsView.tsx`。
**测试：** 扩展 `src/test/library-batch-selection.test.tsx`；新增 `src/test/character-record-actions.test.tsx`；浏览器脚本 `tests/roleplay/archive-workflow.spec.ts`（本批新建）。

- [x] 从角色库“批量管理”选三张卡，进入实际操作菜单；核对类型入口、选择范围、筛选后选择语义，不能只渲染独立 TagManagerDialog。
- [x] 在批量操作内提供可发现的“设置类型”，复用已存在的写入逻辑；显示受影响的已选数量，类型作为类型字段更新，不添加同名字标签；保存时重新读取角色避免覆盖其他字段。
- [x] 保存失败保留选择并说明成功/失败项；更改导致卡离开当前类型筛选时更新列表/数量，未选卡完全不变。关闭重开与切库后验证。
- [x] 移除总结/日记正文容器的全文 title，以及由上层生成的同类全文 tooltip；保留标题截断所需的简短提示、点击展开和复制。
- [x] 用真实页面悬停 1 秒后截图/检查，再点击展开、复制并切故事返回；这一低风险样式变化不必写字符串镜像测试。

**命令：** `npx vitest run src/test/library-batch-selection.test.tsx src/test/library-facet-counts.test.ts src/test/character-record-actions.test.tsx --reporter=dot`。

## B2. 输入、范围、隐藏与 UID 操作（U06）

**修改：** `src/components/chat/RegexDepthEditor.tsx`、`RegexQuickAdd.tsx`、`RegexSidebar.tsx`、`ChatWorkbench.tsx`、`ChatPreview.tsx`、`src/components/worldbook/EntryEditor.tsx`、`src/hooks/use-entry-filters.ts`、`src/components/worldbook/EntryFilterBar.tsx`。原 ST 隐藏样式按复现入口检查 `src/tavern/host-bootstrap.js` 及其样式覆盖，不改固定上游源码。
**测试：** `src/test/regex-depth-editor.test.tsx`、`regex-depth-integration.test.tsx`、`worldbook-entry-identity.test.tsx`；新增 `src/test/chat-hidden-batch.test.tsx`。

- [x] 数字输入采用字符串草稿，允许空串和输入过程；只有完整有效整数才更新业务值。失焦/Enter 提交有效值，空串失焦恢复上一有效值（范围“不限”字段沿用其原本空值含义）。不得用 Number('') 造成 0/1 抢填。
- [x] 最近 N 楼验证 N≥1；最小/最大深度保留现有 -1/null 语义。切换规则/模式时同步正确草稿，不把上一条输入带到下一条。
- [x] 快速添加里可直接选择全部/最近 N 楼/最近 N 楼以外，创建时同时写 minDepth/maxDepth；默认仍全部，本次“20”不是全局固定默认。沿用现有规则集保存/载入。
- [x] UID 用同样可编辑草稿，在有效完成输入（失焦/Enter）后自动应用并进入 A2 保存队列，移除单独“应用 UID”。空值、负数、占用 UID 保留提示，不跳到另一条目、不自动改为 0。
- [x] 世界书新会话默认 UID 升序；保留 UID 降序，记住用户最后一次选择。只改显示排序，不改注入 order/displayIndex 或实际 UID。
- [x] 在用户实际阅读入口取消隐藏正文的整体透明度/暗色，改为清晰的小标记。保留“是否显示隐藏楼层”的开关语义。
- [x] 增加“按范围设为隐藏/取消隐藏”和“取消全部手动隐藏”；一次落库，不逐楼触发保存。排除 OOC/系统消息；不可把“显示隐藏楼层”误当“取消隐藏”。
- [x] 柏宝书/原生记忆正在管理的隐藏不当作手动标记批量清除；通过现有维护归属操作协调，分别验证手动隐藏与插件隐藏。避免取消后下一轮插件立刻改回但界面显示成功。
- [x] 对长故事测试范围边界、主线/分支隔离、读写失败和刷新恢复；实际发给模型的 is_system/隐藏语义保持一致。

**具体输入回归：** 原 N=1 → 全选删除 → 输入框应为空且无业务写入 → 输入 50 → 提交后 older 的 minDepth=50、maxDepth=null；recent 对应 maxDepth=49。再测试中文输入法、粘贴、切换规则和空串失焦恢复。

**命令：** `npx vitest run src/test/regex-depth-editor.test.tsx src/test/regex-depth-integration.test.tsx src/test/worldbook-entry-identity.test.tsx src/test/worldbook-uid.test.ts src/test/chat-hidden-batch.test.tsx --reporter=dot`。

## B3. 详情页同角色故事间移动总结、日记、树（U05）

**修改：** `src/components/character/StoryRecordsView.tsx`、`src/lib/story-maintenance.ts`、`src/types/story-tree.ts`、`src/lib/story-tree-db.ts`。
**新增：** `src/components/character/MoveStoryRecordDialog.tsx`；扩展 `src/test/story-maintenance.test.ts`、`src/test/character-record-actions.test.tsx`。
**复用：** 现有 `moveSummaryToStory`、`src/components/organize/MoveRecordDialog.tsx` 的验证/加载模式，不移除处理区已有入口。

- [x] 每条总结/日记/树在详情页有“移动到其他故事”。目标仅列当前角色的其他故事，先选目标故事，再选主线或该目标的具体分支；禁止保留原故事 branchId。
- [x] 总结/日记复用已有移动服务，加可选同角色约束并在提交时重读验证；旧处理区允许的范围不被此新入口无意改变。
- [x] 实现 `moveStoryTreeToStory(treeId, targetStoryId, targetBranchId?)`：捕获 epoch，按稳定顺序取得源/目标故事锁，重读记录、目标及分支，更新 bookId/bookTitle/branchId，保存来源信息。树节点 ID/内容保持不变，移动不是重新生成。
- [x] 树存储增加与总结同等的并发保护；重复提交不会产生第二条，目标删除/改归属/切库时保留原成果。Vault 路径迁移的旧文件不得被扫描再恢复成重复树。
- [x] 移动成功后源列表消失、目标列表出现，数量同步；在目标故事展开正文/树并刷新验证。来源范围保持来源含义，未重新绑定不能跳到错误楼层。
- [x] 验收同角色双故事、不同分支、目标无分支、目标删除、保存失败、重复点击、重启；另核对 A4 的副本不串数据。

**命令：** `npx vitest run src/test/story-maintenance.test.ts src/test/move-record-dialog.test.tsx src/test/character-record-actions.test.tsx --reporter=dot`。

## B4. 直接收录与批量写世界书

**修改：** `src/components/chat/ChatWorkbench.tsx`、`ChatPreview.tsx`、`src/components/character/StoryRecordsView.tsx`、`src/lib/summary-factory.ts`、`src/types/summary.ts`、`src/lib/worldbook-entry-copy.ts`。
**新增：** `src/components/summary/CaptureRecordDialog.tsx`、`src/components/summary/RecordsToWorldbookDialog.tsx`、`src/lib/record-to-worldbook.ts`、`src/test/record-capture.test.tsx`、`src/test/record-to-worldbook.test.ts`。
原 ST 直接收录入口需要时修改 `src/tavern/host-bootstrap.js`、`src/lib/roleplay/tavern-host.ts` 并更新接入校验；不编辑生成产物或 `_reference`。

- [x] 处理区消息操作增加“收录为总结/日记”，支持选中正文片段或整条消息；预填故事/分支、来源消息和楼层，内容可修剪。卷号及日记人物可填写，日记人物不默认为角色卡唯一角色。
- [x] 继续聊天生成的内容先保存到同一故事，再按稳定消息 ID 走同一收录服务；若直接加原 ST 消息菜单，宿主桥验证当前故事/分支和来源，不能仅信前端传来的标题/数字楼层。
- [x] 调整手动记录工厂以接收明确范围及来源（旧调用仍可用）；生成所在楼层与“总结覆盖的正文范围”是两个字段含义，不自动把总结自身的楼号当覆盖范围。
- [x] 弹窗提供“保存并继续添加”，保留同故事上下文，清掉上一条正文；支持既有总结的多篇连续粘贴。双击保存和失败重试不重复创建。
- [x] 详情页总结/日记支持多选“加入世界书”。选择当前角色已有世界书、新建角色专用书或明确目标；一篇记录默认一个条目，标题包含卷次/日记人物，先预览再一次写入。
- [x] 复用 UID 分配与世界书持久化，不在 UI 手写 entries 字典键；保存完成自动更新当前引用，避免“已加入但未保存”。条目启用方式在批次预览中明确，默认禁用待用户启用，不把 1.5 万 token 全部静默设为常驻。
- [x] 记录来源关联（记录 ID/版本/目标书/UID）。同一记录再次操作显示已存在，可选更新对应条目或另存；重复点击不是重复条目。只在全部目标可提交后写入，失败保留选择与错误。
- [x] 世界书编辑器已有未保存草稿时先统一 flush/版本检查，批量写入不能覆盖尚未提交的手工条目，也不能被之后的旧草稿反向覆盖。
- [ ] 真实流程：第一卷复用、后面三卷连续收录 → 详情页可读 → 批量写书 → 自动保存 → A3 导卡 → ST 中可见条目。

**用例数据：** 第一卷总结 1 篇、同卷两名人物日记、第二卷总结 1 篇；同标题不同 ID 不混淆；UID 原已有 0/2/50；重复提交、目标切换与同名目标书覆盖测试。

**命令：** `npx vitest run src/test/record-capture.test.tsx src/test/record-to-worldbook.test.ts src/test/summary-manual.test.ts src/test/worldbook-entry-copy.test.ts --reporter=dot`。

## B5. 故事树生成上下文与详情预览

**修改：** `src/components/story-tree/AIFillDialog.tsx`、`StoryNodeEditor.tsx`、`src/lib/story-tree-ai.ts`、`src/components/organize/TreeWorkbench.tsx`、`StoryTreeWorkspace.tsx`、`OrganizePanel.tsx`、`src/components/character/StoryRecordsView.tsx`。
**新增：** `src/components/character/StoryTreePreview.tsx`、`src/test/story-tree-context.test.tsx`；扩展 `src/test/story-tree-ai.test.ts`。

- [x] 生成弹窗显式接收 storyId/branchId，不能依赖当前全局 session pointer 决定卷号和成果归属。
- [x] 复用现有预设/世界书选择组件以及 summary-engine 的组装能力，加入“参考总结/日记”选择；只列当前故事对应分支，额外跨范围引用由用户显式选择。日记标记人物视角，旧总结是参考，正文用于事实核对。
- [x] 模板仍要求树操作 JSON；预设/系统提示/输出格式各有明确位置，显示最终请求预览与长度估算。拒绝回答、无效 JSON、空有效操作、网络错误分别提示并保留原输出；不承诺某预设保证不拒绝。
- [x] 输入可选原文或该故事的正则处理结果；仅生成输入变化，不应用到原文、不创建副本。保存目标始终是选定主故事/分支；显示实际规则与范围。
- [x] 详情页以可点击卡片/剧情时间线配合大纲查看，复用 `StoryCardView.tsx`、`StoryTimeline.tsx`、`StoryTreeView.tsx`；正文在选中后可完整阅读，不用全文 title 补阅读。
- [x] `StoryNodeEditor` 的“分卷”改为“分段阅读”或“按卷查看”，仅有已有小节时展示；清楚标记选中状态，解释不会自动划卷。切节点时重置合适视图，不遗留上一节点状态。
- [x] 用有卷号、无卷号、空树、多角色多事件及长正文验证；选中记录改变、切故事、移动树后旧请求不能写入新目标。

**命令：** `npx vitest run src/test/story-tree-ai.test.ts src/test/story-tree-context.test.tsx src/test/story-tree-workspace.test.tsx src/test/summary-engine.test.ts --reporter=dot`。

## B6. 收尾减负与本批出口

- [x] 找到故事单独评分的所有常用显示/编辑入口，只移除重复评分 UI；保留旧字段、导入导出与排序兼容，不做批量清空。角色评分正常保存、筛选。
- [x] U04 只记录角色详情→阅读→返回的字号/空间/滚动/返回位置现象和截图；本批不实施字体/阅读设置。若发现已明确操作造成的返回状态缺陷，记录可复现步骤，避免自行扩大设计。
- [x] 核对角色库类型/按评分排序/滚动位置在进出角色后是否恢复。已通过则记验证，不新增“归档完成状态”或强制所有成果生成。
- [x] `npx playwright test --config=playwright.roleplay.config.ts archive-workflow.spec.ts`，覆盖 B1–B5 真实入口；原 ST 菜单改动另跑 `npm run test:tavern-source` 和 `npm run tavern:verify`。
- [x] 运行总计划类型/构建检查，更新验证记录。新文字、按钮、空态和处理区返回路径统一核对。
