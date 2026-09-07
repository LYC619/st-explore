# 2026-08-26 至 2026-09-05 维护回顾与代码审查

审查日期：2026-09-05（Asia/Shanghai）\
仓库：`D:/8.Project/0_0_维护/silly-tavern-explorer-main`

## 结论先行

这轮维护有明显的实际价值：桌面归档工作流补齐、移动阅读入口成形、文件操作能力增强，也保留了较大的自动化测试集。但当前更接近“功能扩张后需要收敛的版本”，而不是已经完成发布验证的稳定版本。

本次保留 **16 项可定位、可说明触发条件的问题：P1 × 3，P2 × 13**。优先处理涉及数据关联、误操作文件和失败后丢图的三个 P1；同时恢复 CI 的类型检查及版本一致性。然后修复阅读器交互和文件操作的失败恢复。没有确认 P0，也不能据此推断其余代码不存在缺陷。

本次没有修改生产代码、提交、重置、回滚或读取真实用户库。报告中的建议尚未实施。

## 1. 范围、来源与工作区边界

- 审查区间基线：`9a703bab76305d786dca8cce2a26e71079603254`，即 2026-08-26 首个 commit 的父提交。
- 本地 HEAD：`fc26f091e0d2c7f32b9e6d3235fd4830bb912fd4`，2026-09-02 16:23:35 +08:00，`chore: release v0.9.1`。
- 截至审查日，本地这个区间共 **63 个 commit**，**289 个文件变化，+17,634 / -3,183 行**。行数包含文档、图标、Android 工程、依赖锁文件，不等于业务代码量。
- 未执行 fetch，不能把“本地最新提交在 9 月 2 日”表述成远端在 9 月 3–5 日没有更新。
- Git 作者信息主要是 LYC619；仅部分提交带 Claude 的 co-author 标记。因此这里评价的是提交内容和代码效果，不按模型给每个 commit 归因。
- 已跟踪测试文件从 135 增加到 153；这说明覆盖面有扩展，但不代表新增流程的集成边界都被覆盖。

### 当前已有的未提交 ST 导入工作

工作区原本还有 9 个已跟踪 ST 导入相关文件的改动，以及 2 个未跟踪源码文件。它们主要增加校验/解压/扫描/入库进度、取消机制和导入反馈；**不能算到上述 63 个 commit 里**。

| 已有改动 | 文件 |
|---|---|
| Rust 命令接线与解压逻辑 | [lib.rs](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src-tauri/src/lib.rs)、[st_backup_import.rs](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src-tauri/src/st_backup_import.rs) |
| 导入卡片与选择/结果界面 | [STImportCard.tsx](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/tools/STImportCard.tsx)、[STImportSelectionDialog.tsx](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/tools/st-import/STImportSelectionDialog.tsx)、[STImportResultDialog.tsx](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/tools/st-import/STImportResultDialog.tsx) |
| 导入逻辑与原生桥接 | [st-import.ts](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/vault/st-import.ts)、[tauri-fs.ts](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/vault/tauri-fs.ts) |
| 既有测试改动 | [st-import.test.ts](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/st-import.test.ts)、[st-import-card-lifecycle.test.tsx](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/st-import-card-lifecycle.test.tsx) |
| 两个未跟踪源码 | [STImportProgressDialog.tsx](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/tools/st-import/STImportProgressDialog.tsx)、[st-import-progress.ts](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/vault/st-import-progress.ts) |

这些改动全部保留。前端全量检查是在当前工作区上执行，包含它们；本报告的缺陷归因则限定为已提交区间。本次没有完成这组未提交改动的独立原生/端到端验收，不能用下面的 HEAD Rust 测试结果替它们背书。

既有 `.gitignore` 改动、参考资料删除、启动批处理删除、planning/docs/release 未跟踪内容也都没有回滚或清理。

## 2. 这段时间主要做了什么

| 阶段 | 提交数 | 实质工作 | 代表 commit |
|---|---:|---|---|
| 8 月 26–27 日：桌面归档与维护体验 | 28 | 故事改名与关联标题同步；隐藏楼层开关、模型信息、精简导出；原生文件选择、大小上限、ST ZIP；立绘替换/移动/回收；移除库列表项；API 配置共享或按库隔离；修复 query 切换导致整页重挂 | `9978301`、`704e065`、`446fa39`、`ff4218d`、`09e1539`、`61d4894`、`da9ce25`、`1d12e79` |
| 8 月 30 日：反馈问题集中修补 | 10 | 角色删除误报、故事改名回滚、阅读返回入口；分组分页；小说实测分页；TXT 说话人筛选；世界书引用和附属库侧栏；角色任意附件与预览/外部打开 | `210b122`、`5b016bd`、`7f8733b`、`4afaf20`、`b7c1022`、`084cf98`、`9ee8ee4` |
| 8 月 31 日–9 月 1 日：移动端与阅读包 | 24 | 底部标签栏、抽屉、窄屏布局；滚动/翻页阅读、沉浸工具栏、虚拟化；加载/失败状态；Capacitor Android 壳与运行环境抽象；阅读包 inspect/apply 流程与导入导出 UI；返回键分层；分享图；Vite 升级、lint 清理 | `3845bf5`、`07fdb75`、`f687702`、`9fc91ef`、`2884c60`、`dc23d31`、`e32828e`、`5d1df6e`、`c67b8f6` |
| 9 月 2 日：版本发布提交 | 1 | 部分版本号升至 0.9.1 | `fc26f09` |

