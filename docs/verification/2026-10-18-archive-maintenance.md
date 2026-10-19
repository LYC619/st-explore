# 2026-10-18 归档维护实施与验证

## 开工基线与范围

- 用户本会话授权执行总计划及 A→B→C，创建了对应 goal。全局 Agent/skill、向量 RAG、U04 字体阅读改版延期；不打包、不发布。
- 实查分支 `codex/playtest-1007`，HEAD `92c18cebdb4831102750bb6a95409e5b581ea243`。
- 保留全部既有未提交内容、未跟踪文件及 `_reference` 删除。在 `.cache/archive-maintenance-20261018/` 保存 `status-before.txt`、`tracked-before.patch`、`untracked-before.txt`。未复制用户整库或凭据。
- 用户实测版本、运行方式：未提供。历史 `release/2026-10-07-playtest/` 不能代表当前源码；本次不重打包。
- 当前 shell 未找到 rtk，直接使用原命令。
- 当前使用合成夹具；没有用户原卡、496 楼原故事、四份完整立绘文本。实机/ST 往返和 Android 验收未完成。

## A 批首次实施记录（后续结论见续接与最终复核）

### A1 文件保存

原 PNG 通过同步 `a.click()` 导出且立即回收 URL，没有保存结果；原 Rust 文本导出仅允许 `jsonl`、`ste-play`，角色/故事 JSON 使用的 `json` 被拒绝。

已增加 JSON 白名单、仅允许 PNG 的原生二进制导出命令，复用原生选址和原子写入，不授权父目录。网页延迟回收 URL，Android 继续走缓存文件分享。角色详情等待结果后提示文件名，取消不报成功，异常可重试；异步保存的库列表/批量下载调用方同步等待。

证据：

- 开工 `vitest` 7 文件 / 106 项通过，日志 `a-baseline-tests.log`。
- 新增 `character-file-export.test.ts` 首跑 4 项失败：PNG 不返回 Promise/结果，`a1-red.log`。
- `npx vitest run src/test/character-file-export.test.ts src/test/story-file-export.test.ts src/test/roleplay-export-file.test.ts src/test/character-web-download.test.ts --reporter=dot`：4 文件 / 14 项通过，`a1-tests.log`。
- Rust 新增白名单/二进制测试先编译失败（新增功能不存在），`a1-rust-red.log`；实现后 `cargo test --manifest-path src-tauri/Cargo.toml`：46 通过、1 跳过，`a1-rust-tests.log`。覆盖选址后写入、取消零写入、错误保持原文件、路径校验及父目录未获授权。
- 这是自动化命令/保存桥验证；Tauri 实际保存对话框、取消、无权限/磁盘满，仍未做人工实机操作。PNG 当前世界书快照由 A3 继续完成。

### A2 世界书自动保存（首次实施记录）

已经接入 600ms 防抖、单编辑器串行保存、快照确认、失败重试、切库检查、导航等待与导出等待；修改中的新版本不会被旧保存标为干净。保存重读版本并保留冲突草稿。原 COW 路径复用，不按每次输入弹 toast。

- `worldbook-autosave.test.tsx`、`worldbook-save-guard.test.tsx`、`worldbook-navigation.test.tsx`：36 项通过，`a2-tests.log`。
- 旧导航测试中“保存期间产生修改后必须仍 dirty”对世界书更新为新合同：自动排队保存第二版后允许导航；预设和正则保持原断言。未移除失败、旧请求或归属保护。
- 正在补真实 IndexedDB/Vault 仓储的编辑→立刻返回→重开和冲突验证、来源恢复入口。尚未宣称 A2 或 A 批完成。

## 2026-10-19 续接：A 自动化出口通过，平台实测待补

续接自会话 `01a14f23-9346-79b2-9169-038dd26661db`。重新读取 CURRENT 并核对分支、HEAD、工作区，仍为上述基线，保留全部未提交内容。原会话多次服务错误中断，没有完成 B/C。

