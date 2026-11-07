# v3 参考项目核验：从原图和源码出发

2026-11-07 · Codex。用于[原生游玩架构v3](2026-11-07-play-world-v3.md)。本轮是只读源码分析和设计，没有安装运行参考项目。用户提供的 Antigravity 分析作为线索，以下区分直接观察、源码证据和本项目设计决定。

## 原始笔记和图

- 已读笔记：`D:/2.数据库/个人笔记本/Z1 每日记录/项目参考/2.STE参考.md`。
- 已直接查看原图：`D:/2.数据库/个人笔记本/Z99.attachment/Z1 每日记录/项目参考/2.STE参考/2.STE参考.png`。
- 图中能直接确认：大面积分区地图、分布在不同位置的人物头像、顶端世界年月/修士人数、暂停/菜单按钮、右侧带年月的事件流，以及宏观入口。截图可证明界面构成，不能单凭静态图证明寻路、并发智能、私密隔离或数值规则。
- 原图为笔记中的历史版本；本轮获取的是各仓库2026-11-07默认分支提交，不能假定与截图对应同一版。

## 固定源码身份

| 项目 | 本轮commit | 根许可观察 | 实际读取范围 |
| --- | --- | --- | --- |
| [InfiPlot](https://github.com/zonghaoyuan/infiplot) | `a60e18bc663caaa134d9323a2b89159b7cc9bd05` | AGPL-3.0 | README、LICENSE、package、PlayCanvas、play page、scene API、localStore |
| [OpenStory](https://github.com/ZJU-LLMs/OpenStory) | `3e4857a07ec141a9ed6d3be586dd5d3c573ae389` | Apache-2.0 | README、LICENSE、WorldKernel控制/运行/移动/通信/感知/规划/反思及前端、WestWorld说明 |
| [修仙世界模拟器](https://github.com/4thfever/cultivation-world-simulator) | `471fe745e7c3d582048d647257c74ae566cd235f` | 根LICENSE为CC BY-NC-SA 4.0，GitHub检测为Other | README、LICENSE、世界/移动/吐纳/突破/模拟阶段、地图渲染与事件面板、web package |
| [PawzoChat](https://github.com/iwyxdxl/PawzoChat) | `d62e2a31612d24d3d5a90cf075d50992fb2ff9b5` | AGPL-3.0 | README、LICENSE、个人/群记忆服务、群聊/动态服务及memory UI |
| [AIcove](https://github.com/kuobibulaien/AIcove) | `fde9d03291d2d825ba2b7359b9257f6ed3c85dff` | 仓库API未声明许可，根LICENSE 404；子组件许可证不代表整个项目 | 论坛正文、README、Flutter pubspec与文件树 |

文件树经GitHub API读取，五库均固定commit后从raw地址抓取所选文件。原始材料在`.cache/play-replan-20261107/`，41个下载文件的SHA256清单为`evidence-manifest.json`。只读文件进入任务缓存，不加入产品依赖。

## 1. InfiPlot：真正的剧情播放器

直接源码：

- [components/PlayCanvas.tsx](https://github.com/zonghaoyuan/infiplot/blob/a60e18bc663caaa134d9323a2b89159b7cc9bd05/components/PlayCanvas.tsx)：`Beat`/`BeatChoice`，`loading-first`、`ready`、`transitioning`等阶段，按Beat选择旁白/台词，打字机、继续/选择、自由输入、历史回看。
- [app/[locale]/play/page.tsx](https://github.com/zonghaoyuan/infiplot/blob/a60e18bc663caaa134d9323a2b89159b7cc9bd05/app/%5Blocale%5D/play/page.tsx)：场景与访问过的Beat列表、分支选择、预测生成池，`PREFETCH_MAX_DEPTH=3`。这不是STE需要默认采用的成本策略。
- [lib/persistence/localStore.ts](https://github.com/zonghaoyuan/infiplot/blob/a60e18bc663caaa134d9323a2b89159b7cc9bd05/lib/persistence/localStore.ts)：本地剧情进度存储，配合场景/Beat而非只保存一串气泡。

纠偏：该项目主Canvas接收生成的`imageUrl`，并非证实“固定背景＋全部角色独立精灵层”是唯一实现。多模型实时CG、配音、视觉点击与预测生成是它的具体方案；STE可以保留场景/分镜/分支模型，以本地背景/立绘实现第一版，不承诺同等实时生图体验。README的“全球首个”为项目自述，本轮未验证该排名。

## 2. OpenStory：Agent生命周期，非轮流群聊

- [README](https://github.com/ZJU-LLMs/OpenStory/blob/3e4857a07ec141a9ed6d3be586dd5d3c573ae389/README.md)明确使用Agent-Kernel，提供红楼梦、WestWorld、WorldKernel；描述自由/剧情、回溯、人物地图与动态增删。部署要求Python、Redis等，不能称为一个可直接塞入React的轻量组件。
- [BasicPlanPlugin.py](https://github.com/ZJU-LLMs/OpenStory/blob/3e4857a07ec141a9ed6d3be586dd5d3c573ae389/examples/WorldKernel/plugins/agent/plan/BasicPlanPlugin.py)基于档案、记忆、关系与可访问地点生成长期目标/12时段计划，有解析、规范化和fallback，不是每回合只要求“请下一位发言”。
- [BasicReflectPlugin.py](https://github.com/ZJU-LLMs/OpenStory/blob/3e4857a07ec141a9ed6d3be586dd5d3c573ae389/examples/WorldKernel/plugins/agent/reflect/BasicReflectPlugin.py)处理短期总结、任务完成/调整、剩余计划重排；这些可能产生额外调用，成本不能只算对白。
- [BasicMovePlugin.py](https://github.com/ZJU-LLMs/OpenStory/blob/3e4857a07ec141a9ed6d3be586dd5d3c573ae389/examples/WorldKernel/plugins/action/move/BasicMovePlugin.py)检查地点访问权限、更新逻辑位置，返回`route_resolution: frontend`；注释明确不推理路线几何。不能据此宣称其世界内核已做真实路径时间/地形代价。
- [BasicCommunicationPlugin.py](https://github.com/ZJU-LLMs/OpenStory/blob/3e4857a07ec141a9ed6d3be586dd5d3c573ae389/examples/WorldKernel/plugins/action/communication/BasicCommunicationPlugin.py)按发送者/接收者排消息；[BasicPerceivePlugin.py](https://github.com/ZJU-LLMs/OpenStory/blob/3e4857a07ec141a9ed6d3be586dd5d3c573ae389/examples/WorldKernel/plugins/agent/perceive/BasicPerceivePlugin.py)将入站消息加入短期记忆。

STE采用生命周期和“不同角色知道不同信息”的产品原则。首版单进程Worker即可，地图可达/耗时、资源冲突和最终Prompt隔离需要自己明确实现，不能借参考项目名称代替保证。

## 3. 修仙世界模拟器：规则是世界，文本解释世界

- 原贴：[LINUX DO 2439437](https://linux.do/t/topic/2439437)。本轮未抓取其全文，使用用户笔记及已直接核验的仓库。
- [README](https://github.com/4thfever/cultivation-world-simulator/blob/471fe745e7c3d582048d647257c74ae566cd235f/README.md)将玩家定位为天道，规则和AI共同驱动；项目不只有头像地图，还有领域系统及查询/受控写接口。
- [phases/actions.py](https://github.com/4thfever/cultivation-world-simulator/blob/471fe745e7c3d582048d647257c74ae566cd235f/src/sim/simulator_engine/phases/actions.py)：仅给没有当前动作/待执行计划的非接管人物补决策，再提交计划、推进动作；局部连续动作有上限，防止同月无限执行。
- [breakthrough.py](https://github.com/4thfever/cultivation-world-simulator/blob/471fe745e7c3d582048d647257c74ae566cd235f/src/classes/action/breakthrough.py)：条件、冷却、成功率夹紧、随机判定、突破/失败折寿与HP改变均在代码中处理。所读实现使用Python `random`，本轮未证明它具有跨版本确定性回放。
- [useMapLayerRenderer.ts](https://github.com/4thfever/cultivation-world-simulator/blob/471fe745e7c3d582048d647257c74ae566cd235f/web/src/components/game/composables/useMapLayerRenderer.ts)：Vue＋Pixi，地形纹理、海水层、区域标签和Ticker清理；不是一个背景图上随意摆几个名字。
- [EventPanel.vue](https://github.com/4thfever/cultivation-world-simulator/blob/471fe745e7c3d582048d647257c74ae566cd235f/web/src/components/game/panels/EventPanel.vue)：地图之外独立事件面板，配合世界查询与事件流。

STE采用行动与结算的分离、地图位置与事件因果。数值、地图设计和美术自行实现；[根LICENSE](https://github.com/4thfever/cultivation-world-simulator/blob/471fe745e7c3d582048d647257c74ae566cd235f/LICENSE)有非商业/相同方式共享约束，不能按普通宽松开源项目直接拷入STE的AGPL发行。此项是实际文件证据带来的边界，不以“开源”两字概括许可。

## 4. PawzoChat：可见的记忆和有节制的社交

- 原贴：[LINUX DO 2673809](https://linux.do/t/topic/2673809)，本轮未抓取全文。
- [group_chat.py](https://github.com/iwyxdxl/PawzoChat/blob/d62e2a31612d24d3d5a90cf075d50992fb2ff9b5/pawzochat/services/group_chat.py)定义串行有预算的群聊runner，显式@优先、概率候选、每人记忆开关、成员变动后的revision处理。
- [memory.js](https://github.com/iwyxdxl/PawzoChat/blob/d62e2a31612d24d3d5a90cf075d50992fb2ff9b5/pawzochat/web/static/modules/memory.js)有私聊/群聊视图、记忆卡、编辑抽屉、fingerprint冲突检查和删除；已读代码没有证明每一条记忆都自带Switch。群成员`memory_enabled`与逐条启停是两种能力。
- [group_memory.py](https://github.com/iwyxdxl/PawzoChat/blob/d62e2a31612d24d3d5a90cf075d50992fb2ff9b5/pawzochat/services/group_memory.py)和个人memory服务分别处理记忆；[moments.py](https://github.com/iwyxdxl/PawzoChat/blob/d62e2a31612d24d3d5a90cf075d50992fb2ff9b5/pawzochat/services/moments.py)与README支持动态、评论及记忆联动。

STE借鉴人物持续性、社会事件和可修正的记忆。好友动态是沙盘事件的一种展示，不能为了复制朋友圈而另起不受世界约束的隐形后台。QQ/微信与语音不是本轮目标。

## 5. 第五个项目已识别为 AIcove

- [原贴](https://linux.do/t/topic/3007541)已通过Context读取，正文明确项目为AIcove、Flutter、纯色/模糊/玻璃材质、块状文档与聊天气泡两种展示、AI主动安排回复时间；不是无名的“全平台客户端”。工具返回compact正文有截断，因此未声称读完评论。
- [GitHub](https://github.com/kuobibulaien/AIcove)、[固定README](https://github.com/kuobibulaien/AIcove/blob/fde9d03291d2d825ba2b7359b9257f6ed3c85dff/README.md)描述本地数据、核心印象/往事日记、酒馆导入、语音/图片及主动消息。
- [pubspec.yaml](https://github.com/kuobibulaien/AIcove/blob/fde9d03291d2d825ba2b7359b9257f6ed3c85dff/apps/aicove_flutter/pubspec.yaml)确认Flutter及Riverpod等依赖。不能由这些资料得出已测启动快、内存小或所有平台等价的结论。
- 仓库API `license=null`，根LICENSE不存在；文件树可见子组件LICENSE，不等于整体授权。本轮仅参考阅读路径和交互取舍。

## STE本地证据与新旧方案关系

本轮开始时仍为`codex/playtest-20261031 / 01686330ad5e64b2ec2f90e257dabe813afbf7f1`，回退后2065项源码输入与11月6日构建清单一致。旧批95个新增文件已封存，不能把缓存里的旧类名当作当前模块。

- `src/pages/Roleplay.tsx`约294行实际渲染酒馆iframe。
- `src/components/roleplay/RoleplayWorkspace.tsx`注释/实现为每Vault保留一个live chat，跨路由保留；新世界不能绕过这个生命周期导致隐藏双写。
- `vendor/tauritavern/src/script.js:641`初始化`chatElement`；约5093行`Generate`及其内部依赖DOM输入和消息渲染。这直接否定“一句headless即可全兼容”的假设。
- `provider.ts`已有模型请求准备与Tauri传输，可复用；它自身不提供世界规则、角色调度或地图状态。
- `runtime-store.ts`绑定storyId和运行路径白名单；新WorldRepo需要真正接入Vault/IDB，而不是把世界存储冒充聊天缓存。

设计交互样稿不使用外部项目图片、字体、脚本或模型。它只解释所提议的空间布局和因果操作。方案批准、代码实施、测试通过、用户认可与发布继续分别记录。
