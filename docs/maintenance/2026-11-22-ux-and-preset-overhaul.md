# ST Explorer 体验减负（16 项）与预设系统深度重整执行记录

执行：Antigravity（主设计与实现）+ 双专职子代理逐批挑刺复查（`code-quality-auditor`、`picky-rp-player`），2026-11-22。

分支：`refactor/ux-and-polish`（承接前序 `06dbea2`，本轮分四批独立提交至 `ff43df8`）。当前仅在本地 `refactor/ux-and-polish` 分支完成全部代码实现、验证、文档交接与免安装体验包构建；**未合并 `main`、未推送远端、未升应用版本号、未打安装器或远端发布**，待用户桌面实测验收。

隐私与原生隔离核验：全程未读取、修改或启动 `%APPDATA%/com.ste.explorer`、`%LOCALAPPDATA%/com.ste.explorer`、`docs/private/` 及 `.cache/merge-*` / `.cache/library-*`；免安装版构建状态为 `packaged-not-run`（未由 Agent 运行正式程序），所有浏览器与酒馆 E2E 均在独立端口与合成夹具库上执行。

范围边界核验：严格遵守用户确认的范围——**未改动左侧一级主导航 `NAV_AREAS` 结构**（三大板块重排留待后续敲定，仅消除桌面展开主侧栏时右侧重复渲染第二遍图标的 `EditorRail.tsx` 重叠），**完整保留 `Home.tsx` 右列「编辑处理区 + 共享资产」快捷跳转入口**。

---

## 一、四批次提交与核心改动

### 批次一：阅读与整理工作台大视野减负 + 防丢防错位（`aa90609`）
- **统一大屏故事落点 `/story/:id`**：下线角色页右半屏小阅读框 `InlineStoryReader.tsx` 与生硬翻页层 `ReaderView.tsx`；首页、角色库卡面、最近故事、角色页故事行及总结「跳到 `#N` 楼」统一跳往完整大屏 `StoryWorkspace.tsx`（支持 `?branch=&floor=` 聚光灯定位高亮与一键回原角色页）；故事工作区左侧 `224px` 目录栏新增一键收起记忆开关，移除正文顶部的孤立横栏。
- **楼层减负与「☆ 收藏本楼」**：移除低频的任意楼层拉支线 `branch-from-floor.ts`、划词摘金句浮条（消除划字复制时的虚拟列表重排跳动）与海报分享 `ShareImage.tsx`；在 `ChatMessageRow.tsx` 每楼头部提供清爽的「☆ 收藏本楼」星标，收录与隐藏归入单楼菜单。
- **全局阅读外观偏好 & 正则防误清**：默认阅读纸宽由 `600px` 提至 `860px`（上限放开至 `1400px` 并加「铺满可用宽度」），字号、纸宽、排版主题与隐藏楼显隐改为全库通用偏好（不污染 `story.updatedAt`）；取消打开故事自动强弹 `320px` `RegexSidebar`，修复 `RegexSidebar` 挂载 `useEffect` 用旧故事规则反向清空全局自定义正则的 Bug。
- **原始楼层号 `rawFloor` 统一 & 防丢保护**：对齐 `ChatPreview`、`MessageNavBar` 与总结/导出范围的原始楼层号；桌面端 `NovelView` 开放单栏滚轮滚动模式；首页左列最近故事补齐进度与一键回味/续聊；`APIConfigCard` 增加未保存路由离开拦截与选模型自动收起；彻底废除 `pruneAutoSavedSummaries` / `WorldBooks` / `Presets` 按条数静默删旧项逻辑；补齐总结与故事树顶栏故事/支线切换器及跳回原文入口。