另有 README 重写、名称/图标调整、仓库名称与协议声明变更。这不是“只改 UI”的一轮：写盘、数据交换、运行环境、导航生命周期和构建依赖都发生了变化。

### 做得好的部分

1. 多数功能围绕真实使用阻碍展开，不是纯视觉重排；故事改名、读取入口、TXT 筛选、附件管理都能直接减少操作步骤。
2. 阅读包使用 inspect → 预览 → apply，而不是选择文件后立刻覆盖，方向正确；按 ID/更新时间判定重复导入也有测试。
3. 原生文件操作继续通过授权根目录边界；ST ZIP 已提交实现有体积、展开比等校验，并有 Rust 单测。这里的阅读包展开上限缺陷不能误归给 ST ZIP。
4. 移动端复用了仓库接口，区分 Tauri、Capacitor、浏览器环境；并非把桌面文件库路径直接硬搬进 Android。
5. CI 明确分别检查 app/node TypeScript 工程，并做 lint、单测、构建、Capacitor sync。当前缺陷被这些门禁暴露，门禁本身是有价值的。

## 3. 问题总表

P1：应优先修复，存在数据损失或错误文件操作风险。P2：应安排修复，包含发布验证阻断、核心交互错误与异常恢复缺失。

| ID | 优先级 | 问题 | 引入 commit | 证据类型 |
|---|---|---|---|---|
| F01 | P1 | 角色改名后附件保留旧路径，可能操作另一角色文件 | `9ee8ee4` | 固定 HEAD + 内存文件库复现 |
| F02 | P1 | 阅读包覆盖角色时删除本机附件/资产/来源关联 | `2884c60` | 固定 HEAD + 完整导入及重新打开后端 |
| F03 | P1 | 替换立绘最后一步失败时原图已永久删除 | `8276065` | 固定 HEAD + I/O 故障注入 |
| F04 | P2 | Vite/Vitest 依赖不匹配，node 工程类型检查失败 | `c67b8f6` | 实际命令失败 |
| F05 | P2 | 0.9.1 漏同步应用/SW 版本，版本测试失败 | `fc26f09` | 实际测试失败 |
| F06 | P2 | 阅读包覆盖故事回滚分支阅读进度 | `2884c60` | 固定 HEAD + 完整导入及重新打开后端 |
| F07 | P2 | 同一编辑器的搜索跳转只改 URL，不加载目标资产 | `1d12e79` | 真实页面组件 + 导航对照复现 |
| F08 | P2 | 翻页后仍测量卸载节点，零尺寸通知使阅读位置回跳 | `7f8733b` | 真实组件 + 合成布局/尺寸通知 |
| F09 | P2 | 滚动模式跳目录/书签/进度不滚动正文 | `07fdb75` | 真实 virtualizer + 合成布局 |
| F10 | P2 | 点击分享按钮同时翻页，弹窗摘录被下一页覆盖 | `5d1df6e` | 真实组件事件链 + 原生环境桩 |
| F11 | P2 | Android 宽屏全屏小说阅读器未注册退出处理器 | `e32828e` | 处理器注册与返回分发测试 |
| F12 | P2 | 阅读包只限制压缩体积，解压内存上限可绕过 | `2884c60` | 有界合成 ZIP 解析 |
| F13 | P2 | 批量移动立绘中途失败，先前移动不回滚 | `61d4894` | 固定 HEAD + I/O 故障注入 |
| F14 | P2 | 附件回收失败仍撤记录，形成假成功 | `9ee8ee4` | 固定 HEAD + I/O 故障注入 |
| F15 | P2 | 文件库替换内嵌立绘后仍显示旧图 | `8276065` | 固定 HEAD + 混合存储记录 |
| F16 | P2 | 单文件回收命令未拒绝非空目录 | `61d4894` | 路径探针 + 原生实现检查，未实际回收 |

## 4. 详细发现

### F01 · [P1] 角色改名后，附件仍使用旧目录路径

