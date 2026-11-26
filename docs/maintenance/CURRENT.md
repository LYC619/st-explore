# ST Explorer 当前状态

## 2026-11-26 国际化与公开交付已合入 main、推送远端 CI 并打出新免安装包（待用户验收）
- 已完成 `F1–F7` 全部补修、去过度防御瘦身及打开故事草稿防冲掉保护（`ba7b570`）：4,984 条英文词条 / 6,016 处调用，统一 `Lorebook`、`Standby`、`Chat styling`，保持内部枚举/标签键/预设导出路径跨语言一致，支持 `?lang=` 深链持久化、零环境变量 `docker compose up` 与 Nginx 全路由安全头。
- 完整 `verify` 12/12（`verify:web` 10/10 含 340 文件 / 2,734 前端单测、Rust 66 + Clippy）、`cap sync android`、生产浏览器 E2E 14/14、内嵌酒馆与分屏 E2E 62/62（1 原有跳过）全绿。已打出干净免安装包 [2026-11-26-i18n-and-delivery](../../release/2026-11-26-i18n-and-delivery/使用与体验更新.md)（构建 `ba7b570b4e6f`，`dirty:false`，`packaged-not-run`），快进合入 `main` 并推送 `origin/main`；未升版、未打 `v*` 标签、未发公开站。见[审查与收口记录](../reviews/2026-11-26-gemini-i18n-review.md)、[执行记录](2026-11-26-international-release.md)。

## 2026-11-23 R1–R9 已提交并打出干净免安装包，待用户验收
- 修复与正式回归 `24d97c7`；原生复验补修 WebView2 空白外壳 `053bf99`，保留既定 0.9 交互。见[执行与证据](2026-11-23-gemini-review-fixes.md)、[原审查](../reviews/2026-11-23-gemini-ux-review.md)。
- 完整 verify 11/11、酒馆／分屏 E2E 62 通过／1 原有跳过、生产 Web 7/7；原生补修后 Rust 66／Clippy 通过，干净隔离包最终 6 组通过，退出码 0、9 进程无残留。子窗 Esc／遮罩用 DOM 事件，物理焦点及 Android 未验。新免安装包 dirty:false、packaged-not-run；未合并／推送／升版。下方为历史交付。

## 2026-11-23 实测反馈 6 项回退与原生独立酒馆窗口修复已完成并打出新免安装版（待用户验收）
- 在 `refactor/ux-and-polish` 分支针对用户实测 `ff43df8` 免安装包的 6 项反馈完成回退与根治（`b22a1e1`）：① 统一「回味／阅读整理／搜索故事」直达当前大屏聊天处理工作台 `/chat?storyId=...`（支持已绑定与未绑定故事、支线切换、跳楼聚光灯与分屏只读实时同步）；② 回退每楼重复「☆ 收藏本楼」与 `⋯` 折叠菜单，恢复直列「收录／隐藏／编辑」；③ 聊天处理页桌面默认展开正则侧栏并记忆开合状态，默认阅读纸宽改为自适应；④ 按 `29b8076` 回退角色页故事行（恢复阅读／处理／继续聊天／导出／重命名／删除／复制故事及页内 `InlineStoryReader`）、关联资产抽屉速览与角色库可拖宽筛选栏，完整保留角色头顶装备微章、人设就地写回及第三批预设库与世界书全部重整成果；⑤ 独立原生复现并根治 Tauri WebView2 点击进入酒馆时的 `open-story-*.js` 动态导入报错，为主窗口接入原生 `on_new_window` 同源子窗口与关窗回收；⑥ 聊天大厅首屏恢复「山海之间」渐变大横幅。
- 独立原生包 `com.ste.explorer.regression` 实测原生子窗口 `tavern-detached-1` 酒馆加载、回味跳转与关窗退出全绿；完整 `verify` 11/11（332 文件 / 2,705 Vitest、64 宿主脚本、66 Rust + Clippy）、生产 Web E2E 7/7、内嵌酒馆与分屏及归档流 E2E 57/57（1 原有跳过）全部通过。已生成新免安装包 [2026-11-23-ux-and-preset-fix](../../release/2026-11-23-ux-and-preset-fix/使用与体验更新.md)（构建 `b22a1e1bb8c8`，`dirty: false`，未启动正式程序）；未合并 `main`、未推送远端、未打安装器，待用户桌面验收。见[执行记录](2026-11-22-ux-and-preset-overhaul.md)。

## 2026-11-21~22 五阶段加固已推送、远端CI全绿并打出双包（待用户桌面体验验收）
- 五阶段源码已按序独立提交（`4c4c23b` / `90cb71c` / `f780cee` / `2e6c352` / `689b19e`）并推送 `main`；远端 CI `44932865934`（`web` + 新增无头 `e2e` + `rust`）全部通过。本地同步验证真实内嵌酒馆 Playwright 7/7、生产 Web E2E 7/7、`npx cap sync android` 及全量 `verify` 通过，并已生成[2026-11-22 五阶段加固双包](../../release/2026-11-22-five-stage-hardening/使用与体验更新.md)（构建 `689b19e723b5`，`dirty: false`，未启动正式程序）。尚未打 `v*` 发版标签、远端发布或用户真机体验验收；原有未提交内容保留。见[执行记录](2026-11-21-five-stage-hardening.md)。