### 批次二：角色库与角色详情页瘦身防坑（`0067f9d`）
- **角色头部微章减重**：移除独立占高的 `CharacterLoadoutBar.tsx`，改为在 `CharacterHeader.tsx` 角色名下方的作者行右侧按需展示轻巧微章（仅在确有关联或卡内自带世界书、预设、正则时出现，开场白数量直接标在 `开场白 N` 页签上）；标签输入收进 `[+标签]` 弹出面板。
- **堵住假保存入口，升级人设阅读＋就地编辑**：移除 `CharacterInfoRail.tsx` 中不写回原卡的旧跳转按钮；升级 `CharacterCardEditSection.tsx` 为默认舒适排版阅读人设、场景与作者说明，点击「编辑」即可展开自适应输入框直接写回原卡，并配齐 `CharacterRouteBlocker` 显式未保存离开确认弹窗。
- **页签去重与收藏馆减负**：`StoryListSection` 每行只外露「阅读 / 续聊」；清理关联资产与立绘的重复导入按钮（立绘行内改名替代原生 `window.prompt`，点击已关联世界书/预设直进大屏编辑）；`LibraryFilterRail` 缩至 `248px` 并常驻已选筛选与一键清空，`LibraryToolbar` 统一图标分段切换。

### 批次三：预设系统（Preset Subsystem）与世界书深度重整（`2d04c35`）
- **统一预设上下文编译引擎**：新建 `src/lib/preset-compiler.ts`，自动识别真实非空激活组（优先 `100001`，同步修齐 `Preset.tsx`、`PromptEditor`、`PresetOverview`、`preset-parser`）、严格校验 `@depth` 深度块开关与顺序、消除角色世界书双倍重复注入、补传采样参数 `params` 与 `assistant_prefill`；修复 `tavern-host.ts` 角色/故事关联预设被旧全局 `oai_settings` 覆盖及 DIY 保存返回酒馆热刷新；升级 `preset-playground-stream.ts` 与 `completion-monitor.ts` 兼容原生 Claude / Gemini 流式协议与末尾无空行帧冲刷，补齐试用台开场白选择与用户名实时替换。
- **拨正「系列与版本」数据模型**：修复填「作者」强行合并不同预设系列的 Bug；将单版 `status`（在用/备用/过期）与 `rating`（评价）同全系列共享主题标签解耦（标旧版过期不再连坐废掉新版，`createPresetDiy` 不再继承过期隐藏状态）；保护原版版本号文件名不被短展示名覆盖；用语义化版本比较器替代裸 `localeCompare`（排除 `Sonnet / Opus / R1` 模型号误判）；规范化 `parsePreset` 正则默认键，消除无谓的 `__ste_normalized_v1` 体积翻倍。
- **`.zip` 直导、双版本 Diff 与 DIY 全功能工坊**：`preset-package.ts` 支持预过滤解压 `.zip` 预设包并自动识别配套世界书勾选入库；`PresetCatalogDetails` 默认展示当前版本自己的说明，「内容」页按真实激活顺序展示开关并支持同系列两版本一键 Diff；`Preset.tsx` 补齐改预设名称、采样参数与开头预填、完整撤销/重做栈（含文本编辑防抖入栈）、删除废提示词块、内嵌脚本启用开关、移动端上下移动排序按钮及「边改边试」抽屉；`WorldBook.tsx` 补齐「新建空白世界书」与标题重命名（支持角色派生 COW 保护）。

### 批次四：同源独立窗口左右分屏酒馆 + 聊天大厅瘦身（`843fb44` + 收口 `ff43df8`）
- **同源独立窗口左右分屏酒馆**：新增 `src/lib/roleplay/detached-window.ts`，桌面端从聊天大厅、角色详情、角色库画廊/回顾、首页、故事工作区点续聊或新开对话时，在同步用户手势内派生同源独立酒馆窗口（通过 React Portal 共享主窗口唯一 `VaultBackend` 与 `TavernHost` 队列，跨文档同步主题与样式表并归零 `--app-chrome-h`，Radix 浮层/抽屉/确认框透传 `portalContainer` 渲染在独立窗口内；手机窄屏、弹窗受阻或单页 WebDriver 自动回退页内模式）；独立窗口挂载期间彻底隐藏主窗口右下角 `taskDock` 悬浮条；支持顶栏一键「独立窗口 / 收回页内」（流式生成期间加锁保护 `<iframe>`），并在子窗口/主窗口关闭时确保 `closeFlushHandler` 先完成落盘再卸载会话（保存失败自动在主窗口保留红色恢复入口）。
- **分屏并发防冲突与主模型双向同步**：主窗口 `StoryWorkspace` 打开正在独立窗口对话的同一篇故事时，通过 `subscribeRecordChanges` 实时同步新生成的楼层，并对正文、`BranchPanel`、`IOPanel`、`NovelView` 全面开启只读保护；`RoleplayChrome` 精简酒馆顶栏（半屏 `720px～960px` 保持清爽单行），集成 `QuickModelSwitcher` 并打通全局活跃连接 ↔ 酒馆主模型双向同步，同时支持外部改绑预设聚焦酒馆自动热切换。
- **聊天大厅（`ChatHub.tsx`）瘦身与行内管理**：移除首屏常驻大号新手框（收为右上角 `?` 图标），「山海之间」缩为单行低调入口，搜索与标签筛选同行对齐；抽离 `ChatHubStoryRow.tsx` 与 `NewChatPickerDialog.tsx`，每行对话补齐一键「阅读整理」、挂载预设快选（移动端收入 `⋯` 子菜单）、带输入法合成与焦点保护的行内重命名及删除确认（自动拦截生成中删除并安全释放已开窗口）。

