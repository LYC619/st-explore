# STE 角色扮演运行时实施路线

日期：2026-09-12。状态：已按原始 ST/TauriTavern 前端路线修订，实施未开始。

**Goal:** 在 SillyTavern 原始游玩界面上接入 STE 的角色库、故事与文件记忆，优先复用 TauriTavern，提供普通聊天和主模型长历史＋工具 Agent 自动补资料两种模式。

**Architecture:** 上游 ST 前端保留真实模块、DOM、canonical chat[] 和扩展上下文；宿主适配将存储、连接配置和模型请求接到 STE。正文继续使用 ArchiveStory/ChatSession，经同一提交入口保存。普通模式复用上游组装，Agent 在同一发送流程准备冻结资料并于保存后维护记忆。插件按能力和版本验收。

**Tech Stack:** ST/TauriTavern 原始前端模块与既有渲染器；STE 的 TypeScript、Provider 配置、Tauri 2/VaultFs 和现有管理功能。原项目 React 组件不再承担重建游玩 UI。上游构建入口、依赖边界及 Web/Capacitor Android 适配在 P0 固定，当前不修改工具链。

设计依据：[总体设计](../specs/2026-09-12-ste-roleplay-runtime-design.md)。[旧 P0 契约与冻结前缀](./2026-09-12-ste-roleplay-runtime-p0.md) 已退出执行入口，只保留为来源守卫和缓存测试思路的参考。

## 如何使用本路线

P0 先固定真实上游与 STE 的接入契约，再重写首个执行包。P1—P5 分属原始前端接入、普通模式校验、记忆/Agent、扩展整合和发布验证。下列新文件是职责位置建议，上游实际路径按锁定版本保留；进入每个阶段前按真实接口写出逐步执行包，不将旧计划的代码片段直接套入新路线。

首个对外完整版本需要 P0—P5 全部通过。P1 的普通聊天只是内部开发依赖，不代表把 Agent 推到首版之后，也不新增独立“AI 辅助按钮”来替代发送时自动工作。

本轮不安装依赖、不搭环境、不修改应用代码。执行从用户确认方案并要求开始后进行；工作区现有未提交修改不得纳入这些实施提交。

## 顺序与阶段出口

| 阶段 | 产物 | 依赖 | 出口证据 |
| --- | --- | --- | --- |
| P0 | 上游版本、复用范围、数据/事件/请求契约与新版首包 | 本轮确认的前端方向 | 来源清单、接口映射、数据权威和平台边界明确 |
| P1 | 原始 ST 界面接入 STE 的同源故事与生成生命周期 | P0 | 原有分区可操作，发送/停止/重试/保存及切库隔离 |
| P2 | 复用的 ST 普通模式行为与资产互操作 | P1 | 固定 ST 样本的实际请求与状态变化对照 |
| P3 | 文件记忆和自动工具 Agent | P1、P2 共享能力 | 一次发送完成检索、正文与记忆更新 |
| P4 | 内置脚本/变量/渲染及柏宝书兼容 | P1、P2；与 P3 对齐维护归属 | API 契约、真实 WebView、指定插件功能矩阵 |
| P5 | 双模式发布门禁 | P0—P4 | 恢复、备份、性能、缓存与剧情效果记录 |

## P0：固定原始前端复用与接入边界

- [ ] 锁定实际复用的 TauriTavern 提交、对应 ST 版本、前端与宿主文件范围、依赖和许可。现有参考副本只作核对资料，不直接当作已锁定版本。
- [ ] 按真实启动链、角色/聊天/设置/资源/模型路由列出 STE 接入表，确定前端打包与 Web、Tauri、Capacitor Android 各自的能力边界。
- [ ] 明确 ST chat[]/metadata/候选与 STE Story/Branch/Message ID 的映射；只保留一个持久化正文来源、一个保存队列和一套连接凭据。
- [ ] 核对发送前组装、流式增量、停止、swipe、编辑、保存完成和插件事件的接入点；明确 Agent 何时准备资料及何时允许写记忆。
- [ ] 记录上游真实 API、公共 DOM/模块和渲染生命周期，保留熟悉的分区与操作；STE 增强按原入口逐块接入。
- [ ] 据此重写首个实施包；旧 GenerationFence、MemorySourceRef、ContextEpoch、FrozenTurn 等概念按实际接口取舍，不强制保留旧文件结构。

本阶段当前为设计核对。运行构建、安装依赖及验证适配代码属于用户要求开始实现后的工作；不能以完成本文修订声称已经接通前端。

## P1：原始 ST 游玩界面与 STE 数据接通

**创建：**

- src/lib/roleplay/controller.ts：生成状态机、任务身份、取消与一次提交。
- src/lib/roleplay/commit.ts：源 Repo 捕获、分支修订校验、增量正文提交。
- src/lib/roleplay/provider.ts：文本/工具模型共用的请求、事件与用量契约。
- src/lib/roleplay/providers/openai-compatible.ts：第一个实际 Provider 适配器。
- src/lib/roleplay/runtime-store.ts：运行记录和记忆的存储接口，定义平台实现边界。
- src/lib/roleplay/host/：ST 宿主路由、角色/故事/候选身份、设置与保存适配；具体文件按 P0 接口表拆分。
- 锁定的上游前端及集中维护的 STE 接入模块：沿用发送器、抽屉、消息操作和状态显示，不新建 React ChatComposer。
- src/test/roleplay-controller.test.ts、src/test/roleplay-provider.test.ts、src/test/roleplay-commit.test.ts。

