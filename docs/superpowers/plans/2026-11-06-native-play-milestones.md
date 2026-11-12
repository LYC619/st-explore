# Batch 2～4：四大原生游玩模式实施准备

> 后续仅方案：已按实际项目链接和参考原图重写为[v3原生世界方案](2026-11-07-play-world-v3.md)。用户选定沙盘优先；本历史方案不再执行，v3尚未获实施授权。

> 当前状态（2026-11-07）：用户否决本轮成果，两轮实现均已回退。本文仅保留历史讨论，不再是执行依据；此前批准和技术测试不代表游玩体验认可。见[回退记录](../../verification/2026-11-07-multimode-rollback.md)。

> 2026-11-07 执行更新：用户与Antigravity已联合批准本修订版并授权完成全部批次。Batch 1～4源码已实现，当前实现映射、验证证据、差异及平台未验项以[全批次交付](../../private/verification/2026-11-07-two-pillars.md)为准。下文保留11月6日规划快照中的拟议接口和验收目标；其“尚未实施/仅文档”描述不再代表当前状态。未打包、发布或推送。

2026-11-06 · Codex · v2，尚未实施。基线、维护者、事实/素材/预算合同以[主架构](2026-11-06-multimode-transparent-memory.md)为准；前置为[Batch 1中枢收尾](2026-11-06-batch1-memory-choices.md)。用户体验顺序是GAL→RPG→主神空间/AI小镇；周期提取已并入Batch 1，不再占独立大批。

以下新增文件/接口是拟议；实际固定ST入口必须先读上游与overlay确认，不能把伪接口当已有API。所有批次沿单ST、同StorySession保存、分支工作副本，不改原卡/原预设/主世界书。

## 1. 共用准备与验收标准

- 四个同级模式：standard/gal/rpg/ensemble。经典气泡与卷宗保留；ensemble内选sanctuary/town。与classic/agent和memoryOwner正交。
- 顶栏Segmented Pill单行，390px仅图标仍44×44；未实现模式不开放空按钮。更多保留原分支、脚本、过程、帮助、关闭。
- 模式保存为分支偏好；临时requested与applied分开。切换不生成、不换候选、不重建iframe；流式中等待结算，失败保留原模式/草稿。
- 已保存候选/变量是视图真源，TurnReceipt是动作前提；ProcessLog仅解释。未知插件完成不等于HTTP完成。
- 受限命令带scope/operationId，保存前检查branch/epoch/source。snapshot有界，桥不传密钥、任意原生路径或可执行代码。
- 控件至少44px，reduced-motion、读屏、返回与焦点恢复、四主题/亮背景对比度纳入人工检查。
- 关键UI先在真实ST容器做接缝验证，再实现视图；不以React替身测试证明HTML/助手执行未受影响。

## 2. Batch 2：GAL舞台

### 2.1 可体验的完成形态

玩家点GAL就看到大立绘/背景/底部毛玻璃对话框和行动卡。无卡片素材使用内置场景或深色渐变；选择“舞台设置”可换背景与立绘，默认中性表情，映射情绪为可选项。完整原文与历史可展开，原输入框随时可用；不用创作者写HTML/CSS。

内置背景10～15张（建议12），单图≤150,000字节，素材＋manifest≤2,000,000字节；开包即用且离线可读，不把“支持外部图片”当内置素材交付。许可/来源随manifest记录，禁止未经核验直接复制参考产品素材。

### 2.2 分步与文件

| 顺序/可验证输出 | 修改现有 | 拟新增 |
| --- | --- | --- |
| 2A 模式切换保留ST节点/滚动/输入 | src/pages/Roleplay.tsx、src/tavern/host-bootstrap.js、scripts/tavern/host-overlay.mjs、src/lib/roleplay/tavern-host.ts | src/components/roleplay/PlayModeBar.tsx；src/lib/roleplay/play-mode.ts、play-bridge.ts；src/tavern/play-mode-bridge.js、play-mode.css |
| 2B 舞台可无素材游玩 | src/tavern/play-controls.js/.css；已有Sheet/主题变量 | src/tavern/gal-stage.js、gal-stage.css；src/components/roleplay/StageSettings.tsx |
| 2C 素材包与按需解码 | src/lib/portrait-store.ts、character-portrait-cache.ts、portrait-preview-cache.ts；必要Tauri/Capacitor读资源接缝 | src/lib/roleplay/stage-assets.ts、stage-media-cache.ts；public/play-scenes/manifest.json与WebP |
| 2D 可选补选项与上下文策略 | src/lib/roleplay/choices.ts、tavern-host.ts、provider.ts、process-log.ts | src/lib/roleplay/choice-generation.ts、context-policy.ts、request-budget.ts（有限辅助用途） |
| 2E 持久化/继承/分享 | src/lib/roleplay/branch-inheritance.ts、story-package.ts、runtime-store.ts | 仅现有受限目录下模式/素材引用配置，不另造图库 |

