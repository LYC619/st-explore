# STE 角色扮演运行时实施路线

日期：2026-09-12。状态：方案已编写，实施未开始。

**Goal:** 在现有 STE 故事工作区实现普通聊天、主模型长历史＋工具 Agent 自动补资料、本地文件记忆，以及统一的常用扩展能力。

**Architecture:** 正文继续使用 ArchiveStory/ChatSession；聊天运行时掌管生成与提交，共享能力层供普通模式、工具 Agent 和兼容扩展调用。Agent 动态资料按回合冻结，记忆在当前采纳回复后增量保存。插件按能力和版本验收。

**Tech Stack:** React 18、TypeScript、现有 Provider 配置、Tauri 2/VaultFs、Vitest；Web/Android 通过存储与网络适配器共用领域逻辑。

设计依据：[总体设计](../specs/2026-09-12-ste-roleplay-runtime-design.md)。可直接执行的第一个独立包：[P0 契约与冻结前缀](./2026-09-12-ste-roleplay-runtime-p0.md)。

## 如何使用本路线

P0 是已写出具体代码、测试和命令的实施包。P1—P5 分属聊天、ST 解释器、记忆/Agent、扩展宿主和发布验证，以下给出每个项目的文件边界、交付行为、依赖和验收；各项目进入实现前根据前一阶段实际接口写出自己的逐步执行包。本路线不冒充所有子系统均已有可直接粘贴的完整实现。

首个对外完整版本需要 P0—P5 全部通过。P1 的普通聊天只是内部开发依赖，不代表把 Agent 推到首版之后，也不新增独立“AI 辅助按钮”来替代发送时自动工作。

本轮不安装依赖、不搭环境、不修改应用代码。执行从用户确认方案并要求开始后进行；工作区现有未提交修改不得纳入这些实施提交。

## 顺序与阶段出口

| 阶段 | 产物 | 依赖 | 出口证据 |
| --- | --- | --- | --- |
| P0 | 任务身份、来源失效、冻结消息契约 | 已审阅设计 | 纯契约测试与 TypeScript 检查 |
| P1 | 同源聊天与生成生命周期 | P0 | 发送/停止/重试/保存及切库隔离 |
| P2 | ST 普通模式解释器 | P1 | 固定 ST 样本的实际请求与状态变化对照 |
| P3 | 文件记忆和自动工具 Agent | P1、P2 共享能力 | 一次发送完成检索、正文与记忆更新 |
| P4 | 内置脚本/变量/渲染及柏宝书兼容 | P1、P2；与 P3 对齐维护归属 | API 契约、真实 WebView、指定插件功能矩阵 |
| P5 | 双模式发布门禁 | P0—P4 | 恢复、备份、性能、缓存与剧情效果记录 |

## P0：固定契约与回合前缀

- [ ] 执行配套 P0 实施包，创建 GenerationFence、MemorySourceRef、PromptMessage、ContextEpoch、FrozenTurn。
- [ ] 验证切库、分支修订、候选替换和前文变化会拒绝旧提交。
- [ ] 验证每轮输入和采纳回复形成不可变片段，下一轮保留已发送前缀。
- [ ] 输出小型、无 UI/网络/文件副作用的实现；不在本阶段引入 Agent 框架。

## P1：故事内生成与共享请求层

**创建：**

- src/lib/roleplay/controller.ts：生成状态机、任务身份、取消与一次提交。
- src/lib/roleplay/commit.ts：源 Repo 捕获、分支修订校验、增量正文提交。
- src/lib/roleplay/provider.ts：文本/工具模型共用的请求、事件与用量契约。
- src/lib/roleplay/providers/openai-compatible.ts：第一个实际 Provider 适配器。
- src/lib/roleplay/runtime-store.ts：运行记录和记忆的存储接口，定义平台实现边界。
- src/components/chat/ChatComposer.tsx：发送、停止、重试与草稿。
- src/components/chat/GenerationStatus.tsx：简短状态与按需详情。
- src/test/roleplay-controller.test.ts、src/test/roleplay-provider.test.ts、src/test/roleplay-commit.test.ts。

**修改：** src/types/archive.ts、src/pages/StoryWorkspace.tsx、src/components/chat/ChatWorkbench.tsx、src/components/ai-tools/useOpenAI.ts、src/components/ai-tools/api-profiles.ts、src/lib/archive-db.ts。

