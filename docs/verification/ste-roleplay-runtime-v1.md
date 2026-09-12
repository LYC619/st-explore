# STE 角色扮演运行时：实现与验证记录

记录日期：2026-09-12。实现位于本地分支 `codex/ste-roleplay-runtime`，起点 `25c2ddad5ed5d91940509c58310f43b55f3b9430`，最终集成提交 `2617234`。原工作区的用户修改保留，未合并或发布。

当前状态：本地实现、自动化验证和 Windows 试玩程序构建已完成。16 项浏览器流程均有通过记录；物理 WebView2、Android 和远端模型仍按下文保留为未验收范围。

## 可以怎样使用

角色页点击 **新开聊天**，或打开已有故事后点击 **开始游玩**。游玩页加载真正的 ST 界面。扩展抽屉的 **STE 游玩与记忆** 可选择无 Agent 或 Agent，两者保存同一份故事。具体操作见[使用说明](../guides/roleplay.md)。

Agent 会在发送时自动查阅世界书和 Markdown 记忆，将资料与叙事提醒交给主模型；主模型继续接收窗口内的长历史。事实记忆在成功回复保存后维护。分支继承有效来源，世界书更新以待接受的新版本保留。

内置助手开放有限的脚本、变量、事件、消息和辅助生成接口；实际柏宝书 1.2.7 的非向量功能通过固定版本适配。范围见[兼容说明](../principles/extension-compatibility.md)。

## 固定环境与来源

| 项目 | 本次使用值 |
| --- | --- |
| 操作系统 | Windows 11，10.0.26200，x64 |
| 本机资源 | Intel Core i5-13500H，约 16 GiB RAM |
| Node / npm | 22.14.0 / 10.9.2 |
| Rust / Cargo | 1.97.1 / 1.97.1 |
| HTTP 插件 | JavaScript 与 Rust 均固定为 2.6.0 |
| Playwright | 1.63.0，Chromium headless shell，单 worker，1360 × 900 |
| TauriTavern | 2.2.0，提交 `9693a4ec47cd4552f90878bccab453f176de0f18` |
| 对应 SillyTavern | 1.18.0 |
| 柏宝书 | 1.2.7，提交 `5c8a6b60d8c1185e169c46d43f63fce7d35d8583` |

1,137 个上游原文件保持原字节；实际接入由哈希校验后的覆盖层生成。开发和生产使用同一资源映射。柏宝书测试读取固定原包，不将插件代码放入生产资源映射。来源和授权记录见[第三方说明](../third-party/roleplay-runtime.md)。

浏览器测试使用本机 HTTP 模型夹具：它返回可重复的流式正文、错误、延迟片段与工具调用。没有读取用户密钥或消费远端模型额度。这可以验证请求、调度、保存和界面行为，不能证明真实模型的创作质量。

## 检查结果

后续更新：本记录保留首次接入时的结果；新版程序及实际 Windows 窗口验证见 [2026-09-12 聊天体验修复记录](ste-roleplay-ux-repair.md)，其中已补上本记录当时未完成的 Windows 保存、返回与关闭验收。

以下命令均从独立工作树根目录运行；Windows 使用 `npm.cmd`、`npx.cmd`。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 全部单元与组件测试 | `npm run test -- --reporter=dot --maxWorkers=2` | 196 文件，1,785 测试通过，192.01 秒 |
| 固定上游及构建边界 | `npm run test:tavern-source` | 48 通过，0 失败 |
| 应用类型 | `npx tsc -p tsconfig.app.json --noEmit` | 通过 |
| 构建配置类型 | `npx tsc -p tsconfig.node.json --noEmit` | 通过 |
| 版本一致性 | `npm run version:check` | 0.9.1 同步 |
| 静态检查 | `npm run lint` | 0 错误，1 个既有警告 |
| 实际浏览器 | `npm run test:roleplay -- --reporter=line`；柏宝书以 `--grep 'real BaiBai'` 复跑 | 完整轮次 15 通过；修正重开就绪检查后，柏宝书定向复跑通过（1.4 分钟） |
| Rust 单元测试 | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 依赖对齐后复跑：42 通过，1 忽略，0 失败 |
| 生产前端与本地 Windows 程序 | `npm run tauri -- build --debug --no-bundle` | 通过；Vite 24.83 秒，Rust 构建 1 分 50 秒 |
| Git 空白检查 | `git diff --cached --check` | 包括新增代码/测试在内通过 |