**位置：** [attachment-store.ts:124–126](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/attachment-store.ts#L124-L126)，存在性核对见 [95–102](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/attachment-store.ts#L95-L102)。

角色 A 导入 note.txt 后改名 B，仓库会移动角色目录，但附件记录保存的是包含 A 目录的完整库内路径。此后 B 的附件打开失败；若再新建名为 A 的角色并导入同名附件，B 会读取新 A 的文件，删除 B 附件也会操作新 A 的文件。存在性检查仅按 basename 对照 B 的当前附件目录，因此还可能错误地显示“未缺失”。

固定 HEAD 探针已验证：旧引用路径失效、复用旧名字后读取另一角色内容、回收目标错误；B 的真实文件仍留在 B 目录。这里没有实际调用系统回收站。

**建议：** 附件引用改为相对当前角色目录解析，或在角色目录迁移时可靠重写引用；打开、预览、存在性检查、删除必须使用同一套解析。补“角色改名 → 重开库 → 复用旧名 → 查看/删除附件”的回归测试。

### F02 · [P1] 阅读包覆盖角色时抹掉接收端的本机关联

**位置：** [reading-pack-source.ts:71–75](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/data-source/reading-pack-source.ts#L71-L75)。

导出按设计剥离 attachments、assets、unresolvedAssets、sourcePath；覆盖导入却不读取本机角色合并，而是把 restoreCharacter 的结果整条保存。桌面角色在另一设备更新后导回桌面，就会丢失原有附件列表、资产引用和 ST 来源绑定。不是要求阅读包携带不支持的桌面附件，而是覆盖不能删除接收端已有的专有字段。

固定 HEAD 的 build → inspect → apply → 内存文件库重开验证：四个字段全部缺失，附件物理文件仍存在。对故事已有本机字段继承，对角色遗漏了同类保护。

**建议：** 明确跨设备字段与本机字段的所有权；覆盖角色时取得本机记录并保留专有字段。回归测试必须接真实仓库后端，重建后端后再断言，而不只测试 restore 函数。

### F03 · [P1] 替换立绘提交失败时已失去旧图

**位置：** [portrait-store.ts:463–466](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/portrait-store.ts#L463-L466)。

实现先写临时新图，再永久 removeFile 旧图，最后 rename 临时图。若最后一次 rename 因权限、文件占用或 I/O 错误失败，旧图已不存在，持久档案仍指向原文件名，只留下新图的 .replace 文件。写临时文件成功不等于整个替换已经提交。

对最终 rename 注入 EACCES，已验证“操作拒绝、原图消失、档案未变、临时新图还在”。这不是实际硬盘故障测试。

**建议：** 采用可回滚的替换协议；在提交成功前保留旧图，失败后恢复旧文件及元数据，并处理崩溃后的残留事务。不能只补一个 toast。

### F04 · [P2] Vite 升级后 node 类型检查不通过

**位置：** [package.json:80](D:/8.Project/0_0_维护/silly-tavern-explorer-main/package.json#L80)、[92–93](D:/8.Project/0_0_维护/silly-tavern-explorer-main/package.json#L92-L93)，报错点 [vitest.config.ts:6](D:/8.Project/0_0_维护/silly-tavern-explorer-main/vitest.config.ts#L6)。

当前依赖树中，根 Vite 为 8.2.2、React SWC 插件为 4.3.3；Vitest 3.2.6 仍使用嵌套的 Vite 7.3.6。react() 返回的 Vite 8/Rolldown 插件类型不能赋给 Vitest 配置所期待的 Vite 7/Rollup PluginOption。

`tsc -p tsconfig.node.json --noEmit` 实际失败，TS2769，错误链最终包含缺少 rolldownVersion。CI 明确执行这个命令，所以本地已复现发布门禁阻断；没有查询远端 GitHub Actions 状态。

**建议：** 对齐兼容的 Vite/Vitest/插件版本组合和锁文件；验证两个 tsconfig，而不是只跑 app 检查或打包。这里不建议未经验证地指定另一个“最新版”。

### F05 · [P2] 0.9.1 发布漏同步应用与 Service Worker 版本

**位置：** [package.json:4](D:/8.Project/0_0_维护/silly-tavern-explorer-main/package.json#L4)、[GlobalSettings.tsx:33](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/GlobalSettings.tsx#L33)、[sw.js:4](D:/8.Project/0_0_维护/silly-tavern-explorer-main/public/sw.js#L4)。

发布提交只更新 package、Cargo、Tauri 的四份文件；APP_VERSION 与 CACHE_VERSION 仍是 v0.9.0。版本一致性单测的两条断言确定失败，关于/设置界面也仍显示旧版。

SW 的版本命名和发布升级提示机制没有随本次版本轮换。不能夸大成“网站永远不会更新”，因为页面还存在网络优先读取路径。

**建议：** 由单一版本来源生成应用常量、SW 版本和原生配置，或至少把现有版本一致性测试设为发布前不可跳过的门禁。

### F06 · [P2] 阅读包只保留主线进度，分支进度被覆盖

**位置：** [import.ts:201–207](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/reading-pack/import.ts#L201-L207)。

restoreStory 从包复制完整故事，再继承本机顶层 lastFloor、lastViewedAt、lastViewedBranchId；但分支进度存放在 branches[].lastFloor。导入较新的同 ID 故事时，本机分支位置仍被包中位置覆盖，与导入界面“不覆盖本机阅读进度”不一致。

固定 HEAD 完整导入并重开后端：主线 40 正确保留、最近分支 br1 正确保留，但 br1 从本机的 80 回滚到包中的 3；分支正文保持相同。

**建议：** 按分支 ID 继承本地阅读位置，并明确分支被删除或正文长度改变时的规则。现有测试只断言顶层字段，需补分支用例。

### F07 · [P2] 同编辑器内的全局搜索跳转不加载新目标

**位置：** [AppLayout.tsx:511](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/AppLayout.tsx#L511)；相关加载逻辑见 [WorldBook.tsx:144–187](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/pages/WorldBook.tsx#L144-L187)、[Preset.tsx:90–105](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/pages/Preset.tsx#L90-L105)、[RegexTool.tsx:80–122](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/pages/RegexTool.tsx#L80-L122)。

壳层改为只按 pathname 决定重挂后，query-only 导航不会重新挂载页面；上述编辑器却仍只在 mount 时读取 initialAssetId。已经打开世界书 A 时，通过全局搜索选择世界书 B，URL 会变成 B，内容仍然是 A。预设和正则存在相同的初始化依赖。

真实 WorldBook 页面组件的导航复现：跳转后只调用 getWorldBook(book-a)，未加载 B；对照旧的 query-key 重挂策略能正确加载 B。本测试模拟壳层边界，不是浏览器端到端。

**建议：** 让实体 ID 的变化显式触发加载，并处理未保存内容；普通 view 查询参数变化仍保留页面。不要无差别恢复整个页面按 query 重挂，否则会重新引入这次原本要修的状态丢失问题。

### F08 · [P2] 翻页后测量对象仍是已卸载节点

**位置：** [NovelView.tsx:231–236](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/reader/NovelView.tsx#L231-L236)，关联页面节点重建 [974–990](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/reader/NovelView.tsx#L974-L990) 和位置恢复 [248–255](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/reader/NovelView.tsx#L248-L255)。

书页 spread 的 key 随当前页改变，原 article 卸载；测量 effect 却只依赖 pages.length、embedded、scrolling，观察器仍持有旧节点。该节点的零尺寸通知会触发重新分页，随后按 initialFloor 恢复到长楼层的起始页。

合成 400×600 布局下已验证旧 article 脱离 DOM 但仍被观察；发送其零尺寸通知后，页码由“1–2 / 78 → 下一页 3–4 / 78”回到“1–2 / 78”。没有以真实 Chromium/WebView 布局事件做端到端验证。

**建议：** 测量稳定的定尺寸容器，或在测量节点更换时重新绑定；忽略无效/已脱离节点的尺寸，重排时保留当前逻辑位置而非无条件回到初始楼层。

### F09 · [P2] 滚动阅读的跳转只改页码，不移动正文

**位置：** [NovelView.tsx:566–570](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/reader/NovelView.tsx#L566-L570)。

目录、书签和进度条调用 goToPage 更新当前页、保存进度，但实际执行 scrollToPage 的 effect 不依赖当前页，也没有从这些导航入口显式调用。正文停在原处，显示与保存的阅读位置却已改变。

使用真实 virtualizer 和合成滚动布局，对进度条发送 End：页码从 1 / 184 变成 184 / 184，scrollTop 仍为 0，scrollTo 调用数也未增加。

**建议：** 区分“用户主动跳转”和“滚动事件回填进度”；主动跳转必须推动虚拟列表，不要简单加入会形成反馈循环的双向 effect。测试要断言实际滚动位置，不只断言页码文本。

### F10 · [P2] 分享触发按钮冒泡，导致待分享内容变化

**位置：** [ShareImage.tsx:197–201](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/reader/ShareImage.tsx#L197-L201)，接入 [ReaderView.tsx:326–332](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/reader/ReaderView.tsx#L326-L332)。

Capacitor 下点击 ReaderView 右侧的分享按钮，点击同时冒泡到阅读器的右侧翻页判定。翻页完成后，ShareImage 的 effect 又根据新 currentText 重写文本框，用户选择的 A 页摘录会变成 B 页。

原生环境桩、宽度 390、点击横坐标 340 的组件测试已复现：文本框从 EXCERPT A 自动变成 EXCERPT B。未调用真正的系统分享面板。

**建议：** 分享等工具按钮隔离阅读区的导航事件；弹窗打开时快照摘录，不让底层页面变化无意改写用户正在编辑的分享文本。

### F11 · [P2] Android 宽屏全屏小说阅读器绕过退出层级

**位置：** [NovelView.tsx:285–289](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/reader/NovelView.tsx#L285-L289)。

返回处理器与隐藏手机导航共用 isMobile && !embedded 条件。Android 横屏或平板宽度达到 768px 以上时，全屏小说阅读器仍然存在，却没有注册自己的返回处理，系统返回会落到外层导航兜底，不能先关闭阅读器。

宽 900、全屏：处理器数为 0，unhandled，onClose 未调用。宽 390、全屏对照正常。嵌入模式也不注册，但本条主要针对明确应优先退出的全屏阅读状态。

**建议：** 分离“外壳是否沉浸”与“当前阅读层是否能处理返回”；后者不应由 CSS 断点决定。补横屏、平板、全屏/嵌入接线测试。

### F12 · [P2] 阅读包解压展开大小不受限制

**位置：** [import.ts:42–50](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/reading-pack/import.ts#L42-L50)。

入口只检查压缩 bytes.length，随后在主线程调用无展开配额的 unzipSync；所有条目完整解压发生在格式标记验证、导入预览和用户确认之前。300 MiB 的输入限制并不是内存限制。

有界合成样例：合法 manifest + 301 个各 1 MiB 的重复字节媒体条目，ZIP 仅 347,362 bytes，媒体展开后 315,621,376 bytes，解析仍接受。没有继续放大样例或故意触发进程崩溃。

**建议：** 在实际分配/解压前后实施条目数、单条目与累计展开大小限制；防止伪造声明绕过，并考虑在 worker 中解析以避免占用 UI 线程。仅在 unzipSync 返回后检查总量无法避免那次大分配。

### F13 · [P2] 批量移动立绘没有处理中间失败

**位置：** [portrait-store.ts:429–436](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/portrait-store.ts#L429-L436)。

多张立绘逐项 rename，全部完成后才提交快照。第二张失败时，第一张已移动但不会移回，档案仍是旧记录，重新加载后先前移动的图片变为目标目录里的散图。

对第二次 rename 注入 sharing violation，已验证第一张迁移、第二张原地、档案未变。涉及的浅拷贝还会修改共享 item 对象，不能将 UI 对象的变化当作持久化成功。

**建议：** 明确“全有或全无”或“逐项成功”的契约；前者保留操作日志并补偿回滚，后者同步提交成功项并准确返回部分失败。不应文件半成功而整批记录失败。

### F14 · [P2] 回收失败被吞掉，附件入口仍被删除

**位置：** [attachment-store.ts:157–162](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/attachment-store.ts#L157-L162)。

选择同时删除附件文件时，对 trashFile/removeFile 的所有错误无条件 catch，然后仍返回删除记录的 patch。权限/设备错误被当成成功，文件留在磁盘，列表入口消失，原入口无法重试。

故障注入已复现：trashFile 抛 EACCES，removeAttachment 正常返回，保存后附件记录为空，文件仍存在。

**建议：** 区分文件已不存在与实际删除失败。后者应保留记录、展示可重试错误；若用户只想撤销关联，走明确的仅移除记录操作。

### F15 · [P2] 内嵌立绘落在文件库后，替换不清除旧内嵌图

**位置：** [portrait-store.ts:464–469](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/portrait-store.ts#L464-L469)，读取优先级 [238–242](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/portrait-store.ts#L238-L242)。

网页/阅读包等来源的立绘记录可带 dataBase64。在文件库中替换时，代码写新文件并设置 fileName，却保留旧 dataBase64；loadPortraitView 优先内嵌数据，所以替换成功后仍显示旧图。

固定 HEAD 的混合存储记录探针已验证磁盘是 NEW_FILE，而展示返回 OLD_INLINE。

**建议：** 成功切换至文件型内容后清理旧内嵌字节，或统一内容来源字段；失败时再恢复旧来源。补“阅读包/网页数据进入文件库 → 替换 → 重开”的测试。

### F16 · [P2] 单文件回收入口没有文件类型约束

**位置：** [lib.rs:629–630](D:/8.Project/0_0_维护/silly-tavern-explorer-main/src-tauri/src/lib.rs#L629-L630)。

vault_trash_file 只检查授权根目录边界，不检查目标必须是文件。用户在磁盘把已登记附件移走、并在原路径放入非空目录后，再从缺失附件记录执行“删除文件”，目录会被传给支持目录回收的原生接口，操作范围扩大为整个目录。

合成路径探针确认非空目录传入 trashFile，审查了缓存的 trash crate Windows 实现；未实际把任何目录送进系统回收站。属于文件类型边界错误，不是突破授权库根的路径穿越结论。

**建议：** 在原生边界校验目标类型；拒绝目录及不符合策略的链接。测试缺失文件、普通文件、非空目录、链接四类输入。

## 5. 本次实际验证结果

前端环境：Node v22.14.0，npm 10.9.2；Rust：cargo 1.97.1。未重新安装/升级依赖，Rust 使用离线缓存。

| 验证 | 代码来源 | 结果 |
|---|---|---|
| `npm test -- --reporter=dot` | 当前工作区，已移除本次临时复现测试 | **153 文件：152 通过 / 1 失败；1305 用例：1303 通过 / 2 失败**。两项均为版本一致性 |
| `tsc -p tsconfig.app.json --noEmit` | 当前工作区 | **通过** |
| `tsc -p tsconfig.node.json --noEmit` | 当前工作区 | **失败**，TS2769，Vite/Vitest 插件类型不匹配 |
| `npm run lint` | 当前工作区 | **通过，无 warnings** |
| `npm run build` | 当前工作区 | **通过**；build 脚本仅运行 Vite，不能替代类型检查及测试 |
| `cargo test --offline --lib` | 隔离的固定 HEAD 快照 | **29/29 通过**。复核了 Rust 主文件、ZIP 模块及 Cargo.lock 与 HEAD blob 一致 |
| 文件/立绘专项探针 | 固定 HEAD，合成数据/故障注入 | **6/6 复现报告中的错误行为**，不是功能正确率 |
| 阅读包本机字段/分支进度探针 | 固定 HEAD，真实导入与内存文件库 | **2 项错误均复现**，重开后端仍存在 |
| 阅读器专项测试 | 对应生产文件与 HEAD 一致，合成布局/环境桩 | **6 个观察断言通过**，包括错误行为与正常对照；不是 Android 真机验收 |
| query 导航专项测试 | 真实 WorldBook 页面，壳层边界模拟 | 当前策略加载 B 的断言失败；旧策略对照通过 |

以上定向测试与全量测试存在重叠，不能把它们简单相加当成覆盖率。正式测试中的大量通过与发现这些缺陷并不矛盾：目前薄弱的正是状态联动和异常路径。

### 没有验证的内容

- 未执行 Android APK 构建、真机安装、旋转/系统返回/分享面板端到端测试。
- 未执行 Tauri 安装包构建或真实回收站、外部关联程序交互。
- 未跑当前未提交 ST 导入改动的 Rust/原生集成验收。
- 未执行全流程浏览器视觉/交互验收；ResizeObserver 与滚动位置依赖合成布局。
- 未验证远端 CI、最新远端提交或重新运行依赖漏洞审计。
- 不把文档中明确列为后续计划的云同步、移动端 ST ZIP、完整移动端编辑能力等当作本次缺陷。

## 6. 总体判断与下一轮建议

### 维护质量判断

- **功能交付：有实质进展。** 桌面可用性问题被连续处理，移动阅读与跨设备阅读包的基本链路也已形成。
- **架构方向：大体可继续沿用。** 没有必要因为这批问题把运行环境抽象、仓库层或两阶段导入整体推倒。
- **最大短板：局部正确未覆盖完整状态转换。** 同一个附件需要同时经历角色改名、文件存在性检查、打开和删除；一次导入需要同时遵守可交换字段、本机字段及分支进度；一个按钮会参与父阅读器的事件链。只验证单个函数的理想路径无法保证这些流程。
- **发布纪律：需要加强。** Vite 升级验证遗漏 node 工程检查，版本发布遗漏已有的版本同步测试；“打包成功”被当作过强的完成信号。

### 建议修复顺序

1. **先保护数据：F01–F03。** 修复前保留正常备份；暂不把阅读包往返覆盖桌面库作为唯一同步方式，不在未备份时批量处理立绘。
2. **恢复发布门禁：F04–F05。** 两份 tsconfig、lint、全量测试、构建全部通过后再谈发布；单一版本来源优先于每次记住更多手改位置。
3. **恢复核心阅读/导航：F06–F11。** 同时补真实页面级回归，断言目标实体、滚动位置、分享文本和退出层级，不只检查按钮可点击。
4. **补输入与文件失败边界：F12–F16。** 对文件替换、批量移动和回收建立一致的事务/部分成功规则，并覆盖故障注入。
5. **单独验收未提交 ST 导入工作。** 重点覆盖取消发生在校验/解压/扫描/写入不同阶段、关闭对话框与切换文件、临时目录清理及取消后再次导入；不要混在版本修补里仅凭前端测试放行。
6. **最后做真实设备与发布流程验收。** 窄屏/宽屏、横竖屏、浏览器/桌面/Android 三端各选代表场景，不用纯单测替代原生交互。

## 7. 证据与审查产物

仓库中仅新增本报告（另有仓库外验证产物与正常构建缓存）；本次临时测试已移出正式测试目录，生产文件未改。现有未提交业务改动全部保留。

- [完整前端测试日志](C:/Users/yicha/.codex/visualizations/2026/09/05/01a070f9-ec37-7c62-a1c0-387fa8937b90/maintenance-review-evidence/final-tests.log)
- [node 类型检查错误](C:/Users/yicha/.codex/visualizations/2026/09/05/01a070f9-ec37-7c62-a1c0-387fa8937b90/maintenance-review-evidence/final-types-node.log)
- [固定 HEAD Rust 测试日志](C:/Users/yicha/.codex/visualizations/2026/09/05/01a070f9-ec37-7c62-a1c0-387fa8937b90/maintenance-review-evidence/final-rust-head.log)
- [固定 HEAD 文件/立绘探针](C:/Users/yicha/.codex/visualizations/2026/09/05/01a070f9-ec37-7c62-a1c0-387fa8937b90/maintenance-review-evidence/native-review-probes.cjs)
- [固定 HEAD 阅读包探针](C:/Users/yicha/.codex/visualizations/2026/09/05/01a070f9-ec37-7c62-a1c0-387fa8937b90/maintenance-review-evidence/reading-pack-probe.cjs)及[输出](C:/Users/yicha/.codex/visualizations/2026/09/05/01a070f9-ec37-7c62-a1c0-387fa8937b90/maintenance-review-evidence/reading-pack-probe.log)
- [阅读器专项测试入口](C:/Users/yicha/.codex/visualizations/2026/09/05/01a070f9-ec37-7c62-a1c0-387fa8937b90/mobile-review/run-review.mjs)及[测试源码](C:/Users/yicha/.codex/visualizations/2026/09/05/01a070f9-ec37-7c62-a1c0-387fa8937b90/mobile-review/mobile-review.test.tsx)
- [query 导航复现源码（已移出正式测试目录）](C:/Users/yicha/.codex/visualizations/2026/09/05/01a070f9-ec37-7c62-a1c0-387fa8937b90/maintenance-review-evidence/codex-review-query-repro.test.tsx)

内存文件库“重开”指新建后端实例后读取同一合成文件系统，不等同于真实应用重启。故障注入测试没有损坏真实文件、触发实际回收或读取用户私有数据。

## 附录：63 个提交索引

以下日期为本地 Git 作者日期，按历史顺序排列。完整内容可用 commit ID 在本地 Git 查看。

| Commit | 日期 | 标题 |
|---|---|---|
| `94cfe74` | 2026-08-26 | docs: 按 2.0 架构重写 README，更新日志换算到十进制阶梯 |
| `b7fe97c` | 2026-08-26 | chore(release): 版本号统一到 0.9.0，产品名统一为 ST Explorer |
| `1c11786` | 2026-08-26 | chore(license): 开源协议由 MIT 改为 AGPL-3.0-only |
| `8829a53` | 2026-08-26 | docs(screenshots): 界面截图入库，README 直接显示 |
| `c4c0db8` | 2026-08-26 | chore(branding): replace application icons |
| `d72acd4` | 2026-08-26 | fix(ui): avoid input fast refresh warning |
| `fc48fcb` | 2026-08-26 | fix(import): show ST import entry in empty vault |
| `60e42b4` | 2026-08-26 | fix(regex): contain long rule labels and patterns |
| `eeac8c8` | 2026-08-26 | feat(chat): allow unhiding ordinary hidden floors |
| `1263eab` | 2026-08-26 | fix(summary): unify manual records and render markdown |
| `9978301` | 2026-08-26 | feat(stories): add story rename action on character page |
| `dfa7f92` | 2026-08-26 | fix(character): reset content scroll on navigation |
| `704e065` | 2026-08-26 | fix(stories): refresh linked record titles after rename |
| `7f32227` | 2026-08-26 | feat(chat): show model metadata on message rows |
| `8276065` | 2026-08-26 | feat: manage portraits and use native chat file picker |
| `fec13ea` | 2026-08-26 | chore: document slim exports and add offline WebView2 build |
| `f5e109f` | 2026-08-26 | chore: remove unused absolute binary reader |
| `446fa39` | 2026-08-26 | fix(stories): 重命名不再改写关联记录时间戳，失败时给出提示 |
| `ff4218d` | 2026-08-26 | fix(import): 原生选文件加体积上限，避免大文件卡死客户端 |
| `09e1539` | 2026-08-27 | feat(import): 支持导入 SillyTavern 导出 zip，并放宽体积上限 |
| `61d4894` | 2026-08-27 | feat(portraits): 立绘可删除/移动，删除走系统回收站 |
| `1d12e79` | 2026-08-27 | fix(layout): 抽屉不再被顶栏压住，换 query 参数不再整页重挂 |
| `0de192d` | 2026-08-27 | feat(vault): 库列表支持移除条目 |
| `ec39a7a` | 2026-08-27 | feat(chat): 可隐藏单条消息、显示模型名，导出支持精简版 |
| `46b8344` | 2026-08-27 | fix(organize): 生成后滚到结果块，卷号不再停在刚存的那一卷 |
| `c9d51b0` | 2026-08-27 | chore(icons): 换成浅奶油底的图标 |
| `c037bf5` | 2026-08-27 | fix(ui): 修好那个鼠标悬上去什么都不出的问号 |
| `da9ce25` | 2026-08-27 | feat(vault): 设置按库隔离，API 配置可选共享或本库单独 |
| `210b122` | 2026-08-30 | fix(archive): 删除角色卡误报失败、故事改名被回滚、小说视图看不到返回键 |
| `5b016bd` | 2026-08-30 | fix(library): 分组不再被分页切断，小卡角标不挤 |
| `7f8733b` | 2026-08-30 | fix(reader): 小说视图一页按实测尺寸装字，不再拆得特别碎 |
| `4afaf20` | 2026-08-30 | fix(import): TXT 导入可勾说话人，生成结果能直接丢弃 |
| `b7c1022` | 2026-08-30 | fix(worldbook): 添加引用面板能滚能搜，悬浮预览字号正常，「已暂存」改叫最近打开 |
| `084cf98` | 2026-08-30 | fix(assets): 附属库改成一个页面一套侧栏 |
| `9ee8ee4` | 2026-08-30 | feat(character): 角色卡能挂任意类型的关联文件，客户端内可预览或交给外部程序 |
| `b4feeb4` | 2026-08-30 | chore(icons): 应用 light-cream 图标（0827 发布前轮） |
| `59537c4` | 2026-08-30 | fix(assets): 附属库侧栏字号跟设置页分区导航对齐 |
| `c643768` | 2026-08-30 | docs: 换成定稿 README，改名 ST-Explore，补齐功能截图 |
| `b54a09e` | 2026-08-31 | chore: 仓库 URL 改名 st-explore，同步 version-sync 断言 |
| `673c670` | 2026-08-31 | Remove batch management toolbar image from README |
| `3845bf5` | 2026-08-31 | feat(mobile): 移动端导航壳层——底部标签栏 + 左侧抽屉 |
| `b0da879` | 2026-08-31 | test(mobile): 补齐导航壳层纯逻辑用例，去掉一份重复的区域判定 |
| `07fdb75` | 2026-08-31 | feat(mobile): 小说视图的移动端阅读体验（滚动/翻页 + 沉浸工具栏） |
| `fa7e7f7` | 2026-08-31 | feat(mobile): P2 核心页面响应式布局 |
| `6d0d6b2` | 2026-08-31 | feat(mobile): P3 加载状态——首屏骨架、刷新指示条、失败态 |
| `141aded` | 2026-08-31 | fix(mobile): 贴底浮层避开标签栏；补范围外 TODO 与适配文档 |
| `75dc67c` | 2026-08-31 | chore(lint): react-refresh 警告基线归零 |
| `82a018a` | 2026-09-01 | feat(mobile): 故事工作区窄屏布局——二级栏拆进左右两个抽屉 |
| `4aa6d03` | 2026-09-01 | feat(mobile): 编辑区窄屏形态——工具栏收纳、正则栏改为下方展开 |
| `4a69763` | 2026-09-01 | fix(mobile): 阅读通道剩余窄屏问题——就地阅读顶栏、工具条排序、悬停显形 |
| `f687702` | 2026-09-01 | perf(reader): 小说视图滚动模式段落虚拟化，并修掉分页容量塌到下限的根因 |
| `9fc91ef` | 2026-09-01 | feat(mobile): Capacitor Android 外壳脚手架 + 三档运行环境抽象 |
| `e394e25` | 2026-09-01 | docs(mobile): 移动端客户端设计——架构、功能分级、进度 |
| `1c9ca14` | 2026-09-01 | docs(mobile): 补 progress.md，并给它在 .gitignore 上开个口子 |
| `e80147d` | 2026-09-01 | chore: 清掉 .worktrees 残留，忽略规则改指工具实际使用的路径 |
| `2884c60` | 2026-09-01 | feat(pack): 阅读包格式与 DataSource 抽象 |
| `dc23d31` | 2026-09-01 | feat(pack): 阅读包导出与导入界面 |
| `e32828e` | 2026-09-01 | feat(mobile): Android 返回键——按层分发，一级页面最小化而不退出 |
| `5d1df6e` | 2026-09-01 | feat(mobile): 分享图生成——Canvas 绘制卡片，Capacitor Share 调起系统分享面板 |
| `c67b8f6` | 2026-09-01 | chore(deps): vite 5.4.21 → 8.2.2，解决 esbuild 安全漏洞 |
| `95ed167` | 2026-09-01 | docs: 更新移动端适配进度（本轮 6 commit 完成） |
| `6ada1fb` | 2026-09-01 | fix(share-image): 分享图生成从当前主题读色，墨色跟明度翻转，避免用死的 CSS 变量 |
| `fc26f09` | 2026-09-02 | chore: release v0.9.1 |