- [ ] 给故事增加可缺省的运行配置/引用；旧故事无需迁移即可继续阅读和编辑。
- [ ] 生成前 flush 当前编辑，捕获源库、分支和修订。仅影响模型输入的修改增加修订，阅读位置不增加。
- [ ] 用户消息保存一次，回复流显示在草稿；完成后通过 updateArchiveStory 提交到捕获的分支。拒绝把整份旧页面快照覆盖到仓储。
- [ ] Provider 返回文本增量、完整工具请求、usage、finish reason 和错误；旧 callOpenAI/callOpenAIMessages 保留 Promise<string> 包装签名。
- [ ] 配置继续引用现有 ApiProfile ID，主模型/工具模型可分别选择。明确区分需要 Key 的远端与允许无 Key 的本地端点；不把凭据写入故事文件。
- [ ] 停止和切换场景取消旧任务；测试迟到 chunk、保存失败、重复发送、同 ID 不同库。内存草稿不触发记忆。
- [ ] 保持生成前准备和生成后处理的入口，使 P3 直接接入发送流程；测试使用假模型实现，不把假 Agent 暴露为产品能力。
- [ ] 建立 2,000 楼固定样本的本地组装/渲染/读写基线，记录环境、数据大小和测量方式。

**验证命令：**

~~~powershell
npm test -- src/test/roleplay-controller.test.ts src/test/roleplay-provider.test.ts src/test/roleplay-commit.test.ts src/test/chat-edit.test.ts src/test/story-branch.test.ts --reporter=dot
npx tsc -p tsconfig.app.json --noEmit
~~~

预期：定向测试通过；切库/历史修改场景无错误提交；原有总结等文本调用不回归。真实 Provider 冒烟单独记录，不能用 mock 结果替代。

## P2：无 Agent 模式的 ST 行为

**创建：**

- src/lib/roleplay/context/classic.ts：普通模式的完整组装顺序。
- src/lib/roleplay/context/preset.ts：prompt_order、marker、示例与深度块。
- src/lib/roleplay/context/worldbook.ts：激活、递归、预算和位置。
- src/lib/roleplay/context/macros.ts：宏的阶段、作用域与展开。
- src/lib/roleplay/context/regex.ts：显示/发送阶段分离的规则执行。
- src/lib/roleplay/context/injections.ts：扩展槽位、once 生命周期、角色与深度。
- src/test/roleplay-classic.test.ts、src/test/roleplay-worldbook.test.ts、src/test/roleplay-injections.test.ts。
- src/test/fixtures/roleplay/st-1.18-context.json：标明来源、输入、预期请求和启用字段。

**修改：** src/types/worldbook.ts、src/lib/preset-parser.ts、src/lib/st-regex-interop.ts、src/components/chat/ChatComposer.tsx；只在确有运行需要时调整已有解析器，保留未知字段。

- [ ] 从可合法使用的 ST 1.18 基线取得小型行为样本；固定时间与随机种子，分别对照实际组装消息和状态变化。
- [ ] 支持单角色聊天的卡片、persona、情景、示例、历史和提示词排序。无 persona 资料时使用明确空值，不虚构默认人设。
- [ ] 对齐蓝灯/关键词、次级条件、扫描深度、大小写/全词、概率、组、持续/冷却/延迟、递归、预算和 outlet 行为。
- [ ] 核对世界书位置枚举与旧字符串来源，修正显示/解释层；数值原件原样保留，无法识别的旧格式要求明确转换，禁止静默批改存量。
- [ ] 正则按用户/助手、显示/提示词、深度等作用域运行；生成输入中的正则结果不覆盖原始正文。
- [ ] 扩展注入的 depth、role、scan、filter、once 正确处理；正常完成、取消、异常均清理该轮临时槽位。
- [ ] 对未实现的高级宏或预设字段给出准确的兼容报告。首版不标“完整 ST 兼容”，只发布已验证范围。

**验证命令：**

~~~powershell
npm test -- src/test/roleplay-classic.test.ts src/test/roleplay-worldbook.test.ts src/test/roleplay-injections.test.ts src/test/worldbook.test.ts src/test/preset.test.ts src/test/st-regex-interop.test.ts --reporter=dot
~~~

预期：固定样本组装结果与参照一致；无工具模型配置也能聊天。Agent 的蓝灯稳定前缀映射单独处理，不篡改普通模式的 ST 位置规则。

## P3：文件记忆与工具 Agent 自动运行

**创建：**