既有 ESLint 警告在 `src/test/asset-navigation-test-support.tsx:73`，为 React Fast Refresh 的组件导出提示。忽略的 Rust 用例 `file_mutations_reject_file_and_ancestor_links` 需要 Windows 符号链接权限；junction 路径检查用例正常运行。

首次全量 Vitest 使用默认 worker 并同时运行来源/类型检查时，3 个现有界面套件出现 5 秒超时及后续控件缺失，共 5 项失败。没有修改这些断言或提高超时；改为上述两个 worker、独立运行后全量通过。浏览器性能测量独立执行，避免同时构建造成的负载干扰。

完整浏览器轮次中，柏宝书重开后的摘要检查在原版扩展加载完之前用尽 20 秒。追踪显示原聊天已恢复，扩展初始化仍在进行。重开步骤补上与首次安装一致的插件界面就绪检查，再验证摘要、台账、候选与维护者切换，定向复跑通过；应用代码没有为此改变。其余 15 项的通过记录与性能产物保留。

第一次原生打包发现 JavaScript HTTP 插件 2.6.0 与 Rust 2.5.9 不同系列，已将两端固定为 2.6.0，更新对应 Cargo 锁并重新构建、复跑 Rust 测试。前端仍有大于 500 kB 的 chunk 提示；Roleplay 懒加载块约 3.19 MB（gzip 1.54 MB）。链接器输出了一条创建导入库的提示，构建正常完成。

## 实际浏览器覆盖

浏览器通过原文档和真实 ST 模块操作，模型服务为上述本地夹具。

1. 打开现有故事、流式发送、保存、返回和重开，保留已有消息 ID。
2. 故意延迟欢迎面板模板，确认迟到模板不会插入当前故事。
3. 只有角色、没有存档时新开聊天，原生开场白保存一次，重开无重复。
4. Agent 自动读取未被关键词命中的绿灯条目，检查实际 Writer 请求、冻结前缀和保存后的来源记忆。
5. 无 Agent 的故事关联预设、深度世界书、宏及原版正则编辑，核对最终请求和原数值 placement。
6. 内置助手的脚本/聊天/楼层变量、权限撤销、工具连接、HTML 交互，以及 50 次重载清理。
7. 原版抽屉导出完整故事包，在 STE 资料库预览并恢复分支与记忆。
8. 原聊天列表导出 JSONL；从角色导入按钮跳转 STE，先保存未结束的编辑。
9. 2,000 楼样本的虚拟渲染、81 段流式回复写入量、Agent 请求大小和本地耗时。
10. 已有候选切换与原消息编辑保留稳定身份和候选扩展字段。
11. 停止实际 SSE 请求，重新打开时保留被采用的部分正文。
12. 浏览器 Back 在离开前完成当前消息编辑。
13. 持久化失败时留在聊天，恢复写入后重试且正文保留。
14. 原版分支命令、URL 重开、有效记忆/版本继承，以及只在子线继续生成。
15. 刷新后恢复输入框和未提交编辑，草稿不被当作已生成事实。
16. 实际柏宝书安装、连续四轮摘要与隐藏、台账、重开、候选归属及自动维护者切换。

文件/队列层另有冲突、回滚、切库 epoch、来源失效、日志恢复、导入事务和桌面暂存发布测试。助手真实 host/client 最小桥覆盖写入回滚、异步 updater 的值/候选冲突，以及 30 秒辅助生成不会被 5 秒事件截止误判。

## 长聊天与生命周期测量