- A2 已补真实 IndexedDB/Vault 仓储测试（`a2-storage-tests.log`，3 项）：立即返回持久保存、首次派生只一次、另一角色仍引用原书、外部版本冲突保留草稿。来源恢复及失败草稿恢复入口已接入。
- A3 当前持久世界书装入 JSON/PNG 快照，保留卡原字段、MVU 和未知条目字段；精简/完整聊天导出共用策略，补可见旁白不误标隐藏回归。
- A4 完整复制保持原成果独立、复制新 ID/分支 ID；详情列表补稳定故事回退、读取中和错误状态。
- A5 显式刷新请求真实模型目录，保留旧列表和连接隔离；新 Persona 取来源信息，旧消息合法姓名保留。
- 原会话 A 最终专项：16 文件 / 155 项通过（`a-batch-final.log`）；应用/Node 类型检查、限定文件 lint、构建通过（对应 `*-a-final.log`、`a-lint-final.log`、`a-build-final.log`）。这些为原会话日志证据，续接未重跑未变更的全部 A 检查。
- 本会话重跑 `npx playwright test --config=playwright.roleplay.config.ts archive-maintenance.spec.ts`：**3/3 通过**（`a-browser-resumed.log`）。真实页面覆盖完整故事复制→详情切换→新增副本成果→刷新；世界书编辑→立即返回→JSON/PNG 提取当前内容；真实酒馆模型目录两次刷新及 Persona 历史保留。
- 上次复制流程失败为通知与标题同时命中的严格定位器歧义，原会话最后已改为唯一标题定位；本次复跑确认流程通过。

A 的浏览器及自动化实现已有证据；Tauri 原生保存对话框/取消、真实 ST 回导、用户原始资料及 Android 真机仍未覆盖，不将其标成已通过。

## B/C 后续

B/C 的实施过程与失败复跑如下，最终结论见末节。无提交、打包或发布。

### B1–B4 已实现的行为

- 角色库批量栏直接“设置类型”，进入原标签管理的类型面板；提交按角色队列重读最新字段，保留标签/评分等其他字段，显示成功数和逐项失败原因，切库后不发起下一条写入。移除总结/日记全文 title，保留展开及新增复制正文按钮。
- 正则深度输入支持清空再输入、IME、空串失焦恢复；快速添加可同时配置楼层范围。UID 在失焦/Enter 自动应用；拒绝空/负数/重复 UID，保留稳定条目选择；默认 UID 升序，记住最后排序，仅改变展示。
- 阅读隐藏楼不再整体变暗；处理页可按范围隐藏/解除及取消全部手动隐藏，一次更新。系统、OOC、柏宝书管理的隐藏不变，原“显示隐藏楼层”开关独立。
- 详情页总结/日记/树可移动到同角色其他故事和目标主线/分支。服务在提交时重读约束，按固定顺序锁故事并锁记录；树节点 ID/内容不改，保留来源。Vault 搬迁走已有单文件移动链，重开后无旧文件重复恢复。
- 已保存故事的消息（含继续聊天已落库内容）可收录整楼或选中片段为总结/日记；进入前 flush 故事。记录保存来源消息 ID/楼层，覆盖范围独立填写，日记人物明确输入，支持保存并继续添加。手动录入复用同一弹窗/服务；同次提交固定记录 ID 防重复。
- 详情总结/日记多选加入现有关联世界书或新角色专用书，预览每篇一条、默认禁用；保留 UID、处理重复记录的跳过/更新/另存。共用 COW 队列并从实际目标重读内容；单世界书提交完成后切角色当前引用。编辑器旧快照遇到外部写入会冲突保护，不能反向覆盖新内容。

### B5/B6 实现与范围

故事树 AI 明确使用所选树的 storyId/branchId，不再读全局 session pointer。支持当前脉络参考总结/日记、显式额外分支引用、现有 AttachPanel 预设/世界书挂载、本故事正则处理后的生成输入及最终请求/token 预览。沿用 summary-engine 和树 JSON ops 协议；拒绝、无效 JSON、空操作分别提示，保留输出。目标/输入/树内容改变时拒绝应用旧结果。详情复用卡片、时间线和大纲阅读完整节点；“分卷”改为“分段阅读”，不自动划卷。