2A先在固定ST验证“当前消息呈现＋原列表历史”接缝，检查虚拟列表、脚本/iframe生命周期及长楼。若样式包装会销毁/重执行消息，修接缝后再推进，不能复制HTML绕过。2B与2C可分别验收，完整Batch 2必须两者齐备。

### 2.3 接口合同

```ts
interface StageConfig {
  schema: 1;
  background: AssetRef | { kind: 'css-fallback' };
  portrait?: AssetRef;
  emotionBindings?: Array<{ value: string; asset: AssetRef }>;
}
// AssetRef为assetId/revision/来源种类；UI不持原生绝对路径。
interface MediaLease {
  url: string; width: number; height: number;
  estimatedDecodedBytes: number;
  release(): void;
}
// acquire(ref, targetSize, scope, signal): Promise<MediaLease>
// generateChoices({receipt, visibleContext, budget, signal}): Promise<ChoiceSet>
// setMode({scope, requested}): Promise<ModeState>
```

选择结果绑定正式receipt/source digest/策略版本，每候选最多一次辅助调用；点击沿现有同一发送接口，不在模型服务另造直接发聊天。辅助失败不改主轮成功状态；用户开始下一轮即取消过期任务。

舞台配置留在分支，跨故事默认不继承绝对外部路径；素材替换改变revision，缓存不得误用旧URL。导入卡片背景只读声明资源，不能扫描执行卡片HTML来找背景。

### 2.4 交互状态

| 状态 | 呈现/操作 |
| --- | --- |
| 切入/图加载中 | 先展示可读对话与CSS背景，再替换图；图片错误不挡文字 |
| 有明确原文选项 | 原有2～4行动卡；角标、金边微光、按压缩放 |
| 无选项且补齐关闭 | 输入框/继续入口照常，不空转或自动生成 |
| 补齐中/失败 | 小型加载提示不遮正文；失败可手动再试，不自动循环 |
| 点击选项 | 同步锁整组、loading；有草稿只追加；候选变动拒旧按钮 |
| 历史展开 | 同一原消息列表可搜索/换候选；返回舞台恢复锚点 |
| 390px键盘弹起 | 立绘让位，选项纵排，输入/提交保持可见 |
| 切回标准 | 原节点/候选/草稿/扩展状态保留，清舞台样式与媒体占用 |

### 2.5 性能与上下文

媒体池手机32MiB/桌面64MiB，计显示＋过渡＋缓存解码量；预约不足降采样/释放，最多2解码并发。测试同时加载背景与多张表情，不能仅测LRU无引用项。先读尺寸并拒巨图；原生缩图/有界解码接缝不支持时输入像素上限必须可执行。

GAL仅省略STE自有非必需数值重复描述；活动MVU/SPreset协议不能裁。补选项输入≤1024、输出≤192token，15秒超时；不带全卡/整段历史，默认关闭。预设本身过长时不保证首字提速，记录是否命中精简策略与最终token差异。

### 2.6 验证/退出条件

拟新增：src/test/roleplay-play-mode.test.ts、roleplay-stage-media-cache.test.ts、roleplay-choice-generation.test.ts、roleplay-context-policy.test.ts。

- Vitest：切换状态、scope迟到结果；媒体有引用/过渡时预约拒绝、LRU淘汰、abort/URL释放；选项过期/额度/不重复；context必需块保留。
- Node接缝：overlay固定上游定位、资源注册；WebP张数/单图/总大小/hash与尺寸检查，失败阻止该批构建验收。
- Smoke：真实ST流式→切GAL→结算后应用→换候选→历史→标准，HTML/助手只执行应有次数；多次选项双击仍一次提交。桌面/390px、无图/亮图/坏图、软键盘与草稿。
- 性能：100次表情切换/20次模式切换后无活跃lease泄漏；缓存估算始终不超上限；大图不先全量解码。记录WebView进程峰值/释放后区间，不用JS堆代替GPU。
- 退出：内置素材可离线使用，GAL无需作者代码，标准回退完整；补选项关闭时额外模型调用为0；Windows/Android未测则不宣布对应端完成。

## 3. Batch 3：RPG冒险HUD

### 3.1 原生玩法与已有MVU兼容

