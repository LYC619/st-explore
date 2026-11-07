# 沙盘优先重规划 v3 交接

2026-11-07 · Codex · 当前仓库供用户与Antigravity读取，不投递其他会话。

后续决定：用户已正式批准v3，授权Batch 0＋1实施，现已交付独立规则沙盘源码。以下保留本次规划交接时的历史状态；最新授权、实施与验证以[实施记录](2026-11-07-play-world-b01-execution.md)及[核验](../verification/2026-11-07-play-world-b01.md)为准。

用户补充五个参考项目链接和原图线索，要求重新制定方案，并明确首个体验目标为“沙盘世界模拟：地图、角色自主行动、事件与干预”。本次仅方案；旧方案的实施授权不沿用，新稿未批准，不创建或恢复实施Goal。

## 本次交付

- [主架构](../superpowers/plans/2026-11-07-play-world-v3.md)：原生世界引擎、独立会话、硬规则与叙事边界、角色信息隔离、记忆双视图与状态分层、ST兼容通道。
- [分批计划](../superpowers/plans/2026-11-07-play-world-batches.md)：0交互原型→1规则沙盘→2角色智能/记忆→3冒险/休息室→4GAL/兼容→5平台收尾；每批文件、接口、实际入口与产品验收。
- [参考核验](../superpowers/plans/2026-11-07-play-world-references.md)：五库固定commit、41文件、原图直接观察、转述纠偏和许可边界。
- [交互样稿](../superpowers/plans/2026-11-07-play-world-concept.html)：原创SVG地图＋固定晴/雨分支、12个人物、追踪/事件定位/拖图缩放、桌面与手机布局。不是正式游戏、不是AI模拟，不连接真实资料库。

## 已知结论与需联合审阅的建议

ST当前Generate/流式渲染依赖DOM，隐藏iframe不能直接称纯无头且全扩展兼容。建议世界运行原生WorldCore，复用STE模型/Vault/资产服务，标准聊天仍保留ST；GAL独立舞台，ST适配经实际MVU/助手/SPreset探针后逐项声明。

用户已选沙盘优先；12角色、6～8区域、独立世界存档、单Worker规则包及预算是本稿推荐，仍待联合审阅。跨作品角色和世界书先提取为有来源的映射，不自动把设定文字当规则。记忆是已发生事实/角色所知/人工约束/回顾的可视化，不再复制整楼注入。

修仙仓库根许可为CC BY-NC-SA 4.0；AIcove尚未确认仓库级许可。方案仅借鉴机制与交互，不分发其代码/美术。InfiPlot当前使用Scene/Beat与imageUrl，不把分层立绘描述为已核实的唯一方案；PawzoChat逐条记忆Switch未在所读UI证实，保留为STE自己的需求。

## 本次验证及边界

- 读取笔记原文和`2.STE参考.png`，未改笔记库。
- GitHub获取固定源码；原始材料和哈希在`.cache/play-replan-20261107/evidence-manifest.json`，未运行参考项目。
- standalone HTML在真实Edge浏览器检查12人、晴天路径、雨后改道/相遇、390px无横向溢出、事件展开与44px控制，零pageerror；桌面曾发现grid内容撑高，已补min-height并复验视口高度。该证据只针对样稿，不是STE/Android/模型验证。
- 样稿截图为`.cache/play-replan-20261107/concept-desktop.png`与`concept-mobile.png`；测试记录`concept-check.json`。
- 所有产品源码与11月6日2065项清单复核一致；未重新运行产品测试、未改依赖、未打包或发布。

下一步应联合审阅本版范围和首个玩法验收；未获得本版实施授权前，不从被撤回缓存恢复任何功能，也不把设计演示算作Batch 0完成。