常用故事单独评分入口已移除，评分旧字段及复制/导出兼容保留，角色评分入口未改。U04 全局字体与阅读布局继续延期；查看 `b-record-reading.png` 核实详情阅读布局及全文无悬浮，截图为 1360×900 合成数据，不代表用户字号偏好已验收。资料库类型、评分排序及滚动恢复需在批次后续浏览器检查中单列，不能据此截图推断。

### B 验证记录

- 失败先证据：`b1-red.log` 复现批量栏入口缺失；`b2-depth-red.log` 复现清空数值回填；`b2-uid-red.log` 复现 UID 不自动应用及默认排序；`b3-red.log`/`b3-ui-red.log` 复现树移动/角色约束/详情入口缺失；`b4-red.log`、`b5-context-red.log`、`b5-output-red.log` 对应新服务与解析合同。
- `b-batch-bounded.log`：**20 文件 / 156 项通过**，命令为计划 B 各专项集合加 `--maxWorkers=2`。首次 20 文件高并发时两个渲染用例超过 5 秒，后续用例受未结束测试影响；原失败记录 `b-batch-tests.log` 保留，未删断言或放宽产品行为。较小并发重跑全组通过。
- `b-browser-first.log`：B1–B3 **3/3** 通过。测试运行期间一次开发文件分段写入被 Vite 读到，产生短暂语法诊断；已在后续稳定源码批次重跑，不能将这次状态当作可交付构建。
- `b-browser-expanded.log`：A+B **7/8** 通过，包括连续收录三卷→批量写书→重复跳过。最后树生成测试失败：测试返回普通 JSON，但真实 `callOpenAIMessages` 请求 SSE，收到后无 chunk，页面正确报输出无效；已把夹具改为 SSE，专项重跑中。此时不宣称该流程通过。
- 应用/Node 类型检查无输出通过（`types-app-b.log`、`types-node-b.log`）；限定 B 产品文件 lint 原有一处新 ref 清理警告，已用说明其序列计数用途的局部注释处理，`b5-lint-final.log` 无输出。构建与专项最终复核继续记录。

补验：树 SSE 专项 `b5-browser-fixed.log` **1/1 通过**，实际请求含所选日记及人物，JSON ops 写入原树，角色详情卡片可读完整节点。结合上一稳定批次的其余 7 条入口，A/B 入口均有浏览器证据。`b-final-small.log` **4 文件 / 46 项通过**，增加快速添加规则同时设置 older=50 的回归。`b-build.log` 构建通过（19.86s）；未产生安装版或免安装交付包。

## C 实施与专项验证

- 自动解析支持可见四种样例、完整 HTTP(S) URL、名称+URL、中文/ASCII 前缀、AVIF 扩展、逐行错误与跳过空行/标签/同 URL；512 KB（UTF-8 字节）/1000 项限制。名称统一占位，避免重复名抢用后面明确的 `_2` 名称。签名 query 保留，fragment 去掉。
- 默认粘贴后 250ms 防抖，真实 worker 解析，1.5s 超时终止，旧序列/旧库回调丢弃。预览逐行改名、链接/文件码、目标分行；错误可修正，不阻止其余有效项。原始行身份保持未变源行的编辑，切角色/库清空目标。
- 名称与当前角色既有分行作规范化最长唯一前缀匹配；全局批次目标之后仍可逐行覆盖。高级图床/模板/正则/编码保留，默认收起；成功保存后才记住版本化设置，不存整段源文。
- 缩略图按视口请求，2 并发，32 MB 未引用文件缓存，Blob URL 在不再引用时回收。导入复用已完成或进行中的预览请求，不因改名重新下载。后台保留 4 个执行者，每项下载后完成持久保存再取下一项。
- 来源/内容摘要随图片在角色写入队列和现有 portrait journal 中一并提交；Catbox 按图床主机+文件码、通用站点按含 query 的 URL 去重，同名不判重复。旧图可按内容摘要确认；通用 URL 明确提供重新导入。保存时再次检查，失败不进来源索引。
- 每项捕获自己的目标分行，原全任务目标作为兼容后备。状态增加 skipped、逐项重试和失败批量重试；进度按已处理算，显示已接收字节与总大小未知状态，切库停止后续工作。
- 本地示例按所选名称/文件片段推导字面分隔符，变长字段可识别，歧义保留失败行；候选及最终应用都由 worker 检查，无 eval/AI 调用。
- 下载/保存嗅探共用 PNG/JPEG/GIF/WebP/AVIF 判断；AVIF 校验有效 ftyp 长度及主/兼容品牌。PNG 检查块完整性，保留 HTTP/HTML 错页、20 MB、超时和取消反馈。AVIF 原文件可保存，设卡面仍须解码重编码为 PNG，失败会说明当前解码限制。