主界面就是游戏仪表盘，不放JSON树。默认“通用冒险”“修仙”两套可选布局/变量合同；已有MVU故事建议绑定已有字段，确认后显示。空白故事选模板在新分支工作副本初始化命名空间/更新协议，复用现有MVU，不要求玩家手写脚本。

已有同名变量/成品/正则时先预览冲突，选择映射或取消，不能覆盖；模板仅对平台管理的字段生效，撤下保留用户剧情与既有变量。缺MVU/原版助手能力须显示准备路径；准备前不虚构HP/背包数据。内置模板不是另一个战斗结算器。

### 3.2 文件与依赖顺序

| 顺序 | 修改现有 | 拟新增 |
| --- | --- | --- |
| 3A 共用已保存候选变量快照 | src/lib/frontend-workbench.ts、roleplay/tavern-host.ts、turn-settlement.ts；VariableInspector仅作为选择/诊断入口 | src/lib/roleplay/variable-snapshot.ts、hud-projection.ts |
| 3B 平台模板与可视绑定 | 原分支工作副本/运行配置接缝；src/pages/Roleplay.tsx | src/lib/roleplay/rpg-profiles.ts；src/components/roleplay/HudSetupSheet.tsx |
| 3C 图形HUD与delta | src/tavern/play-mode-bridge.js、play-mode.css（Batch 2新增）；现有主题 | src/components/roleplay/RpgHud.tsx、HudInventory.tsx；src/lib/roleplay/hud-delta.ts |
| 3D 判定/叙事分流 | 原ST布局挂点、context-policy.ts | src/lib/roleplay/ruling-events.ts；src/components/roleplay/RulingStrip.tsx |
| 3E 继承/分享/退出 | branch-inheritance.ts、story-package.ts、runtime-store.ts | 有版本的分支hud配置，不复制全量变量 |

3A抽出frontendSnapshot的候选选择规则供工作台和运行态共用，仍区分“预览变量”和“真实已保存变量”。3B提供模板，可视绑定不变成进阶用户的必经流程。

### 3.3 接口与数值语义

```ts
type HudBinding =
  | { kind: 'bar'; valuePointer: string; maxPointer?: string; fixedMax?: number; label: string }
  | { kind: 'badge'; valuePointer: string; label: string }
  | { kind: 'inventory' | 'quests'; valuePointer: string; label: string };
interface HudProfile {
  schema: 1; id: string; bindings: HudBinding[];
  variableContractVersion?: string;
}
interface HudProjection {
  receiptId: string;
  widgets: readonly HudValue[];
  diagnostics: readonly string[];
}
// projectHud(snapshot, profile): HudProjection // 有界纯函数
// delta(previousReceipt, currentReceipt, profile): HudDelta[]
// applyRpgProfile({scope, profileId, expectedVariableDigest, createBranch}): ...
```

不支持任意JS表达式，纯JSON Pointer与数值格式配置；单页绑定≤32项、背包首屏≤24格/按需翻页、任务按需展开。变量值缺失/类型错误显示未记录，条比例钳位但原数值保留。路径选择器可搜字段，常见别名只作建议，确认后才应用绑定。

delta只比较同branch连续正式采用回合且同profile；候选切换/重开/纯读取重置基线，不播放战利品。同receipt只播一次；同指标合并，最多4条动效，reduced-motion直接显示结果。流式变更可显示结算中，不提前增加永久背包/经验。

判定源为已知结构化事件或模板显式区块，带sourceRef；不解析任意正文数字推断骰点。原文完整保留可查看，判断带是显示投影；没有可信事件则仅文学正文。

### 3.4 界面与上下文

桌面HUD侧栏，手机顶部紧凑生命/灵力条＋徽章，背包/任务点击底部抽屉，不固定占满屏。重要战斗判定独立一条可折叠播报；小说段落仍可读。进度条渐变平滑过渡，delta轻上浮淡出，不大幅闪烁。

RPG优先保留MVU schema、必要变量、更新协议与工具结果；只剪STE冗余描述。HUD隐藏字段不意味着可从Prompt删除。Inspector和“本轮变量变化”从调整/过程进入；不能为了做漂亮HUD改变量真源。

### 3.5 验证/退出条件

拟新增src/test/roleplay-hud-projection.test.ts、roleplay-hud-delta.test.ts、roleplay-rpg-profiles.test.ts、roleplay-ruling-events.test.ts；回归frontend-workbench.test.ts、variable-inspector.test.tsx、roleplay-turn-settlement.test.ts。

