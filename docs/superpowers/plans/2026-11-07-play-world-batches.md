# v3 分批实施：从一段能玩的世界开始

2026-11-07 · Codex · **用户正式批准 v3，确认 Batch 0＋1 后，追加授权 Batch 2～5 连续源码实施、完成后统一实测。** 本文件保留原范围与投入判断，并在下表记录实际落地。旧方案逐批等待批准条款已被本次连续实施授权取代。源码交付不等于用户已认可可玩性；新安装包、提交与发布另行处理。前置架构见[主方案](2026-11-07-play-world-v3.md)，实际结果见[统一验证](../../verification/2026-11-07-play-world-b25.md)。

## 本轮实施对照

| 批次 | 实际源码与接口 | 交付状态 |
| --- | --- | --- |
| 0＋1 | `WorldPlay`、`WorldCanvas`、`WorldSession.step`、`WorldRepo`、Worker；8地/12人规则世界 | 底座已完成，用户确认后连续推进 |
| 2 | `src/play/agents/{state,context-projector,budget,model-gateway,scheduler}.ts`；`memory/{console,story-timeline}.ts`；`WorldIntelligencePanel`、`WorldMemoryConsole` | 人设/合法动作、先存规则后旁白、预算凭据、双视图与私密范围实现；真实人设对照、固定响应出站和原生熔断已测 |
| 3 | `adventure/{control,perspective}.ts`、`sanctuary/summon.ts`、`AdventurePanel`、`SummonPanel`；规则探索/遭遇 | 唯一接管、本人视角、受伤恢复、最多4来客/8地点、来源更新、日程/召集实现；真实浏览器与持久化通过 |
| 4 | `gal/{scene,story-adapter,generate-scene}.ts`、`GalPlay`、`GalStage`、`StageMedia`、`media/{asset,media-repo,pool}.ts` | 独立Scene/Beat/Choice、剧场规则桥、素材按需加载/释放实现；断点、双击/取消、生产和原生导入通过 |
| 5 | `world-package.ts`、WorldRepo轻量索引、IDB13/媒体集合、整库备份/清理、`use-play-lifecycle.ts` | 完整包/公开快照、坏尾恢复、390px、Windows磁盘/关窗/请求停止与压力检查通过；一小时结果见统一报告；Android未有真机证据 |

实际接口以这些文件为准；下面“拟新增”目录是批准时的职责划分，并非宣称所有同名文件都存在。未实现完整ST无头化或Android桌面Vault/SAF目录；标准扩展留在标准通道，Android使用既有IDB及单文件导入导出。素材12张原创WebP共121,538字节，未移植参考项目代码或美术。


## 交付顺序与投入判断

| 批次 | 玩家能体验的结果 | 前置 | 粗估工程投入* |
| --- | --- | --- | --- |
| 0 | 地图、人物追踪、事件定位、单步/干预的可点原型 | 当前方案明确 | 2～4人日 |
| 1 | 12人规则沙盘，因果可查、可暂停、可存档分支 | 0的游玩流程确认 | 8～14人日 |
| 2 | 角色依人设/所知选择计划，记忆可管理，真实模型演出 | 1的规则闭环 | 6～10人日 |
| 3 | 玩家接管冒险、放回观赏；跨作品休息室/小镇 | 2的隔离与存档 | 6～10人日 |
| 4 | 全屏GAL、分镜选项、世界场景转剧场、ST兼容探针 | 1的会话服务；世界桥依赖3 | 6～12人日；ST适配另3～8 |
| 5 | 真正日常使用的导入、备份、移动端、长时间运行 | 前批核心闭环 | 5～8人日 |

*是单人实现、素材与核查的规划区间，不是Codex运行时长或承诺交付日期；不含完整修仙经济/宗门战争、不确定扩展兼容的全面移植、定制大规模美术。合计约36～66人日，只说明这是一项游戏子系统工程，不能再包装成几天的聊天皮肤改造。每批范围可按试玩反馈删减，不能因已有代码而强推。

## Batch 0：先看见并操作想要的形态

原独立 HTML 保留为固定数据设计样稿。用户随后同时授权 0＋1，本轮把已审阅形态直接接真实规则引擎：`/worlds` 是世界列表，`/worlds/:id` 是独立地图；聊天页增加入口，原标准聊天保持原路由。实际交付原创 SVG 地图、桌面与 390px 布局、人物追踪、事件定位和晴雨分支流程。