**修改：** 上游启动和宿主请求接入点；STE 的 src/types/archive.ts、src/pages/StoryWorkspace.tsx、src/components/ai-tools/useOpenAI.ts、src/components/ai-tools/api-profiles.ts、src/lib/archive-db.ts。原 ChatWorkbench 保留既有管理/阅读职责，调整入口衔接，不扩大为第二套游玩运行时。

- [ ] 给故事增加可缺省的运行配置/引用；旧故事无需迁移即可继续阅读和编辑。
- [ ] 保留 ST 原始分区和真实模块，角色列表、聊天列表、预设/世界书编辑、连接设置读取同一 STE 资产；验证返回管理界面后的数据一致性。
- [ ] 生成前 flush 当前编辑，捕获源库、分支和修订。仅影响模型输入的修改增加修订，阅读位置不增加。
- [ ] 上游 canonical chat[] 保持完整消息和插件元数据；发送、swipe 与自动保存经身份映射进入同一队列。完成后通过 updateArchiveStory 提交到捕获的分支，不运行另一套正文仓储或双向同步。
- [ ] Provider 返回文本增量、完整工具请求、usage、finish reason 和错误；旧 callOpenAI/callOpenAIMessages 保留 Promise<string> 包装签名。
- [ ] 配置继续引用现有 ApiProfile ID，主模型/工具模型可分别选择。明确区分需要 Key 的远端与允许无 Key 的本地端点；不把凭据写入故事文件。
- [ ] 停止和切换场景取消旧任务；测试迟到 chunk、保存失败、重复发送、同 ID 不同库。内存草稿不触发记忆。
- [ ] 在真实上游生命周期中验证生成前准备和保存后处理入口，使 P3 自动接入发送流程；一次请求只由一个控制器推进状态，不让 ST 和 STE 各生成/提交一次。
- [ ] 按 P0 重写并验证切库、分支修订、候选身份、历史摘要和冻结回合守卫。直接修改 chat[] 的扩展也必须在发送/提交前被来源检查发现。
- [ ] 建立 2,000 楼固定样本的本地组装/渲染/读写基线，记录环境、数据大小和测量方式。

**STE 侧候选验证命令（具体测试清单在新版实施包固定）：**

~~~powershell
npm test -- src/test/roleplay-controller.test.ts src/test/roleplay-provider.test.ts src/test/roleplay-commit.test.ts src/test/chat-edit.test.ts src/test/story-branch.test.ts --reporter=dot
npx tsc -p tsconfig.app.json --noEmit
~~~

预期：定向测试通过；切库/历史修改场景无错误提交；原有总结等文本调用不回归。真实 Provider 冒烟单独记录，不能用 mock 结果替代。

另运行锁定上游版本所要求的前端构建/契约检查，以及真实原始界面的发送、停止、候选、编辑和保存冒烟；仅有 STE 侧单测不能证明原始前端已经可用。

## P2：复用上游普通模式并核对 ST 行为

**创建：**

- src/lib/roleplay/context/classic-adapter.ts：接入上游普通模式组装与最终请求记录，避免另写同功能解释器。
- src/lib/roleplay/host/asset-interop.ts：STE 卡片、预设、世界书、正则与上游所需数据的映射，保留未知字段。
- 普通模式的预设、世界书、宏、正则和扩展槽位沿用锁定的上游实现；STE 专属差异集中在适配层。
- src/test/roleplay-classic.test.ts、src/test/roleplay-worldbook.test.ts、src/test/roleplay-injections.test.ts。
- src/test/fixtures/roleplay/st-1.18-context.json：标明来源、输入、预期请求和启用字段。

**修改：** src/types/worldbook.ts、src/lib/preset-parser.ts、src/lib/st-regex-interop.ts 及上游宿主资产接入点；只在确有运行需要时调整已有解析器，保留未知字段。

- [ ] 从可合法使用的 ST 1.18 基线取得小型行为样本；固定时间与随机种子，分别对照实际组装消息和状态变化。
- [ ] 支持单角色聊天的卡片、persona、情景、示例、历史和提示词排序。无 persona 资料时使用明确空值，不虚构默认人设。
- [ ] 对齐蓝灯/关键词、次级条件、扫描深度、大小写/全词、概率、组、持续/冷却/延迟、递归、预算和 outlet 行为。
- [ ] 核对世界书位置枚举与旧字符串来源，修正显示/解释层；数值原件原样保留，无法识别的旧格式要求明确转换，禁止静默批改存量。
- [ ] 正则按用户/助手、显示/提示词、深度等作用域运行；生成输入中的正则结果不覆盖原始正文。
- [ ] 扩展注入的 depth、role、scan、filter、once 正确处理；正常完成、取消、异常均清理该轮临时槽位。
- [ ] 对继承后仍缺少宿主支持的宏、预设字段或后端能力给出准确兼容报告；已经由上游提供的功能优先保留，发布范围以实测为准。

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
- 上游聊天/扩展抽屉中的记忆与本轮资料面板：沿用原有入口风格，提供来源查看、修正和文风规则，不新建独立 Agent 工作台。
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