更早的 11月14–20日状态已归档：[本轮开始前状态](history/2026-11-26-current-before-international.md)。执行记录与历史交付保留。

更新：2026-11-26，Antigravity。这里是状态页；过程见执行记录，历史见页末索引。

## 分支、版本与交付

- 当前分支：`main`（已快进合入 `refactor/ux-and-polish` 全部改动并推送 `origin/main`）；恢复时核对实际 HEAD/工作区。未升版、未发 `v*` 标签、未上线公开站。
- 应用版本：`0.9.9`，本轮不提升版本号。
- 最新体验包：[中英双语与公开交付免安装版](../../release/2026-11-26-i18n-and-delivery/使用与体验更新.md)，源码 `ba7b570b4e6f`，`dirty:false`、`packaged-not-run`（37,948,416 字节，SHA256 `7e14632ad2ffeaa86d6f809163a940c99694daefe7bfffa201139fc43ff767ac`），仅免安装，待用户桌面验收。含 NSIS 安装器的历史双包仍为 `2026-11-22-five-stage-hardening`（`689b19e723b5`）。
- 本批仅免安装包，文件大小／SHA256 与清单一致；正式程序未运行。源码、自动检查、隔离原生、打包、用户验收、发布分别记录。

## 现行产品决定

- 定位：本地资料整理与回味，也可继续聊天；世界玩法入口保留，处于实验中，可能大改或撤回。
- ST 来源只读；STE 库、工作副本、导出副本各自独立。删除只针对明确授权的 STE 库内文件。
- 角色删除连同其故事、记录及附件一并回收；共享资产保留，见[删除原则](../principles/character-removal.md)。
- 文件库回收区默认保留 30 天后尝试系统回收；失败继续保留，未勾选删除文件时长期保留。浏览器库没有桌面文件回收区。
- 聊天筛选由当前库的 `libraryTags.chatVisible` 决定，任意标签可开关，显式全关保留；不硬编码整理状态，见[标签原则](../principles/library-tag-views.md)。
- 本轮不改玩法、内嵌酒馆隔离、密钥存放、远程字体、Android、大组件结构，不适配云盘。
- 私密正文只可由酒馆发给用户配置的模型；不得进入 Agent、截图、日志或其他服务。测试只用合成资料／固定响应。

## 未解决问题

| 问题 | 当前结论／下一步 | 依据 |
| --- | --- | --- |
| S4 偶发加载 | 已修复可复现路径，原始偶发触发仍待用户新包验证 | [记录](../verification/2026-11-09-s4-startup.md) |
| S5 关窗 | 合成库关窗通过；未证明原始触发已消失，合并进最终验收 | [记录](../verification/2026-11-09-s5-window-exit.md) |
| 总结失败／被拒 | 统一分类、超时、重试与全部生成入口已实现，合成检查通过；实际生成由用户最终确认 | [执行记录第6项](2026-11-10-closeout-execution.md) |
| 用户桌面配置位置 | Codex 中的 AppData 有重定向，不能替代用户双击环境；两种自检信号实测未识别重定向，界面已撤下位置判断，保留日志 | [更正与边界](2026-11-09-claude-stability-followup.md) |
| 聊天标签、回收站、附件批删 | 自动及独立环境有历史证据，用户桌面集中验收待做 | [附件补修](../verification/2026-11-11-existing-attachment-paths.md) |
| Android | 无真机，本轮不验证 | [原生测试边界](../guides/native-test-isolation.md) |

## 本轮交付与后续

- **收口与可靠性方案第0–13项已完成或按计划记录回退**：[最终报告](../verification/2026-11-12-closeout.md)。完整verify、浏览器56+4项及独立原生9组通过，双包已生成；共享阅读档案和交接核查完成，本轮goal收尾。后续由Claude审查及用户集中实测，不自动继续未授权发布。
- 旧藏整理／合并已独立收尾，本轮不继续；相关私密历史仅在本机 `docs/private/` 保留。
- 第4、8、11项检查点均未收到追加文件；第13项已完成，未纳入后续追加项。内嵌酒馆安全边界的选择仍留用户另行决定。

## 记录索引

- [国际化与公开产品交付执行记录（main 最新）](2026-11-26-international-release.md)
- [体验减负与预设重整执行记录（refactor/ux-and-polish）](2026-11-22-ux-and-preset-overhaul.md)
- [前序体验与文案打磨记录（refactor/ux-and-polish）](2026-11-22-ux-and-playability-overhaul.md)
- [五阶段加固执行记录（main）](2026-11-21-five-stage-hardening.md)
- [收口执行与恢复点](2026-11-10-closeout-execution.md)
- [全面审查及未覆盖部分](../reviews/2026-11-10-full-review.md)
- [执行前历史归档](history/2026-11-10-current-before-closeout.md)
- [原生隔离规则](../guides/native-test-isolation.md)
- [共享用户阅读档案](../../.user/05-进度与下一步.md)

恢复时先核对实际分支、HEAD 和工作区。旧记录中的执行、推送或数据处理授权不自动延续。