实际新增 `src/components/play/world/WorldCanvas.tsx`、`world.css` 与 `src/pages/WorldPlay.tsx`，复用一个真实状态投影，不另保留一套假模拟数据。静态样稿仅在 docs 中归档。

实际接口为 `WorldSession.step(command?)`、人物/地区选择与 `WorldRepo` 存档服务。确认结构化干预即推进一步，取消抽屉不产生状态；地图与事件从同一已提交快照读取。观察晴雨分支可对比改道；冒险视角切换属于后批。

验收不是截图好看：用户能独立找到运行/暂停、追踪人物、定位事件、施加干预和返回。桌面显示地图＋事件；手机地图可拖放，关键触控≥44px，无二行顶栏/横向滚动。观赏时不被输入框常驻占地。0＋1 已获共同实施授权，因此本轮连续交付；用户试玩反馈决定后续调整，不能把自动测试视为可玩性认可。

验证：浏览器实际点击/拖动/返回/短视口；不要写字符串存在测试。截图只能证明布局，不能证明可玩性。准备一个“无雨”和一个“降雨”的演示供用户比较。

## Batch 1：不靠模型也成立的规则世界

拟新增：

- `src/play/world/{schema,clock,commands,rules,simulation,perception,events,rng,pathfinding}.ts`，`simulation.worker.ts`。
- `src/play/world/rulesets/shanhai/{manifest,actions,resources,world}.ts`；原创地图与角色素材声明。目录/文件名为提议。
- `src/play/storage/{world-repo,world-commit,world-archive}.ts`；`src/types/play-world.ts`。
- `src/pages/WorldPlay.tsx`；`src/components/play/world/{WorldCanvas,WorldToolbar,ActorSheet,EventStream,InterventionSheet}.tsx`。

需要改的既有边界：`src/App.tsx`新独立路由；`ChatHub`增加“游玩”入口但不重排全项目导航；`RoleplayWorkspace`/新的会话协调器确保ST生成已结算。`idb.ts`、repo/Vault集合路径与备份、恢复、回收流程一起接入。实施时先确定迁移版本和新增集合，不允许只加一个组件本地保存。

接口：`dispatch(WorldCommand, expectedRevision)`、`observe(ActorId)`、`step(signal)`、`subscribe(WorldPatch)`、`checkpoint()`、`fork(revision)`。Worker只接受验证后的数据，不拿Vault句柄或API密钥；宿主是唯一写者。`WorldRepo.commit(expectedRevision, batch)`保证事件/状态链一致；崩溃恢复测试先于自动连续推演。

内容范围：6～8区域、12人、3资源、8～10动作，至少含移动、采集、休息、修炼/训练、交易/赠予、交谈、互助/竞争中的实际机制；至少两类冲突用规则解决。地图路径真实受道路/天气影响，移动花费模拟时间；视觉平滑仅是已提交移动的插值。

验证：

- Vitest：同种子/同意图得到同结果；非法移动/库存不足拒绝；两人争同一物品只成功一次；动作时长/冷却/停止边界；保存中断恢复/重复commit/跨Vault失效；分支重放不调模型。
- 浏览器：新建→单步→追踪→干预→重开→分支，实际地图/事件/人物值保持一致；无LLM连接仍完成规则演示。
- 用户试玩：观察至少两条因果链；同档干预前后走向不同且可解释；无需开变量检查器理解世界。不能以“12个头像随机游走”过关。

## Batch 2：接入角色智能，同时接入透明记忆

拟新增：`src/play/agents/{scheduler,planner,model-gateway,context-projector,knowledge,reflection,budget}.ts`；`src/play/memory/{adapters,console,selection,proposals}.ts`；`src/components/play/memory/{MemoryConsole,TimelineView,FactCards,FactCaptureSheet}.tsx`。

复用`provider.ts`、API连接、tokenizer、process-log/request-diagnostics；在既有总结维护任务中加入事实候选输出，不新造周期提取大系统。既有标准聊天的记忆库用Adapter读取；这批先给世界人物使用，不无条件改变标准聊天Prompt。若要改变原生Agent检索，单列适配测试和启用项。