- src/lib/roleplay/memory/types.ts、files.ts：可读文档与来源模型。
- src/lib/roleplay/memory/store.ts、journal.ts：增量写入、幂等恢复与冲突检查。
- src/lib/roleplay/memory/index.ts、search.ts：可重建目录、关键词与原文定位。
- src/lib/roleplay/memory/invalidation.ts：候选/编辑/分支变化的失效与重算范围。
- src/lib/roleplay/memory/maintenance.ts：回复采纳后的提取、更新与维护屏障。
- src/lib/roleplay/memory/vault-store.ts、browser-store.ts：相同逻辑文件的持久化适配。
- src/lib/roleplay/agent/engine.ts、tools.ts、prepare.ts：有界工具循环、工具集合和本轮资料。
- src/lib/roleplay/context/agent.ts：初始资料、冻结回合和 Provider 组装。
- src/lib/roleplay/worldbook-versions.ts：分支内设定版本及接受状态。
- src/components/chat/MemoryPanel.tsx、ContextPreview.tsx：来源查看、编辑与本轮资料预览。
- src/test/roleplay-memory.test.ts、roleplay-memory-recovery.test.ts、roleplay-agent.test.ts、roleplay-context-cache.test.ts。

**修改：** P1 运行时接入点、src/lib/vault/vault-backend.ts、src/lib/vault/fs.ts、现有备份入口及资产接受流程；需要新增 Rust 命令时限定为文件/网络能力，不在后端复制 Agent 状态机。

- [ ] 用 MemoryStore 接口实现 Vault 文件版本与浏览器逻辑文件；文件正文可读，索引不是唯一真源。
- [ ] 使用 prepared/committed 增量日志与现有故事队列，避免嵌套进入同一队列导致死锁。文件变更与正文修订核对在同一次排队操作内完成。
- [ ] 覆盖“正文已保存但记忆未写”“部分文件已写”“日志未标完成”的恢复；以操作 ID 消除重复写入。
- [ ] 建立人物、事件、当前状态、未了结线索、文风/范例文件；保留来源和角色知识，建议与事实分开。
- [ ] 对候选切换/正文编辑按最早失效来源重建后续自动记忆；手工笔记保留并标记冲突。外部文件编辑通过内容摘要和 revision 检查纳入。
- [ ] 在实施工作区验证 Pi 等候选包的浏览器依赖、工具往返、取消和 Provider 适配；按设计第 4.3 节的规则决定采用或实现最小有界循环，并记录锁定版本与依据。
- [ ] 工具提供目录/搜索/读取原文、读取世界书和记忆更新能力。生成前只读；生成后提交带来源增量。工具模型缺资料时能继续调用，而非固定一次摘要请求。
- [ ] 主模型只接收本轮资料和叙事提醒；主模型禁用 tools 时测试仍通过。最近上下文窗口和预算是可配置参数。
- [ ] 同一上下文周期保存初始快照和回合片段；在 Provider 映射之后测试真实消息前缀。编辑/切模型/深度注入等改变产生可解释的新周期。
- [ ] 世界书版本草稿支持预览接受；变更仅作用当前分支和生效位置，原件不被自动覆盖。
- [ ] 支持下一轮等待记忆维护；失败时用最后一致版本＋未归档近期原文继续，并给出重试状态。

**验证命令：**

~~~powershell
npm test -- src/test/roleplay-memory.test.ts src/test/roleplay-memory-recovery.test.ts src/test/roleplay-agent.test.ts src/test/roleplay-context-cache.test.ts --reporter=dot
~~~

**真实场景：** 用户返回客栈 → 自动查到地点原文和三十楼前的约定 → 主模型续写 → 物品/伏笔按选中回复更新；切换成另一候选后旧结果失效。仅此流程通过后才标记 Agent 基本能力完成。

## P4：统一扩展能力与柏宝书样板

**创建：**

- src/lib/extensions/host.ts、capabilities.ts、events.ts：单一宿主、能力范围和有序事件。
- src/lib/extensions/variables.ts、generation.ts、injections.ts：共享操作封装。
- src/lib/extensions/script-runtime.ts、bridge.ts、lifecycle.ts：运行区、通信与清理。
- src/lib/extensions/compat/tavern-helper.ts、sillytavern-context.ts、baibai.ts：有范围的兼容适配。
- src/components/chat/MessageContent.tsx、ScriptFrame.tsx：静态内容与动态代码块出口。
- src/components/settings/ExtensionCapabilities.tsx：已启用能力、插件版本与不兼容项。
- docs/principles/extension-compatibility.md：实际验证矩阵。
- src/test/extension-host.test.ts、extension-lifecycle.test.ts、baibai-compat.test.ts。

