# ST Explorer 全链路体验、可玩性与玩家文案打磨执行记录

执行：Antigravity（主设计与实现）+ 三角色子代理交替挑刺复查（`code-quality-auditor`、`picky-rp-player`、`rp-copy-editor`），2026-11-21 ~ 2026-11-22。

分支：`refactor/ux-and-polish`（自 `main` `6562540` 切出；前置本地文档与 `start.bat` 清理由 `e028088` 保留）。本轮仅在 `refactor/ux-and-polish` 分支完成四阶段源码重构、全量验证与文档交接；**未合并 `main`、未推送远端、未升版本号、未重新打 Windows 双包或发布 Release**，等待用户晨间审阅与桌面实测验收。

隐私与原生隔离红线核验：全程未读取、触碰或启动 `%APPDATA%/com.ste.explorer`、`%LOCALAPPDATA%/com.ste.explorer`、`docs/private/` 及 `.cache/merge-*` / `.cache/library-*`；真实浏览器巡检与 Playwright 端到端回归均使用独立端口与合成夹具资料。

---

## 一、四阶段提交与核心改动

### 阶段 1：目录治理、超长组件拆分、规约升级与消除静默吞错（`3716d68`）

- **根目录瘦身与归档**：清理 `src-tauri/target_check/`、根目录陈旧 `.playwright-cli/`、孤立 `.tmp-playwright/` 与两份历史 `vitest-*.log`（释放约 **8.6 GB** 磁盘占用）；将不确定的旧过程目录 `.superpowers/` 完整移入本地忽略的 `_archive/2026-11-21-cleanup/.superpowers/` 留档，`.cache/` 内合库凭据与历史存根原样保留；同步收紧 `.gitignore`。
- **工程规约写入 `AGENTS.md`**：新增「目录治理与代码质量红线」（根目录整洁、单文件 500 行拆分目标、严禁文件库/保存/导入链路空 `catch` 静默吞错）与「视觉交互与玩家文案规范」（私人藏书馆 · 剧场手账表面层级、桌面键盘流 + 移动端 44px 触控双端规范、AIRP 自然人话与程序员黑话黑名单）。
- **4 处超长视图模块化拆分**：
  - `NovelView.tsx`（880 → 269 行）：拆出 `src/lib/novel-paragraphs.ts`、`NovelTocSidebar.tsx`、`NovelParagraphBlock.tsx`。
  - `ChatPreview.tsx`（692 → 262 行）：拆出 `ChatSearchToolbar.tsx`、`ChatJumpPopover.tsx`、`ChatMessageRow.tsx`。
  - `AssetSection.tsx`（680 → 351 行）：拆出 `AssetCardRow.tsx`、`AssetDialogs.tsx`。
  - `Library.tsx`（941 → 498 行）：拆出 `LibraryToolbar.tsx`、`LibraryBatchBar.tsx`、`LibraryGridSection.tsx`。
- **消除静默吞错与跨角色竞态**：修复 `CharacterPage.tsx`（快速切卡跨角色请求竞态锁与可重试读取错误提示）、`StoryRecordsView.tsx`（世界书列表读取失败不再伪装成空列表）、`StoryTreeView.tsx`（卸载冲刷落盘失败发出破坏性提示并写入诊断日志）、`ChatPreview.tsx`（滚动定位恢复与剪贴板失败明确反馈）、`AssetLibrary.tsx` / `Beautify.tsx`（预设包与美化导出失败可见提示）。

### 阶段 2：「角色卡画廊赏玩 → 聊天剧场式回味 → 顺滑续聊与资产联动」闭环（`116ce1a`）

- **画廊快玩与顺手操作**：
  - 网格卡面新增 `CharacterQuickPills.tsx`（桌面悬停/键盘聚焦展开、无 hover 触控屏精简常显，一键「继续上次」或「开新局」）；新增 44×44px `CharacterActionsMenu.tsx`（收藏馆卡片直接改类型、进入详情、导出或删除）。
  - 收藏馆外层接入全屏拖拽导入遮罩 `LibraryDropOverlay.tsx`（拖入 PNG/JSON 自动唤起导入预览）。
  - 新增 IME 组合输入与修饰键安全守卫 `src/lib/keyboard-shortcuts.ts`，在收藏馆、聊天中枢、附属库、预设库统一接入 `/` 聚焦搜索，并在角色详情页接入 `[` / `]`（及 `Alt+←` / `Alt+→`）按收藏馆当前筛选顺序前后切卡（`useCharacterNeighbors.ts`）。