证据：`c1-red.log`、`c3-task-red.log`、`c3-identity-c5-red.log` 记录缺失功能；`c1-c4-tests.log` 15 项通过；`c3-identity-c5-tests.log` 89 项通过；`c-batch-tests.log` 12 文件 / 126 项通过。后续针对真实页面发现“失败行通过示例修复后仍未勾选”补 `c2-repair-selection-red.log`，修正后正在最终专项及集成验证。

首轮 `c-browser-first.log`：AVIF 真实解码+错误行修正+单项重试通过；另外两条失败分别为标签实际显示“立绘 2”导致旧定位器找不到、以及上述修复行选中缺口。保留失败截图/trace，不把它们当成功；稳定源码复跑在 `bc-browser-final.log`。

图片夹具由本机 bundled sharp 生成（3 个 3×3 PNG、1 个 2×2 AVIF），HTTP 响应在 Playwright 本地拦截。使用真实 worker/预览/下载校验/仓储，不请求真实 Catbox，不冒充用户四份原始文本；Tauri HTTP/重启与 Android 真机仍未覆盖。

## 2026-10-19 最终复核与交付

本节为当前结论，前面的“进行中/复跑中”描述保留首次执行时的状态，不作为最终结果。代码与自动化交付完成，实机范围仍按下方缺口区分。

### 最后审查补正

- 批量写世界书在角色队列内重验当前关联；操作期间关联被移除或主书已更换时拒绝提交，避免迟到结果重新挂回旧书。现有与新建目标各有回归。
- 手动收录未填写覆盖范围时明确为未知，不把收录所在楼层或整篇故事当覆盖范围；完整故事复制同步重映射收录来源消息 ID，副本来源可在副本内定位。`review-source-contracts-red.log` 先复现，`review-source-contracts-fixed.log` **6 文件 / 40 项通过**。
- 故事树 token 估算计入最终完整请求中的系统提示；保留失败先证据 `review-request-token-red.log`，在最终全量与真实树入口复查中通过。复用卡片的全文 title 也已移除。
- 补合成 **496 楼**的手动隐藏范围及分支隔离回归，不冒充用户的原始 496 楼故事。
- 收尾发现仅有 JPEG 文件头仍可保存；补真实 JPEG/GIF/WebP/AVIF 文件及末字节截断下载回归，先得到 **4 失败 / 7 通过**（`review-image-truncation-red.log`），新增 JPEG 扫描/结束标记、GIF 块/结束符、WebP RIFF 子块和 AVIF 顶层盒边界检查后 **4 文件 / 19 项通过**（`review-image-truncation-fixed.log`）。这些是有界结构检查，不替代图片完整解码；增加 3 个本机 sharp 生成的小文件夹具。

### 最终命令与结果

下列日志均位于本地 `.cache/archive-maintenance-20261018/`。