**修改：** src/components/chat/ChatPreview.tsx、P1 的运行事件、P2 的注入槽与 P3 的记忆归属策略。

- [ ] 统一消息、变量、世界书、生成和注入能力；内置功能、工具 Agent、兼容插件共用实现。
- [ ] 原生界面继续由 React 管理；兼容插件的局部 UI 放在明确挂载区，动态内容由虚拟列表授予挂载/释放。
- [ ] 实现脚本作用域快照和持久化屏障，保留选定公共 API 的同步/异步语义。只有具名、已测试的函数声明兼容。
- [ ] 一次性注入、可等待事件、取消、脚本卸载、切库都能完整清理；重复渲染楼层不重新触发记忆提取。
- [ ] 区分 dialogue 与 utility 请求来源；generateRaw 不递归进入工具 Agent 的角色生成流程。
- [ ] 优先支持变量/状态面板、消息操作、事件、基础宏和常用斜杠命令；高级 STscript、任意父 DOM 操作和 Node 后端插件不计入本阶段兼容。
- [ ] 在合法取得的固定柏宝书包上验证自动摘要、台账、隐藏、注入、swipe、编辑及导出往返；向量功能明确为未支持，记录缺少的服务器接口。
- [ ] 建立 native-agent/baibai/none 自动记忆归属，验证切换后不双重总结或重复改历史。
- [ ] 酒馆助手 AFPL 与柏宝书授权未澄清前，发布包使用 STE 自有能力实现及接口适配；原码改造/打包作为独立来源审查事项，不通过复制 dist 绕过。

**验证：**

~~~powershell
npm test -- src/test/extension-host.test.ts src/test/extension-lifecycle.test.ts src/test/baibai-compat.test.ts --reporter=dot
~~~

随后在真实 WebView 中运行指定脚本、切换 50 次楼层/故事，检查监听器、iframe、计时器和变量状态；验证导入包的运行结果。jsdom 通过不能替代这一项。

## P5：首个完整发布

**创建：** docs/verification/ste-roleplay-runtime-v1.md；记录每项场景的数据、环境、实际结果和未通过原因。

- [ ] 完整备份涵盖正文、记忆、版本与必要运行记录；ST JSONL 导出保持自身范围。
- [ ] 两种模式共享编辑、swipe、分支和导入导出；旧故事读写不丢未知字段。
- [ ] 同样剧情分别测普通模式、Agent 模式和柏宝书模式，记录事实遗漏、角色知情越界、文风、伏笔和延迟。
- [ ] 连续三轮比较最终请求前缀与 Provider 缓存回报；不支持统计的服务标明未知。
- [ ] 检查工具上下文随历史增长仍受预算约束；未全量重复读取/向量化整个故事。
- [ ] 检查 2,000 楼样本的虚拟化、动态内容数量、50 次切换清理，以及流式期间写盘次数。
- [ ] 执行重启恢复、磁盘写入失败、外部 memory 编辑、历史修改、切库和迟到返回场景。
- [ ] 完成第三方来源记录、许可证与署名；发布兼容矩阵，按实际验证结果标注版本和功能。

**发布检查命令（执行阶段运行）：**

~~~powershell
node scripts/sync-version.mjs --check
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
npm run lint
npm test -- --reporter=dot
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
~~~

触及桌面命令、权限或 iframe 时执行 Tauri 实机冒烟；触及 Android 适配时构建并在 Android 验证。缺少对应环境时该平台标为未验收，不能用其他平台结果代替。文档规划阶段不运行这些构建。

## 需求覆盖

| 需求 | 实施阶段 | 验收 |
| --- | --- | --- |
| R01、R02、R10 | P0、P1、P3、P5 | A01、A02、A10 |
| R03、R04 | P0、P3、P5 | A02、A03 |
| R05、R06、R09、R12 | P3、P5 | A04、A05、A10、A11、A12 |
| R07、R08 | P2、P3 | A04、A06、A07 |
| R11、R14 | P4、P5 | A08、A09 |
| R13 | P1、P3、P4、P5 | A05、A09、A10 |

## 本轮交付自查

- 方案以用户已确认的主模型/工具 Agent 分工为中心，旧作废方案未复用。
- 未把“无 Agent”当作任意 ST 插件天然可运行的承诺。
- 直接集成的价值落实到共用调度、存储、事件和渲染生命周期，性能增益仍需测量。
- 文件记忆的来源、修订、恢复、手工编辑和平台差异有具体处理。
- 当前状态为方案交付，P0—P5 均未执行。