- **开场白剧场赏玩与一键开局**：
  - 重构 `GreetingsSection.tsx` + 新增 `src/lib/roleplay/start-story.ts`（`startStoryFromGreeting`）：支持默认开场白与全部备选开场白左右切换、键盘 `←` / `→` 翻看、剧场排版渲染，以及「用此开场白开启新故事」直接携带该条开场白新建存档并进酒馆开聊（支持 `Ctrl/Cmd` 后台新标签打开，不误覆写角色卡原始字段）。
- **任意楼层拉支线续聊与聚光灯跳楼**：
  - 新增 `src/lib/roleplay/branch-from-floor.ts`（`branchStoryFromFloor`，优先按稳定 `messageId` 定锚分叉点，避免隐藏楼或 OOC 过滤造成楼层偏移，并继承截止该楼的记忆、世界书快照、书签与章节标记）。
  - 在 `ChatPreview`、`InlineStoryReader` 与 `LibraryReviewView` 三处阅读器全面打通每楼「从这楼拉支线续聊」及 `?floor=` 聚光灯定位高亮。
- **划词摘金句与名场面长图实时预览**：
  - 阅读器选中文本弹出浮动「摘为金句」迷你条，摘录后通过 `onCharacterUpdated` 实时刷新当前角色页金句列表并提供「撤销」按钮；`ShareImage.tsx` 升级为双栏实时预览海报工作台，支持 3 套剧场/手账/夜读配色与头像、故事名开关。
- **角色页顶部装备栏联动与操作直达**：
  - 新增 `CharacterLoadoutBar.tsx` 汇总已绑定的世界书、预设、正则与随卡内嵌资源状态，点击胶囊直跳关联资产页签或一键提取内嵌资源；左栏 `CharacterInfoRail.tsx` 提炼「导出角色卡」一键直达 + 「操作」抽屉，并修复未统计游玩时长时的 `NaN` 聚合边界。
  - 新增 `src/test/stage2-playability.test.tsx`（7 项集成单测全绿）。

### 阶段 3：去后台感视觉底座、自定义下拉选择器、骨架屏与双端交互统一（`d823d74`）

- **表面层级与主题同步**：
  - `index.html` 补齐 `viewport-fit=cover` 与首屏 `html[data-theme="cream"]` 防闪白样式；`ThemeSync.tsx` 在运行期切主题时同步维护 `document.documentElement.style.colorScheme`，确保原生表单与滚动条配色一致；调暖 `cream` 羊皮纸主题的 `--user-bubble`。
  - 在 `index.css` 统一提供 `.ste-select`（带自适应深浅主题箭头的去后台感选择器）、`.tap-target`（`@media (pointer: coarse)` 44×44px 触控热区扩张）与 `.contain-section`（长列表渲染隔离，内移卡片包裹避免裁切键盘 `focus-visible` 焦点环）。
  - 在 `skeleton.tsx` 新增 `StoryListSkeleton`、`AssetGridSkeleton` 与 `PanelSkeleton` 替换生硬文字加载占位。
- **重点页面去后台感重塑**：
  - 重塑 `ChatHub.tsx`（角色卡 3:4 竖版缩略图对话卡片、继续上次横幅、标签筛选与 `/` 快捷键，并在 `App.tsx` 补 `/chats` → `/play` 兼容重定向）。
  - 重塑 `PresetCollection.tsx` / `PresetCatalog.tsx` / `PresetCatalogFields.tsx`（预设藏书卡片与模型家族胶囊，彻底告别后台 HTML `<table>`）。
  - 打磨 `Beautify.tsx` / `FrontendWorkbench.tsx`、`AssetLibrary.tsx` 与 `Home.tsx`，统一全站弹窗与试玩台 `<select>` 为 `.ste-select`。
- **真实浏览器双视口巡检**：启动本地服务并通过无头 Edge Chromium 在桌面 `1440×900`（深色 + 羊皮纸浅色）与手机 `390×844` 逐页巡检 11 组核心视图截图（存放在 `.cache/verify/ui-check/`），全部 `overflowX: false`、控制台零报错。

### 阶段 4：全站 AIRP 玩家自然人话洗稿、温和排障指引与收口修复（`f679d12`）