---

## 二、子代理挑刺审查与收口记录

全部四批次均经 `code-quality-auditor` 与 `picky-rp-player` 独立挑刺并逐条闭环：
- 批次一、批次二：修复 `RegexSidebar` 反向清空全局正则、角色卡未保存路由显式 `AlertDialog` 拦截、阅读宽度偏好迁移等 → **0 问题签收**。
- 批次三：修复带版本号磁盘文件名保留、`.zip` 解压前过滤、正则默认键对齐防体积翻倍、角色上下文世界书重命名 COW 派生、SSE 末尾无 `\n\n` 冲刷及原生 Claude/Gemini 工具调用采集、DIY 文本撤销栈与手机端重排按钮 → **0 问题签收**。
- 批次四：修复系统关闭独立子窗口时保持 `<Roleplay>` 存活至 `host.flush()` 完成、生成期间禁用跨窗口搬运、分屏在聊故事行内改名/删档/支线写冲突锁、Radix 菜单关闭抢焦点与 `Esc` 误触发 `onBlur` 保存、角色库画廊与回顾视图分屏接入、抽屉 `--app-chrome-h` 顶距清零，以及真实浏览器 E2E 捕获的页内转独立窗口路由切换竞态（`ff43df8`）→ **0 问题签收**。

---

## 三、验证证据与免安装版交付清单

| 验证项 | 结果 | 详情 |
| --- | --- | --- |
| `node scripts/verify.mjs`（11 步全量） | **11/11 全部通过** | `version`、`script-tests`（64/64）、`lint`（0 错误）、`types-app`、`types-node`、`vitest`（**332/332 文件、2,703 项通过、1 跳过、0 失败**，含 `control-height-grid` 与 `frontend-mechanical-fixes` 栅格契约）、`tavern-source`、`smoke-tests`、`build`、`rust-tests`（66 通过 / 1 原有忽略）、`clippy` 全部通过 |
| 生产构建 Web E2E（`playwright.production.config.ts`） | **7/7 全部通过** | 针对打包产出的正式 `dist/` 运行 `closeout.spec.ts` 与 `core-regression.spec.ts`（`1360px` + `390px`） |
| 内嵌酒馆、独立分屏窗口与归档流 E2E（`playwright.roleplay.config.ts`） | **57/57 通过**（1 原有跳过） | 全套 10 个 spec 文件零失败通过，含新增真实 Edge 多窗口分屏测试（`runtime.spec.ts:1015`：页内弹出独立酒馆窗口 → 主窗口自动退回大屏阅读器并开启只读实时楼层同步 → 独立窗口流式回复落库主窗口即时可见 → 一键收回页内） |
| Windows 免安装体验包（`--portable-only`） | **已生成（未运行）** | 目录：`release/2026-11-22-ux-and-preset-overhaul/`；文件：`STE-0.9.9-2026-11-22-ux-and-preset-overhaul-portable.exe`（`37,740,032` 字节，SHA256 `b2b7bbe4b5d18d361b79277f186289941995e53fa55d0409c1f406b0015612aa`，构建号 `ff43df8e49b1`，`dirty: false`，`packaged-not-run`） |
| Android 真机 / 正式安装版 / 远端发布 | **本轮未执行** | 未打 NSIS 安装器，未合入 `main` 或推送远端，无 Android 真机验证，待用户桌面实测验收 |
