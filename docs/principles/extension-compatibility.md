# 游玩前端与扩展兼容范围

更新日期：2026-11-04。兼容结论按具体版本和功能限定；原版助手、SPreset／完整 MVU、用户成品 HTML 已在正式 Windows 包中配合真实模型验证，Android 仍需真机验收。

## 原始前端

固定 TauriTavern `9693a4ec47cd4552f90878bccab453f176de0f18`，版本 2.2.0 / SillyTavern 1.18.0。STE 加载它的实际文档、脚本、样式、事件与聊天状态。原始文件保留，接入代码由经过哈希校验的覆盖层生成。

| 能力 | 接入情况 |
| --- | --- |
| 流式发送、停止、消息编辑、已有候选切换 | 已做浏览器回归，保存回同一 ArchiveStory |
| 聊天列表、新聊天、重命名、搜索、分支 | 接入 STE 角色和故事目录；分支保留 URL 身份 |
| Chat Completion 预设 | 读取/编辑 STE 预设，沿用原提示词组装 |
| 世界书 | 原编辑器和经典扫描；故事关联世界书也参与；Agent 选择动态资料 |
| 正则 | 原 JS 执行器和编辑器；保留数值 placement、未知字段；WI placement 为 5 |
| 角色编辑 | 写回 STE 原角色；PNG 元数据同步；旧编辑版本冲突检查 |
| JSONL / 文本导出 | 原聊天列表入口；JSONL 保留候选与扩展字段 |
| 角色/聊天/世界书导入、角色卡导出 | 原按钮转入 STE 对应管理页，先完成游玩保存 |
| 用户设定与头像 | 新建、上传、列出、删除及重新打开后恢复；5 MB 以内 PNG/JPEG/GIF/WebP |
| 自定义提示词后处理 | 原版 merge/semi/strict/single 及 tools 变体；Agent 补充资料后同样处理 |
| 其他模型后端、群聊、自定义背景 | 未接入；不声明原 ST 全功能兼容 |

## 原版酒馆助手 4.11.3

在扩展抽屉的「原版扩展 · 酒馆助手」下载并选择已验证的 ZIP 安装，重新加载后使用原版脚本库、编辑器、前端渲染和公共接口。内置助手同时停用，其旧配置保留。顶部「脚本」按钮转到原版面板。

已回归原版 ZIP 安装、ChatSurface 注册与聊天显示、公共 API 加载、聊天变量写入与刷新恢复；新建用户设定和普通预设导入也通过同页回归。此版本上游程序完整保留，底层可调用范围仍取决于 STE 接入的 ST 路由；角色/聊天导入和文件管理使用 STE 入口，任意 Git 扩展市场、其他插件和原生系统功能不声明兼容。

「Agent Skills」是 TauriTavern 附带技能元数据，区别于酒馆助手脚本。普通预设不再因缺少此可选 API 报错；带技能的预设仍保留技能数据并提示暂不执行，未伪装安装成功。

## 成品前端与本批验证

11 月 4 日新增成品工作台后，原版助手仍负责完整脚本执行；后文的内置接口限制不套用到原版助手。成品工作副本按故事／分支应用，启用脚本使用独立运行 ID，脚本自己的变量回写分支 applied 副本，不留在全局脚本设置。明确应用的正则无需重复启用，普通源卡规则保留原开关。来源、草稿和已应用副本分别保存，分享故事包不自动包含可执行 frontend.json。

本批实际加载 Reborn2.3 SPreset 的作者远程脚本、MagVarUpdate 原版 bundle 和用户柏崎星奈 schema，验证公开接口、生成钩子、JSONPatch 更新、归档和刷新恢复。早前浏览器回复为夹具；后续正式 Windows 包已用真实模型完成工具调用、SPreset 提取正文、MVU 更新和双包重开恢复，见[原生组合补测](../verification/2026-11-04-native-integrated-playtest.md)。预览只使用隔离的兼容读取接口，完整 MVU 在聊天运行，不自动改主世界书或重置变量。详见[统一批次验证](../verification/2026-11-04-frontend-unified-playtest.md)。