本轮原始记录：[长聊天 JSON](ste-roleplay-long-story.json)、[50 次重载 JSON](ste-roleplay-helper-lifecycle.json)。[实际原版聊天界面截图](ste-roleplay-runtime-classic.png)使用同一浏览器和测试角色。

| 指标 | 实测 |
| --- | --- |
| 逻辑消息数 | 2,000 |
| 打开至末楼与模式控件可用 | 12,482 ms，开发服务器环境 |
| 当前挂载的消息 DOM | 7 |
| 连续 SSE 正文片段 | 81 |
| 该次回复期间 `archiveStories.put` | 2 次，分别为 2,001 / 2,002 条消息 |
| 工具 Agent 的三次请求体 | 4,397 / 4,808 / 4,969 字节 |
| 无 Agent / Agent 的 Writer 请求消息数 | 741 / 664，所选窗口为 32,000 token |
| 助手重载 50 次的监听器总数 | 88 → 88，逐事件数量也完全相同 |
| 助手脚本 / HTML iframe | 1 / 1 → 1 / 1 |
| 待处理 RPC / 事件等待者 | 前后均为 0 / 0 |
| 返回故事后的页面 frame 数 | 1，仅顶层 STE 页面 |

首次打开 12.5 秒是本次开发环境的基线，尚不作为速度优化完成的依据。Writer 请求受用户设置的窗口与资料预留限制，并非把 2,000 楼全部塞入 32k 窗口；工具请求没有携带全量历史。

长聊天指标将本地 UI/传输夹具总耗时与远端模型能力分开：夹具立即返回结果，时间不是某个真实模型的首字延迟。虚拟列表只减少挂载的 DOM，逻辑聊天仍保留全部楼层。写入统计只计算 `archiveStories` 的 put，不把它误称为全部记忆/配置文件的 I/O。

监听器在真实保存完成后统计总数和逐事件计数。原版 PromptManager 每次加载聊天会等待 `SETTINGS_UPDATED`；快速重载会推迟防抖保存，未完成保存时的临时等待者不能当作已确认泄漏。测量保留该事件并核对保存后的总数。

## 构建与复现

已有依赖时运行 `npm run dev` 即可本地打开。全新检出先执行 `npm ci`，上游资源准备由 Vite 自动处理，不在 vendor 目录内安装另一套应用。

```powershell
npm.cmd ci
npm.cmd run tavern:baibai-fixture
npx.cmd playwright install chromium
npm.cmd run test -- --reporter=dot --maxWorkers=2
npm.cmd run test:tavern-source
npm.cmd run test:roleplay -- --reporter=line
npm.cmd run tauri -- build --debug --no-bundle
```

本机使用已安装的浏览器，通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指向其可执行文件；其他机器安装对应 Playwright Chromium 后可省略该环境变量。运行浏览器套件时保持端口 4178 空闲。

Windows 程序：`src-tauri/target/debug/STE.exe`，49,281,024 字节。SHA-256：`8A51FDC7AA85DFAB178D22E8A9F70BCE0A71453E5797D66FA328BC17DE036F75`。本地 debug 程序用于试玩；未生成安装包、未安装或启动程序，也不等于已进行物理 WebView2 测试。编译输出在 Git 忽略目录中，源码检出后可用上述命令重建。

## 尚未验收的范围

- Windows WebView2 实际窗口与原生关闭、Android 真机/返回键/文件权限，以及移动屏幕体验。
- 远端服务商的真实工具协议、缓存命中、网络延迟、长对话成本和生成质量。
- 真实长剧情中的事实遗漏、角色知情范围、文风、伏笔连续性，以及 ST 老用户的操作体验。
- 群聊、其他模型后端、自定义背景/用户头像上传、插图、TTS、完整扩展市场。
- 柏宝书向量检索、Horae 迁移、复杂多层压缩及全部高级设置；完整 JS-Slash-Runner API。

这些项目继续作为发布前验收或后续范围。当前测试结论只覆盖本记录列出的平台、版本和流程。