- **角色卡与工具术语全面人话化**：
  - `CharacterCardViewer.tsx` 彻底移除括号内的 `first_mes`、`alternate_greetings`、`mes_example`、`system_prompt`、`post_history_instructions`、`character_book` 等底层字段名，统一改为「默认开场白」「备选开场白」「台词与文风示例」「扮演守则（卡内系统提示）」「楼层尾随提醒（防跑偏指令）」「随卡附带世界书」「随卡附带正则」等玩家语汇。
  - 清洗 `ExportButton.tsx`（`重Roll候选版本`、`清理插件缓存`）、`LibraryImportDialog.tsx`（`标准角色卡（V2）` + 3:4 竖版卡面缩略图）、`PresetUtilityFields.tsx`（`代回 / 替身提示词`、`回复开头预填` 等）、`PresetRegexEditor.tsx`、`StoryPackageTools.tsx`、`RequestComparison.tsx`、`GalPlay.tsx`、`Beautify.tsx`、`IntroSection.tsx`、`STImportCard.tsx` 中的翻译腔与生硬术语。
- **报错提示统一改为「出了什么问题 + 下一步点哪里解决」**：
  - 升级 `tavern-host.ts`、`request-diagnostics.ts`、`story-package.ts`（缺失资产按中文类别与名称提示，不再暴露英文枚举和裸 UUID）、`story-maintenance.ts`、`llm/errors.ts`、`GlobalSettings.tsx`、`Index.tsx`、`CardViewer.tsx`、`CaptureRecordDialog.tsx` 的错误与空状态指引。
- **交互竞态补修**：
  - 修复 `Roleplay.tsx` 通过顶栏「返回聊天列表」或模块跳转已显式等待 `saveBeforeExit()` 后，挂起 `useEffect` 再次触发未等待的后台 `saveBeforeExit()` 写盘、从而与列表页标签可见性更新产生覆盖竞态的问题（保留浏览器原生后退时的自动保存兜底）。

---

## 二、多角色子代理交替挑刺复查记录

本轮全程由主代理与三位专职子代理多轮交替复查、逐条修完后再签收：

1. **`code-quality-auditor`**：复查阶段 1 模块拆分、无静默吞错、阶段 2 稳定 `messageId` 分叉与 `AbortController` 生命周期、阶段 3 主题 `colorScheme` 同步与焦点环防裁切、阶段 4 代码与契约安全性 → **0 Blocker / 0 Major / 0 Minor 签收通过**。
2. **`picky-rp-player`**：从重度酒馆玩家视角挑刺开场白新建故事流、收藏馆触控操作菜单、划词金句实时刷新与撤销、双端键盘快捷键防误触与阅读呼吸感 → **0 Blocker / 0 Major / 0 Minor 签收通过**。
3. **`rp-copy-editor`**：对照 `copywriting_audit.md` 全量扫描 `src/pages/`、`src/components/`、`src/lib/` 玩家可见文案，核查底层字段名与黑名单术语清零及排障话术温和度 → **0 Blocker / 0 Major / 0 Minor 签收通过**。

---

## 三、验证范围与待验收边界

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| `node scripts/verify.mjs`（11 步全量） | **11/11 全部通过** | `version`、`script-tests`、`lint`、`types-app`、`types-node`、`vitest`（**333/333 文件、2,721 项通过、1 跳过、0 失败**）、`tavern-source`、`smoke-tests`、`build`、`rust-tests`（66 通过 / 1 原有忽略）、`clippy` 全部零错误通过 |
| 生产构建 Web E2E（`playwright.production.config.ts`） | **7/7 全部通过** | 覆盖 `closeout.spec.ts` 与 `core-regression.spec.ts`（桌面 `1360px` 与手机 `390px`） |
| 内嵌酒馆与整理流 E2E（`playwright.roleplay.config.ts`） | **16/16 全部通过** | 覆盖 `archive-workflow.spec.ts`、`library-finalize.spec.ts`、`playtest-controls.spec.ts`、`organizing-tags.spec.ts` |
| 真实浏览器双视口巡检（Edge Chromium） | **11/11 视图通过** | `1440×900`（深色 + `cream` 浅色）与 `390×844` 手机视口截图核查通过，无横向溢出、无控制台错误 |
| 原生 Tauri 桌面安装包 / 免安装版 | **本轮未重打包** | 改动位于 `refactor/ux-and-polish` 分支；`main` 最新双包仍为 `release/2026-11-22-five-stage-hardening/`（`689b19e723b5`） |
| Android 真机 | **本轮未验证** | 仅验证浏览器 `390×844` 窄屏与粗指针热区样式，无 Android 真机实测 |
| 用户实际体验认可 | **待用户验收** | 待用户审阅分支效果并确认手感与文案后，再决定是否合入 `main` 及构建新一批桌面双包 |