接口：`plan(ActorObservation, LegalActions): PlanProposal`、`projectContext(actor, revision)`、`explainMemoryUse(requestId)`、`proposeFact(sourceRef)`。模型只能提交有限合法行动参数；规则验证为权威。人物选择、事件旁白、反思、格式重试都经过同一个预算闸门。

必须有生活节奏：持续动作不每步重新问模型；仅计划耗尽、关键变化或时段切换重规划。彼此只有同场感知/收到消息/公开事件才知道对方经历；没有信息传播的远处角色不会自动知道秘密。事件发生后产生Knowledge，不把世界全量历史塞给所有人。

记忆UI：顶部剧情时间线/事实状态同级；来源、范围、状态可见。规则事实只读并可跳事件；人工短事实可启停/编辑/软删除，候选需确认。楼层保存默认短事实而非整段复制。关记忆不会改历史世界数值，也不会把停止回忆冒充安全删除。

验证：

- Vitest：可见性与版本变化、计划复用、预算预约、usage缺失、超时/取消、错JSON、规则拒绝、提案去重/失效、继承范围和分享过滤。
- 实际请求抓取：A/B私密金丝雀；旁观者、玩家接管、导演全知三种投影；日志/分享/缓存不能泄漏角色未获知信息。测试真实网关出站载荷，不只测selector。
- 模型夹具证明流程；真实模型用3种人设、同一情境各3次，记录人格差异、动作合法性、重复率、总调用/token与延迟分布。受控冲突剧本证明规则因果，自由推演证明新行为，二者不能互相替代。真实端点/数据使用按届时授权，未调用时如实留缺口。
- 用户试玩15～20分钟，观察是否存在追踪人物的意愿、干预后的有效变化，以及明显无意义重复。出现问题先调整规则/目标/信息量，不能默认换更贵模型解决。

## Batch 3：角色冒险与跨作品休息室

拟新增：`src/play/world/{control-lease,encounter,quests,inventory}.ts`、`src/play/import/{character-adapter,story-memory-adapter,worldbook-proposal}.ts`；`src/components/play/adventure/{ActionDock,InventoryPanel,EncounterPanel}.tsx`；`src/play/world/rulesets/sanctuary/`。

接口：`takeControl(actorId, revision)`、`releaseControl()`、`importActor(sourceVersion, mapping)`、`applyIntervention(effect)`。玩家接管时NPC不能替玩家执行，切换在步边界；导演可见和角色可见不能混用。角色卡的私密设定仅进该实例；跨作品强度与关系通过确认映射加入当前规则。

玩家冒险提供可行行动按钮、可见风险与资源消耗，地图探索和遭遇有结果。战斗最初用简单确定规则＋种子随机，不宣称完整战斗系统。无可执行动作说明原因，不能只灰掉按钮。处境失败/受伤有可继续路径或明确结束/读档选项。

休息室不是邀请完就轮流说话：至少3处可去地点、日程、共处事件和关系影响；角色从过去故事带来精选且已确认的记忆。生活动态从结算事件派生。首批支持2～4位导入角色，世界默认12人仍由总调度管理，不开每人一套ST。

验证：物品守恒、角色控制权唯一、接管/放回/分支、源卡不变、导入更新冲突、关系与秘密隔离；浏览器完成探索→遭遇→物品变化→保存重开→转观赏，及两位跨作品来客走动/会面/记住事件。硬规则数值不能被模型文字覆写。

## Batch 4：独立GAL，兼容能力经证据逐项接入

拟新增：`src/play/gal/{scene,beat,choices,scene-repo,story-adapter}.ts`；`src/components/play/gal/{GalStage,DialogueBox,ChoiceDeck,HistoryLog,StageMedia}.tsx`；`src/pages/GalPlay.tsx`。媒体缓存可新写共享服务，但不从已撤回缓存无条件恢复旧实现。

主接口：`generateScene(context)`返回已验证的Scene/Beat图；`advanceBeat()`只读本地；`choose(choiceId, expectedSceneRevision)`最多推进一次；`media.resolve(ref)`按需加载。背景/人物素材与剧情引用独立，缺图仍可继续。2～4个选择不是简单抽取“1/2/3”文本；每个选择有可说明的行动含义。

