# DSH Tavern：首轮参考项目阅读

日期：2026-10-18。范围：产品说明与代码静态阅读，对照 STE 当前实现；未安装运行、未调用真实模型、未复现用户的 DeepSeek 游玩结果。本文是参考资料，不是已批准的实施计划。

## 阅读基线

- 本地目录：`_reference/dsh-tavern-main/`；`package.json` 版本 2.7.0。
- 本地 runtime 清单记录 revision `36521d7b28ca3d4f88d935bb66c786a471024509`、releaseSequence 667。这是清单身份，不代表已逐文件核验副本与该提交完全一致。
- STE：`codex/playtest-1007`，HEAD `92c18cebdb4831102750bb6a95409e5b581ea243`；已有大量未提交内容，全部保留。
- [GitHub 项目页](https://github.com/flizzywine/dsh-tavern)本轮访问显示约 1.0k stars、68 forks。受众从何而来、实际活跃和留存如何，没有证据；不从 star 数推断。

## 初步判断

它有实际的 Agent 工作机制，值得继续参考。主要价值在于将游玩中的工作拆开、让模型按需取资料，以及让用户用自然语言改卡和诊断现场。“导入就能开始”有默认提示词和运行流程支撑，但默认输出是否好玩、是否合口味，仍是另一项产品能力。

用户反映“用 DeepSeek，不加预设效果一般”与当前阅读发现并不矛盾；不能据此认定用户漏开某个万能功能，也不能未经复现就断言原因在模型、卡片或配置。

## 默认体验究竟提供了什么

| 部分 | 本地实现证据 | 对体验的含义 |
| --- | --- | --- |
| 正文底层规则 | [story.md](../../../_reference/dsh-tavern-main/tavern-plugin/prompts/story.md)定义“小说续写引擎”，只输出正文，叙述/扮演全部角色；用户消息作为本轮演出指引重新组织成场景 | 有明确的默认玩法，但偏共同编写小说。期待单角色即时聊天的用户，可能感到输入被重演、代演范围更广；这是待验证的解释候选 |
| 角色与上下文 | [context-planner.js](../../../_reference/dsh-tavern-main/tavern-plugin/lib/domain/context-planner.js)读取描述、性格、场景、示例、卡片指令、世界书、Guide 和现场状态 | 输出仍取决于卡片提供的事实、示例及额外指引，不自动补齐整套审美偏好 |
| 外部预设 | [runtime-presets.js](../../../_reference/dsh-tavern-main/tavern-plugin/lib/domain/runtime-presets.js)允许无 activePreset；[preset-conversion-preview.js](../../../_reference/dsh-tavern-main/tavern-plugin/lib/domain/preset-conversion-preview.js)将 ST 预设安排为前/中/后段并提供诊断 | “不需要外部预设也能运行”成立于设计层；导入原预设也不是完全不经过转换的原 ST 行为 |
| 写作技能 | [tavern-skills.js](../../../_reference/dsh-tavern-main/tavern-plugin/lib/domain/tavern-skills.js)按用途分配技能；[create-writing-skill](../../../_reference/dsh-tavern-main/presets/tavern/skills/create-writing-skill/SKILL.md)要求用户明确引用教学素材，再提炼为前台技能 | 本地内置目录以改卡、调试、MVU 转换和后台人物设计等为主；未发现预装的完整打斗/悬疑/感情戏写作技能库。“支持场景写作 Skill”不等于初装已有丰富文风 |
| 默认后台任务 | [tavern-settings.js](../../../_reference/dsh-tavern-main/tavern-plugin/lib/domain/tavern-settings.js)的 normalizeBackgroundTasks 默认打开姿势和变量任务，人物设计/台账为 false | 开关启用仍不代表普通卡已有 MVU 规则、变量结构和固定面板；具体结算走卡片对应路径 |

## Agent 的实际工作

1. **正文自己按需取资料。** [turn-orchestration.js](../../../_reference/dsh-tavern-main/tavern-plugin/lib/domain/turn-orchestration.js)的 visibleTools 为游玩开放变量读取、历史召回、世界书搜索和 Skill；剧本模式额外读剧本。这是与普通一次性拼接请求有区别的工具循环，但效果取决于模型是否正确调用。
2. **正文、结算、候选分别处理。** [background-pipeline.js](../../../_reference/dsh-tavern-main/tavern-plugin/lib/domain/background-pipeline.js)、[candidate-tasks.js](../../../_reference/dsh-tavern-main/tavern-plugin/lib/domain/candidate-tasks.js)和 [play-controls.js](../../../_reference/dsh-tavern-main/tavern-plugin/src/client/features/play-controls.js)显示独立任务、状态与重试入口。候选项有手动生成按钮，可带意见重新生成；不要把“候选会规划走向”理解为每轮必定自动替用户规划。
3. **MVU 结算通过工具提交并校验。** [mvu-background-settlement.js](../../../_reference/dsh-tavern-main/tavern-plugin/lib/domain/mvu-background-settlement.js)定义结构化操作、校验反馈、回滚及有限重试。模型负责判断变量如何变化，程序负责执行校验，面板按变量展示；这减少正文承担格式协议的负担，但不保证所有变量判断都正确。
4. **压缩与原文检索同时存在。** [history-recall.js](../../../_reference/dsh-tavern-main/tavern-plugin/lib/domain/history-recall.js)支持关键词/按轮读取正式历史，限制每次生成的召回次数；[story-compaction.js](../../../_reference/dsh-tavern-main/tavern-plugin/lib/domain/story-compaction.js)和 [压缩提示词](../../../_reference/dsh-tavern-main/tavern-plugin/prompts/story-compaction.md)仍会做摘要，目标保留最近 10 轮原文，并受窗口预算约束。不能理解成“不做摘要”或“所有旧细节一直在上下文里”。
5. **卡片 Agent 是另一套有编辑能力的工作台。** 工具范围含读/改卡、世界书、预设、正则、文件工具和 shell；[debug-card](../../../_reference/dsh-tavern-main/presets/tavern/skills/debug-card/SKILL.md)要求关联实际游玩记录，按轮读请求、日志和显示结果，形成诊断依据。它降低了定位和修改配置的操作成本，但不是自动消除配置需求。
6. **人物设计和台账需要明确区分触发方式。** background-pipeline 将二者标记为 manual，UI 提供“设计人物”，index 中通过 designCharacter/consolidateLedger 分派。README 对人物登场时后台设计的描述容易让人以为默认自动发生，本地代码不能支持这种理解。

## 值得借鉴的工程细节

- [session-stable-prefix.js](../../../_reference/dsh-tavern-main/tavern-plugin/lib/domain/session-stable-prefix.js)保存稳定背景快照；动态世界书、Guide、状态按回合组织。这为复用缓存提供依据，但“95% 命中”“约 10 秒”仍是 README 宣传/案例，本轮没有模型日志或对照实验来验证普遍效果。多阶段模型工作也意味着要区分正文首字、正文结束、后台结束和全轮费用。
- [background-task-coordinator.js](../../../_reference/dsh-tavern-main/tavern-plugin/lib/domain/background-task-coordinator.js)和 durable-task-mailbox 将任务绑定到剧情状态，处理重启、中断、重复请求与失效结果。独立重试背后需要这套一致性处理，不能只复制一个按钮。
- 固定状态面板把“展示格式”与“正文内容”分开；依然需要适配/转换及对应规则。README 的“绝对不会掉格式”不应当作任意卡片与脚本组合的验收结论。
- README 说改卡“先给方案，确认后才写入”；本地 [edit-card](../../../_reference/dsh-tavern-main/presets/tavern/skills/edit-card/SKILL.md)却要求明确后直接改，turn-orchestration 也存在“卡片 Agent 直接保存”路径。因此不把宣传中的确认步骤当作统一的强制事务机制，真实 UI/工具链仍需后续核验。

## 与 STE 当前实现对照

STE 已有的基础以代码为准，不以已作废设计稿判断：

- [tavern-host.ts](../../../src/lib/roleplay/tavern-host.ts)已在 Agent 模式的真实生成请求前调用 runtime.prepare。
- [tool-agent.ts](../../../src/lib/roleplay/tool-agent.ts)提供 context/memory 两阶段工具循环，包含搜索来源、读取原文、提交资料与记忆增量。
- [memory.ts](../../../src/lib/roleplay/memory.ts)维护按分支的 Markdown 记忆、来源指纹、失效与冲突处理。
- [context-ledger.ts](../../../src/lib/roleplay/context-ledger.ts)冻结已采用回合的资料增量，并判断前缀是否可复用；已有缓存相关结构，不能把它当作完全缺失。
- [扩展兼容原则](../../principles/extension-compatibility.md)限定当前 ST 前端及插件版本、平台和验证范围。这与 DSH 自建界面/兼容层的路线不同。

后续讨论最值得取样的四类体验：

| 对照方向 | 想解决的具体问题 | 讨论时需要保留的边界 |
| --- | --- | --- |
| 开局质量与玩法说明 | 用户不知道默认是聊天、小说共写还是有规则的文字游戏；导入后能发消息但不好玩 | 先明确用户偏好和用同一卡/同模型对照，不把“加个 Agent”当作质量验收 |
| 本局 Guide、带意见重写 | 改文风/节奏需要找预设字段；重抽无法表达哪里不满意 | 先核对 STE 现有入口，分清本轮、当前分支与长期偏好 |
| 从问题现场进入调试 | 用户只能描述“没生效”，难以知道是预设、卡片、渲染还是变量问题 | 沿用实际请求和保存状态，给出可审阅改动与恢复路径；不照搬终端权限 |
| 展示与任务分离 | 变量/状态面板失败拖累满意正文，整轮重来代价高 | 先验证真实痛点和模型费用；结合现有分支、候选和来源一致性设计 |

这些是参考方向，尚未选择实施项。剧本分块与进度、场景写作 Skill 可以继续研究，但并不能直接解决初装文风一般的问题。

## 后续若做实测

固定同一张卡、模型、采样及输入，对照默认配置、加入用户原预设、只加 Guide；先测开局与短对话，再分别测试长历史回忆、MVU 结算、带意见重写及改卡诊断。分别记录正文质量、任务成功、等待阶段和实际用量。这样才能区分“默认提示词不合口味”与“确有 Agent 收益”。本轮未执行，也未将此列为已授权开发工作。

许可证记录：本地 LICENSE 标识为 AGPL-3.0；当前只做阅读和思路比较，没有拷贝实现代码。