- Vitest：JSON Pointer转义/缺值/NaN/负max/大背包/无效schema，绑定限额；同receipt幂等；换候选/分支不发delta；模板冲突不覆盖原变量。
- Smoke：无定制代码的新故事选模板→正常回复→MVU更新→保存→HUD条/背包变更→重开一致；已有真实MVU故事映射/撤下→回标准完整。
- 真实插件组合：SPreset工具正文先落定、MVU完成后才发最终delta；失败/停止/保存失败不展示已获得奖励。
- 390px：HUD不遮提交，背包/任务关闭回原位置；极端数值长中文不撑破。动效reduced-motion、四主题、键盘与候选可达。
- 退出：至少一套原生模板无需手写HTML/补丁可完整游玩，已有MVU故事无需重置；HUD与实际保存变量一致。仅做映射编辑器不算此批完成。

## 4. Batch 4：无限空间与AI小镇

### 4.1 两个子阶段，同一个里程碑

**4A主神空间**先交：创建独立房间故事，选2～4角色与来源关系，手动指定/单步回复，上帝事件胶囊，保存/重开/分支。**4B AI小镇**再交：同一房间切town、稳定轮询与概率、3～5轮有界推演、预算和暂停/停止。两者都是原生第四模式，不另建第五导航，也不把4A当全部完成。

召入流程：选角色卡→可选一个已结识故事/分支→勾选带入的确认关系/事实→预览公共简介和私密归属→创建房间。没有已结识故事也可选“初次相识”。默认不带原故事整段历史/全部世界书/日记/变量，不写回源卡。公共简介只含明确公开内容；私密卡片字段只给本人。

### 4.2 文件与接缝

| 顺序 | 修改现有 | 拟新增 |
| --- | --- | --- |
| 4A-1 room/actor身份与来源快照 | src/lib/roleplay/tavern-host.ts、assets.ts、catalog.ts、live-chat.ts；src/types/archive.ts（必要字段才增） | src/lib/roleplay/room.ts、room-import.ts；src/components/roleplay/RoomSetupSheet.tsx、RoomRoster.tsx |
| 4A-2 ST群聊单步与保存 | src/tavern/host-bootstrap.js、scripts/tavern/host-overlay.mjs、story-session.ts、turn-settlement.ts | src/tavern/ensemble-bridge.js；src/lib/roleplay/actor-context.ts |
| 4A-3 公共/私密上下文 | agent-runtime.ts、tool-agent.ts、context-ledger.ts、memory-selection.ts、context-policy.ts、provider.ts | actor身份贯穿请求和工具的受限context视图，不设全角色共享检索缓存 |
| 4A-4 事件胶囊与分享 | src/pages/Roleplay.tsx、branch-inheritance.ts、story-package.ts | src/components/roleplay/EventCapsule.tsx；src/lib/roleplay/room-events.ts |
| 4B-1 有界调度与预算 | request-budget.ts（Batch 2）、tavern-host.ts、completion-monitor.ts、provider.ts | src/lib/roleplay/ensemble-runner.ts；src/components/roleplay/TownControls.tsx |
| 4B-2 诊断/恢复 | ChatProcessPanel.tsx、process-log.ts、runtime-store.ts | 有限run状态、调用预约/结算回执 |

群聊配置现在`groups: []`，不能假定ST已接通。先列固定上游group读取/保存、指定speaker、chat locator、quiet、候选、停止所需路由，再逐项验证。不得用切换多个单聊故事或全局replace char宏模拟群聊。关闭上游automode，避免两个循环。

### 4.3 房间、隔离与运行合同

```ts
interface RoomActor {
  actorId: string; characterId: string;
  sourceStory?: { storyId: string; branchId: string | null; revision: string };
  publicProfile: string; privateProfileRef: string;
  importedFactIds: string[];
  enabled: boolean; replyProbability: number;
}
interface RoomConfig {
  schema: 1; form: 'sanctuary' | 'town'; actors: RoomActor[];
  sharedScene: string; maxRepliesPerRound: number;
}
interface ActorStep {
  scope: PlayCommandContext; actorId: string;
  runId: string; stepId: string; parentReceipt?: string;
  contextPolicyDigest: string;
}
interface RunBudget {
  maxRounds: number; maxReplies: number; maxCalls: number;
  maxTotalTokens: number; maxOutputTokens: number;
  deadlineMs: number; stepTimeoutMs: number;
}
// stepActor返回正式保存TurnReceipt，不是仅返回模型字符串。
// reserveCall在任何provider/quiet/tool调用前执行，settleCall结算实际usage。
// queueEvent(scope, operationId, text) -> queued/applied/cancelled
```