| 检查 | 结果 / 日志 |
| --- | --- |
| `npm test -- --reporter=dot --maxWorkers=2` | **249 文件、2109 通过、1 跳过**，退出 0；`integration-verified.log` |
| `npx tsc -p tsconfig.app.json --noEmit` 与 Node 配置同命令 | 两套退出 0；`types-app-verified.log`、`types-node-verified.log` |
| `npm run build` | 退出 0，51.81s；`build-verified.log`，保留现有工具及大 chunk 提示，不代表原生包已构建 |
| 当前变更/新增的 `src`、`tests` TS/TSX 文件 ESLint | 退出 0，0 错误；测试辅助文件 `asset-navigation-test-support.tsx` 一条 `react-refresh/only-export-components` 警告；`lint-verified.log`，最后图片/测试补正另复查 `lint-last-fix.log` |
| `git diff --check` | 退出 0；`diff-check-verified.log`；Git 换行提示另存 `diff-check-warnings.log` |
| Playwright `archive-maintenance.spec.ts` | **3/3**，`a-browser-resumed.log` |
| Playwright `archive-workflow.spec.ts portrait-import.spec.ts` | **11/11**，`bc-browser-final.log`；含本地示例 worker 限时、AVIF 解码、取消、失败重试及重复跳过 |
| 审查后复制与连续收录/写书专项 | **2/2**，`review-browser-final.log` |
| 最终故事树完整请求/预览入口专项 | **1/1**，`tree-preview-verified.log` |
| 图片结构补正后的立绘完整浏览器入口 | **5/5**，退出 0；`portrait-verified.log` |
| 导航测试时钟补正与独立自动保存回归 | **4 文件 / 72 项**，退出 0；`review-navigation-clock.log` |
| C 最终专项 | **12 文件 / 128 项**，`c-batch-final.log` |
| Rust A1 保存桥 | 原会话 **46 通过、1 跳过**，`a1-rust-tests.log`；本次续接未改 Rust、未重跑，不能替代真实对话框验收 |

全量首次 `integration-all-tests.log` 有三处失败：类型按钮测试仍用旧文案、机械白名单仍要求已移除的故事评分、存储多挂载集成在负载下超时。分别更新文案断言/删除失效白名单并保留行为断言；存储用例独立复查通过后仅该慢用例设 10 秒。复跑 `integration-all-final.log` 暴露世界书导航测试与合法的 600ms 自动保存竞争；最初暂挂保存 Promise 固定取消用例，但图片补正后的全量 `integration-image-race.log` 又暴露其他查询参数用例把自动保存重读 A 误当导航重读。最终统一对该组“防抖前立即导航”用例使用可控 timeout 时钟，取消临时挂写方法并保留原读取次数、dirty、取消及参数断言；真实编辑器、COW、导航对话框不替换。自动保存防抖/排队另有独立用例与真实页面验证。所有失败日志保留，最终使用上表全量结果，未凭文件是否原先改动判断归属。

### U04 观察、验证边界与交付状态

- 真实角色库入口按类型筛选并按评分排序，进入详情阅读后返回：类型/排序保持；滚动从 **631 → 0**（`bc-browser-final.log`）。复现为先滚动角色库，再进入角色详情并返回；本批仅记录，未修滚动或改字号/布局。截图为 `b6-detail-reading.png`。
- 立绘重复预览截图 `c-duplicate-preview.png` 已目检：逐行显示“已保存，默认跳过”、可改名称/链接/目标分行、显式重新导入；浏览器验证预览与保存共用一次图片请求。详情阅读截图 `b-record-reading.png` 已目检。
- 浏览器使用生产页面、真实 worker 与 IndexedDB，数据/模型/图片响应使用本地可控夹具；VaultFs 队列、失败与日志恢复由仓储自动化覆盖。未声称执行过 Tauri 保存对话框、真实 HTTP/文件重启、磁盘满/权限人工实验、本地 ST 实际往返或 Android 真机。
- 缺用户原卡、原 496 楼故事与四份完整图床文本，未下载用户真实图床图片或修改真实资料库。图片检查验证格式签名及部分结构，不是对全部格式完整解码的证明；无法解码 AVIF 的环境仍可保留有效原文件，设置卡面失败会明确报错。
- 分支与 HEAD 仍为 `codex/playtest-1007` / `92c18cebdb4831102750bb6a95409e5b581ea243`；保留已有修改和删除，新增实现也未提交。本次仅交付源码、测试与记录，无打包或发布。全局 Agent、向量 RAG、U04 阅读改版维持延期。

使用入口见 [10 月 19 日使用变化](../updates/2026-10-19-archive-maintenance.md)。后续实测应基于包含本工作区内容的新构建；10 月 7 日安装包不含本次源码变更。