## 内置助手

API 设计参考酒馆助手 4.9.5 的公开接口与脚本 JSON 结构，固定参考提交 `cd9f523d08d147057043b9939397de8a61be91e4`。实现为 STE 自有代码，不包含该项目源码。

| 接口 | 当前范围 |
| --- | --- |
| `getChatMessages` | 数值范围、负数楼层、角色/隐藏过滤；可读取所有候选 |
| `setChatMessages` | 修改 `message/data/extra/is_hidden`；检查来源和被替换字段的基线 |
| `getVariables / replaceVariables / updateVariablesWith` | chat/message/global/本脚本 script；快照同步读取，异步保存；陈旧异步 updater 不覆盖新值 |
| `insertVariables / insertOrAssignVariables / deleteVariable` | 使用同一变量与持久化路径 |
| `flushHelperWrites` | 等待本脚本写入，返回写入错误 |
| `eventOn / eventOnce / eventRemoveListener / eventClearAll / eventEmit` | 真实 ST 事件桥；自定义事件；不能伪造 ST 生命周期 |
| `getButtonEvent / getScriptId / getCurrentMessageId / getLastMessageId` | 脚本或楼层作用域内可用 |
| `substitudeMacros` | 同步 user/char/lastMessageId/getvar/getglobalvar |
| `steSubstituteMacros` | 异步调用原 ST 宏展开 |
| `triggerSlash` | 单条 pass/echo/getvar/setvar/addvar/incvar/decvar/getglobalvar/setglobalvar/len/trim |
| `generate / generateRaw` | 非流式文本；使用 STE 工具连接；不允许覆写连接或递归调用角色 Agent |

脚本最多保存 32 个、同时启用 8 个。单脚本或变量对象上限 512 KiB。HTML 最多同时运行 8 个可见区域内的子页面。脚本置于不共享父页面来源的 iframe，通过获准的快照/RPC 访问资料，不获得原生文件或连接密钥。

外部模块、jQuery、任意父页面 DOM、完整世界书 API、流式助手生成、图片生成与自定义模型配置不在首版接口中。脚本 JSON 导入不会继承启用状态或能力授权。分支和完整故事包不自动复制可执行助手配置。

## 柏宝书 1.2.7

固定提交 `5c8a6b60d8c1185e169c46d43f63fce7d35d8583`。安装时核验原版 JS/CSS 哈希，链接到实际 ST 模块、资源与记忆归属检查，保留公开 API。不同版本会拒绝加载。

| 功能 | 实测状态 |
| --- | --- |
| 原版 ZIP 安装、公开 API 与界面加载 | Chromium 通过 |
| 自动摘要、物品/NPC/场景/悬念台账 | 实际插件调用本地模型夹具，数据与重新打开后回读通过 |
| 滑动窗口隐藏与摘要注入 | 连续四轮通过，原始正文保留 |
| 切换候选时摘要有效性 | 真实插件对不匹配候选排除摘要，回原候选恢复 |
| 手工编辑正文 | 保留上游“不会自动重摘”的行为；需要时手动更新摘要 |
| 序列化与完整故事导出 | 真实 `bbs_leaf` 数据保留，重新打开后可派生台账 |
| 自动维护归属切换 | baibai/native-agent/none 互斥；撤销插件接管的隐藏并保留接管前手动隐藏 |
| 向量检索、Horae 迁移、复杂压缩层级与全部高级配置 | 未验收；不声明支持 |

非向量摘要通过原 ST quiet generation，路由到 STE 工具模型。完整备份保存用户已安装的包；可分享故事包省略可执行包，接收者需要自行安装同一版本。

柏宝书沿用上游摘要策略；STE 原生文件记忆使用正文来源校验。两者在“编辑后何时失效”的行为上不同，不能把原生 Agent 的保证套在插件上。

来源和分发边界见[第三方说明](../third-party/roleplay-runtime.md)。

2026-11-07 多态模式试验及其新增分发资源已撤回，历史来源与核验记录保存在[回退记录](../verification/2026-11-07-multimode-rollback.md)及其关联档案。原有扩展机制不受影响。