默认3轮，硬上限5轮/10回复，每轮≤2回复；活跃actor≤4，轮首游标轮转，避免前两人垄断。每actor每轮最多抽一次概率，全跳过暂停。最多16调用、64,000累计预约token、单回复输出≤768、单步120秒/run10分钟，具体计量见主架构。预设更长会提前停止，不能强行跑满。

actorId不等于characterId/显示名；同卡多版本来源须显式实例化。每个actor仅自身私密＋公共场景/公共历史；原卡全量描述、私有世界书、日记、工具索引/search/read、旧Ledger、补选项/维护输入都适用。角色A不能读B的未公开来源关系；用户在中枢可管理全部，但UI权限不是模型权限。

未经审计且可读取全卡/自行联网的扩展不能参加严格隔离run；展示具体不兼容能力，用户可选兼容配置，不静默禁用扩展。共享JS无法提供恶意脚本安全沙箱，不能声称任意第三方代码均隔离。

### 4.4 事件与停止语义

悬浮胶囊不常驻大输入框；事件输入保持草稿、literal不执行slash。队列FIFO，下一actor准备前插一条可见旁白并保存，再标applied。当前已发请求不受事后事件影响；立即影响需停止当前回合，用户再发。重复operationId只保存一次；未应用可取消，应用后改原楼/分叉。

“本轮后暂停”不再排下一步；“立即停止”abort当前主/辅助请求；窗口离开/后台挂起停排，恢复为paused/interrupted，不自行续跑。保存失败、来源变更、角色权限不明、扩展flush未知、超额均停。角色回复不能通过正文/工具自开新的角色任务。

账本记录每次预约/实耗与剩余额度，所有tool/quiet重试也算调用；usage缺失保守保留预约，不按零；停止不退回已消耗。跨进程重开保留最后保存步，不自动重放pending调用或事件，明确显示中断位置。

### 4.5 验证/退出条件

拟新增src/test/roleplay-room.test.ts、roleplay-actor-context.test.ts、roleplay-request-budget.test.ts、roleplay-ensemble-runner.test.ts、roleplay-room-events.test.ts。

- 隔离金丝雀：为A/B放独有秘密字符串；检查角色A的最终请求、工具索引/search/read、summary输入、quiet、Ledger、缓存、导出都无B私密。不是仅断言UI没显示。
- 恶劣路径：stale actor response、早楼改写、候选切换、迟到工具、不同branch同名角色、来源故事删除、导入快照修订均不串身份。
- 预算：并发预约、工具后续、异常无usage、停止、超长预设、重开不重发；每个纳管请求实录都在账本，超额前无网络派发。
- 单步集成：固定ST指定actor→角色姓名/身份正确→完整正文/候选/MVU保存→另一actor只收到授权上下文。
- 真实流程：两作品角色召入、公共/私密关系选择、单步互谈、事件、关房间再开、分支；AI小镇3轮/5轮/全跳过/暂停/停止；源故事/卡片hash不变。
- 分享：公共房间包省略私密profile/事实及日志载体；完整备份可恢复全部但不冒充可公开分享。公开对话中的已披露内容需明确提示。
- UI：390px列表/预算/胶囊不挤顶栏；模式往返不偷偷续跑；失败能看见保存位置并返回标准。
- 退出：4A单步与隔离先通过再开4B；严格预算覆盖所有调用，未知插件完成不放行，主神空间和小镇两形态均可体验。

## 5. 共用执行与交付检查

每批只新增验证实际合同的测试，使用本地模型夹具和隔离资料；真实用户资料/模型的执行范围按当时授权与现有规则核对。已知检查命令如下，拟新增文件就绪后加入当批定向列表：

```powershell
npx vitest run src/test/roleplay-workspace.test.tsx src/test/roleplay-tavern-host.test.ts src/test/roleplay-turn-settlement.test.ts src/test/roleplay-story-session.test.ts src/test/roleplay-choices.test.ts --maxWorkers=2
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
npm run test:tavern-source
npm run test -- --maxWorkers=2
npm run build
```

每批新建对应真实入口smoke脚本，记录服务器/夹具和实际命令；不复用旧通过报告冒充新版本。Windows检查实际WebView2及Vault；Android使用实际设备、软键盘、IME和后台恢复，浏览器390px只是其中一层。性能检查记录机器/样本/初始与峰值，不承诺未实测数字。

交付必须附：独立可体验入口、普通玩家零代码路径、失败恢复路径、截图/请求或保存证据、已有ST/扩展兼容范围、资源包体/内存/Token数值、未验平台、用户体验反馈。模式可撤回到standard，事实schema读取/隐私过滤不能随UI撤回而丢失。未授权的打包、发布不随计划自动发生。