世界→剧场先作为“某场遭遇的聚焦演出”：暂停世界在相应事件/交互边界，选择通过合法WorldCommand返回，不让GAL旁白同时改库存。复用用户角色卡开独立视觉故事时创建派生会话，原聊天不损坏。

ST适配先做探针，不承诺全兼容：

| 样本 | 要查的实际边界 | 不通过时 |
| --- | --- | --- |
| 普通角色卡＋预设＋主绑定世界书 | 提示组装、关键词触发、流式结果与保存 | 原生导入的支持矩阵明确降级，不称原版等价 |
| 官方MVU＋原版助手 | 事件顺序、变量结算时点、存档重开、隐藏宿主尺寸 | 保留标准聊天通道；禁止假造解析器冒称官方MVU |
| SPreset工具返回 | 工具正文提取与最终保存，取消/失败 | 该组合留在标准通道，直到实测通过 |
| 作者HTML/DOM脚本 | 是否必须真实可见DOM与布局 | 作者前端作为标准专用入口，不以GAL容器破坏它 |

若需要后台iframe，明确属于兼容宿主并测运行成本，不称无DOM。GAL原生视图本身不能出现ST气泡或靠挪原节点布局；标准聊天继续原样可用。纯无头抽离另作长期工程，不能阻塞已验证的世界玩法。

验证：Scene图断边/循环上限/取消/双击/选项过期；同Scene读对白零调用；保存断点和分支一致。真实桌面与390px完成全屏阅读、选项、自由输入、历史、存档、返回；键盘/IME单列真机。外部素材加载失败、超大图、20次切换释放和明亮背景对比。参考InfiPlot效果但不拿项目演示图当本项目截图。

## Batch 5：面向实际资料与平台的收尾

集中完成大库角色选择、世界资源版本、备份/恢复/分享、来源卡更新提示、Android目录授权与后台暂停、Windows WebView2媒体/Canvas/内存、无网/本地模型行为和一小时运行。

重点变更：WorldRepo在`src/lib/vault/`与IDB适配的完整生命周期；独立`.ste-world`包提议（是否新后缀由实施时确认）与现有`.ste-play`区分；元数据索引避免全库故事正文扫描。目录/资产导入沿用来源只读、安全路径与派生规则，不允许一个zip变成任意脚本安装包。

验证：全量Vitest/现有Node检查、生产构建、必要的Rust IPC测试；真机实际点击与软键盘、切库、关窗、后台恢复、存档错误恢复；12/50角色与1万事件负载的帧率/CPU/GPU/进程内存测量。50角色是压力目标，不是首版产品容量承诺。

打包/版本/发布另依用户届时要求执行；源码完成、测试完成、用户试玩认可、打包和发布分别记。上一轮被否决的历史数据不能计作新功能验收。

## 建议测试命令与证据要求

实际可复现命令如下，结果和执行边界见统一报告；smoke 使用隔离库，真实模型脚本需读取已配置连接，会产生调用费用，常规回归不自动包含它。

```powershell
node node_modules/vitest/vitest.mjs run --reporter=dot --maxWorkers=4
node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.node.json --noEmit
npm run test:tavern-source
npm run build
node scripts/smoke/playtest-20261107-world-b25.mjs
node scripts/smoke/playtest-20261107-world-recovery.mjs
node scripts/smoke/playtest-20261107-world-production.mjs
```


实施时优先已有项目脚本，不为每个可逆样式改动新增机械测试。每个行为合同至少有一个真实入口验证；不能mock掉核心WorldCore/存储/宿主后声称已验证集成。把种子、规则版本、素材清单、模型/参数、实际usage、分支和最终源码身份写入每批证据。

## 防止再次做成“功能拼装”的退出条件

1. 界面主体始终是地图或剧场；回归聊天必须是用户明确切回标准入口。
2. 玩家无需配置正则、HTML或变量路径才能体验内置世界。
3. 事件来自已结算行动，人物位置、物品、关系与事件一致，能说明原因。
4. 用户干预有可测、可见的后果；一句旁白换一种文案不算规则干预。
5. AI失败时世界状态仍可信，成本不会失控；不能让无限重试维持表面热闹。
6. 用户已确认底座并授权后续连续实施，当前按完整四批统一实测。若用户仍认为缺少可玩性，围绕实际游玩反馈修正，不用测试数量或后续功能数量代替验收。