- src/lib/extensions/host-adapter.ts、capabilities.ts：接入真实 ST 扩展环境的宿主能力，保留公共事件语义。
- src/lib/extensions/variables.ts、generation.ts、injections.ts：调用既有执行路径并接入 STE 的持久化、请求来源和模式约束。
- src/lib/extensions/bridge.ts、lifecycle.ts：整合上游运行区、通信和清理；不另造全套 ST 模块或 getContext。
- src/lib/extensions/compat/tavern-helper.ts、baibai.ts：经接口核对后仍有必要的能力适配。
- 上游扩展设置与聊天渲染接入点：展示已启用能力、插件版本和不兼容项，复用实际消息与 iframe 管理。
- docs/principles/extension-compatibility.md：实际验证矩阵。
- src/test/extension-host.test.ts、extension-lifecycle.test.ts、baibai-compat.test.ts。

**修改：** 锁定的上游扩展加载/渲染宿主边界、P1 的运行事件、P2 的注入接入与 P3 的记忆归属策略。归档阅读器 ChatPreview 不承担游玩插件宿主。

- [ ] 统一消息、变量、世界书、生成和注入能力；内置功能、工具 Agent、兼容插件共用实现。
- [ ] 游玩界面由继承后的上游前端管理；保留插件使用的真实 DOM/模块和约定的挂载生命周期。新增 STE 面板不得与上游同时拥有同一段聊天 DOM。
- [ ] 实现脚本作用域快照和持久化屏障，保留选定公共 API 的同步/异步语义。只有具名、已测试的函数声明兼容。
- [ ] 一次性注入、可等待事件、取消、脚本卸载、切库都能完整清理；重复渲染楼层不重新触发记忆提取。
- [ ] 区分 dialogue 与 utility 请求来源；generateRaw 不递归进入工具 Agent 的角色生成流程。
- [ ] 优先验收变量/状态面板、消息操作、事件、宏和常用斜杠命令。上游已提供的 STscript 能力按宿主依赖核对，Node 后端插件不能仅靠继承前端获得支持。
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
- [ ] ST 用户在原有分区完成选卡、设置预设/世界书、发送、停止、重新生成和切候选；记录需要重新学习的操作和实际障碍。
- [ ] 从 STE 角色库进入聊天、在聊天中修改资产、开分支后返回管理界面，检查同一数据源及连接配置；不出现两套存档或重复设置。
- [ ] 同样剧情分别测普通模式、Agent 模式和柏宝书模式，记录事实遗漏、角色知情越界、文风、伏笔和延迟。
- [ ] 连续三轮比较最终请求前缀与 Provider 缓存回报；不支持统计的服务标明未知。
- [ ] 检查工具上下文随历史增长仍受预算约束；未全量重复读取/向量化整个故事。
- [ ] 检查 2,000 楼样本的虚拟化、动态内容数量、50 次切换清理，以及流式期间写盘次数。
- [ ] 执行重启恢复、磁盘写入失败、外部 memory 编辑、历史修改、切库和迟到返回场景。
- [ ] 完成第三方来源记录、许可证与署名；发布兼容矩阵，按实际验证结果标注版本和功能。

**现有 STE 发布检查命令（执行阶段运行；不能替代锁定上游的构建/检查）：**

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

上游前端构建、资源加载、扩展契约与移动端适配检查由 P0 的实际来源决定，并写入新版执行包及发布记录；不能假定当前 Vite/npm 命令覆盖了继承后的全部界面。

## 需求覆盖

| 需求 | 实施阶段 | 验收 |
| --- | --- | --- |
| R01、R02、R10 | P0、P1、P3、P5 | A01、A02、A10 |
| R03、R04 | P0、P3、P5 | A02、A03 |
| R05、R06、R09、R12 | P3、P5 | A04、A05、A10、A11、A12 |
| R07、R08 | P2、P3 | A04、A06、A07 |
| R11、R14 | P4、P5 | A08、A09 |
| R13 | P1、P3、P4、P5 | A05、A09、A10 |
| R15 | P0、P1、P2、P4、P5 | A07、A08、A13 |

## 本轮交付自查

- 方案以用户已确认的主模型/工具 Agent 分工为中心，旧作废方案未复用。
- 前端路线已改为真实复用 ST/TauriTavern；旧自绘布局和 React 游玩页扩建路线退出，旧 P0 明确标为历史参考。
- 未把“无 Agent”当作任意 ST 插件天然可运行的承诺。
- 直接集成的价值落实到共用调度、存储、事件和渲染生命周期，性能增益仍需测量。
- 文件记忆的来源、修订、恢复、手工编辑和平台差异有具体处理。
- 当前状态为方案交付，P0—P5 均未执行。
