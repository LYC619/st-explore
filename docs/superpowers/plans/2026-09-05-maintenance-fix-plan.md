# 2026-09-05 全部维护问题修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 2026-09-05 审查确认的全部 16 项问题，保护现有未提交工作，并完成可追溯的自动化与原生验收。

**Architecture:** 保留 React + 统一仓库 + Tauri/Capacitor 双壳架构，不做整库迁移或 UI 重写。按工具链、文件安全、阅读包、导航阅读器拆成四个可独立验证的工作包；跨文件事务只扩展角色更新边界，不替换仓库层。先恢复验证门禁并处理数据风险，最后验证工作区既有 ST 导入改动与真实壳环境。

**Tech Stack:** TypeScript、React 18、Vite/Vitest（由 T1 选择相容版本）、fflate 0.8.2、TanStack Virtual、Rust/Tauri 2、Capacitor 7、现有内存 VaultFs 与 IndexedDB 测试后端。

---

## 0. 状态与依据

- **执行状态（2026-09-08）：F01-F16 与 S1 的代码修复、回归和本机可执行门禁已完成；平台验收仍有明确未完成项。**
- 提交安排（2026-09-08 用户授权）：已验证的 F01-F16、S1、测试和维护文档纳入同一本地提交；无关工作区改动继续保留。
- 最终证据见 [维护修复验证记录](../../reviews/2026-09-05-maintenance-fix-verification.md)。原始设计示例不等同于最终实现；以代码、测试和执行记录为准。
- 最终候选前端 170 文件 / 1581 测试通过，两个 TS 工程、lint、build 通过；Rust 42 通过 / 1 权限用例未验收，Windows 安装包已生成，Android 仅完成同步。
- S0 原始快照未能在交接指定路径找到，不能补记修复前哈希核对已完成；已保留最终源码副本和指纹，验证结束时未暂存，未回退既有 WIP。
- 审查区间：**2026-08-26—2026-09-05**。基线 `9a703bab76305d786dca8cce2a26e71079603254`；本地 HEAD `fc26f091e0d2c7f32b9e6d3235fd4830bb912fd4`，提交于 **2026-09-02**。
- 未 fetch，不声称掌握远端 9 月 3—5 日的状态。
- 依据：[完整审查报告](D:/8.Project/0_0_维护/silly-tavern-explorer-main/docs/reviews/2026-09-05-maintenance-review.md)。问题编号 F01—F16 沿用该报告。
- 仓库根：`D:/8.Project/0_0_维护/silly-tavern-explorer-main`。下列 PowerShell 命令均从这个目录执行。
- `rtk` 在本机不可用，命令直接执行；执行环境变化后可重新检测。

## 1. 方案比较与选择

| 方案 | 收益 | 代价 / 风险 | 决策 |
|---|---|---|---|
| 逐点打补丁，不调整提交边界 | 改动最少 | 立绘只修某次 rename 仍覆盖不了档案写入失败；多个调用方易继续绕开安全解析 | 不采用 |
| **按数据所有权与提交边界做小范围修复** | 缺陷可分别关闭；保留现有结构；能注入失败验证 | 需要少量专用模块与明确的回归门禁 | **采用** |
| 全面重写文件库 / 阅读器 / 同步架构 | 理论上可统一更多能力 | 扩大兼容面、延长恢复稳定的时间，超出此次修复范围 | 不采用 |

### 必须保持的行为

1. 旧库可直接打开；不要求用户手工整理角色目录。
2. 读、预览、打开、删除附件共享同一角色作用域解析，禁止访问旧角色名字对应的目录作为兜底。
3. 立绘新内容和角色记录确认提交前，原内容必须仍可恢复；派生 `立绘.json` 不是事务提交依据。
4. 阅读包更新内容不覆盖接收端的设备专有字段和已有分支阅读进度。
5. `assetId` / `characterId` 变化应处理；普通 `view` 等 query 变化不触发编辑页整体重挂。
6. 阅读进度只有首次打开、明确跳转或切换故事/分支时重新定位；布局重排不能读回初始位置。
7. Android 返回顺序保持“弹层 → 当前阅读层 → 路由兜底”；与是否窄屏分离。
8. 无实际设备或构建环境时，明确记录未验收项，不能以 jsdom 或 `cap sync` 替代。

## 2. 工作包与关闭矩阵

| 顺序 | 工作包 / 任务 | 覆盖问题 | 合并 / 完成门槛 |
|---|---|---|---|
| S0 | 当前工作区基线保护 | 全局前置 | 改动清单与哈希保存，未读取用户库 |
| T1 | 工具链兼容 | F04 | 两个 TS 工程与构建通过；只暂留已确认的 F05 两个失败，T2 后全绿 |
| T2 | 版本生成与检查 | F05 | 六处版本一致，检查模式无写入 |
| D1 | 原生单文件边界与错误分类 | F16、F14 的基础 | 普通文件可转发；目录/链接/越界不可转发；缺失可区分 |
| D2 | 附件作用域、兼容与失败处理 | F01、F14 | 改名→重开→复用旧名后仍操作正确文件 |
| D3 | 角色准备式更新与立绘恢复协议 | F03、F13 的基础 | 每个中断点可判定提交/回滚/需恢复，不毁掉唯一副本 |
| D4 | 替换立绘与内容源切换 | F03、F15 | 文件和内嵌路径均显示新图，失败仍能读取旧图 |
| D5 | 批量移动立绘 | F13 | 记录全有或全无；中途失败不修改原对象 |
| D6 | 文件安全交付检查 | D1—D5 的组合验收，不新增问题 | 失败恢复/重开库/原生边界及 WIP hunk 复核有记录 |
| P1 | 阅读包字段所有权 | F02 | 完整导入后重开库，本机关联保持 |
| P2 | 阅读包主线/分支进度 | F06 | 同 ID 分支进度保持、缩短/删除策略明确 |
| P3 | 有界解压与 Worker 生命周期 | F12 | 解压前/过程中限额，失败/取消不写库、不留大缓存 |
| P4 | 阅读包交付检查 | P1—P3 的组合验收，不新增问题 | source/sink 全调用点、IDB/文件库重开与取消生命周期通过 |
| R1 | 编辑器身份 query 导航 | F07 | 三类编辑器、脏草稿、快速跳转、COW 上下文正确 |
| R2 | 小说测量节点与阅读锚点 | F08 | 卸载节点零尺寸无影响，重排保持逻辑位置 |
| R3 | 显式滚动跳转 | F09 | 目录/书签/滑条均移动正文，手动滚动不产生跳转循环 |
| R4 | 返回层与分享事件 | F10、F11 | 分享摘录冻结、按钮不翻页，宽屏返回关闭当前层 |
| R5 | 阅读器交付检查 | R1—R4 的组合验收，不新增问题 | 导航/滚动自动化通过，浏览器与设备结果单列 |
| S1 | ST 未提交改动独立验收 | 不冒充 F01—F16 中的已提交改动 | 当前工作区 Rust、取消/进度/清理行为独立通过 |
| S2 | 全量验收与交付 | F01—F16 | 问题证据、自动化、真实壳验证有记录 |

### F01—F16 回归与证据逐项映射

以下均为执行时要达到的断言，不是本轮已通过结果。每行证据写入 S2.4 的同名 Fxx 小节，统一记录 RED/GREEN、命令/退出码、代码版本/WIP 指纹，以及原生/设备未验收原因；D6/P4/R5 是交付检查，不遗漏业务任务。

| 问题 | 修复任务 | 回归文件（仓库根下 src/test）与核心断言 | 交付检查 / 证据 |
|---|---|---|---|
| F01 | D2 | attachment-store.test.ts：改名、重开、旧名被其他角色复用；预览/外开/删除只作用当前角色 | D6；S2.4/F01；Tauri 合成库 |
| F02 | P1 | reading-pack.test.ts + archive-db.test.ts：完整 apply 后用新 backend/IDB 连接读取，四个本机字段保留 | P4；S2.4/F02 |
| F03 | D3/D4 | portrait-store.test.ts + archive-db.test.ts：prepare/persist/finalize 各处失败；旧图可恢复，新图不会被 cleanup 删除 | D6；S2.4/F03；Tauri 恢复 |
| F04 | T1 | node/app tsc、工具链依赖树、测试与 build；无 any/skipLibCheck 掩盖 | T2.4；S2.4/F04；选型 JSON |
| F05 | T2 | version-sync.test.ts + scripts/sync-version.test.mjs：六处一致、check 无写入、write 幂等、只改 Cargo 本包 | T2.4；S2.4/F05；SW 更新 |
| F06 | P2 | reading-pack.test.ts：相同 branch id 保留进度，主线/分支缩短 clamp，删除分支不复活 | P4；S2.4/F06 |
| F07 | R1 | app-layout-navigation + worldbook-navigation + preset-navigation + regex-navigation：A→B→C、取消恢复 URL、保存 owner、普通 query 不丢稿 | R5；S2.4/F07；真实浏览器 |
| F08 | R2 | novel-view.test.ts + novel-view-interaction.test.tsx：detached/0×0 不重置，单楼跨页偏移重排保持 | R5；S2.4/F08；字体/旋转 |
| F09 | R3 | novel-view-interaction.test.tsx + novel-view-bookmark.test.tsx：目录/书签/滑条滚动正文，手动反馈不反向 jump | R5；S2.4/F09；真实滚动 |
| F10 | R4 | reader-view-share.test.tsx：按钮/portal 不翻页，父层变化不改摘录且用户编辑保留 | R5；S2.4/F10；原生分享 |
| F11 | R4 | back-button.test.ts + reader-view-keyboard.test.tsx + inline-story-reader.test.tsx：宽屏返回、弹层优先、embedded 不抢路由 | R5；S2.4/F11；Android 窄/宽屏 |
| F12 | P3 | reading-pack.test.ts + reading-pack-worker.test.ts：五项预算、真实展开计数、cancel/stale/finally 不写库或覆盖新计划 | P4；S2.4/F12；设备内存 |
| F13 | D3/D5 | portrait-store.test.ts：第二项文件故障、persist 失败、共享嵌套引用不被修改；重开恢复幂等 | D6；S2.4/F13 |
| F14 | D1/D2 | attachment-store.test.ts + tauri-fs-mutation.test.ts：回收/权限/缺失失败保留记录，无假成功 | D6；S2.4/F14；原生故障 |
| F15 | D4 | portrait-store.test.ts + portrait-lazy-load.test.tsx：文件库替换清旧 dataBase64，缩略/大图都显示新图 | D6；S2.4/F15 |
| F16 | D1 | tauri-fs-mutation.test.ts + src-tauri/src/lib.rs 单测：普通文件允许，目录/链接/junction/越界从未进 operation | D6；S2.4/F16；Windows reparse |

回归文件列以简写避免重复；各子计划 Files 列给出完整绝对路径，新增文件明确标为 Create。不得仅写“测试通过”而没有可定位的用例/命令。
### 详细子计划

- [工具链与版本：T1—T2](D:/8.Project/0_0_维护/silly-tavern-explorer-main/docs/superpowers/plans/2026-09-05-maintenance-toolchain.md)
- [文件数据安全：D1—D6](D:/8.Project/0_0_维护/silly-tavern-explorer-main/docs/superpowers/plans/2026-09-05-maintenance-file-safety.md)
- [阅读包：P1—P4](D:/8.Project/0_0_维护/silly-tavern-explorer-main/docs/superpowers/plans/2026-09-05-maintenance-reading-pack.md)
- [导航与阅读器：R1—R5](D:/8.Project/0_0_维护/silly-tavern-explorer-main/docs/superpowers/plans/2026-09-05-maintenance-reader-navigation.md)

建议执行顺序：`S0 → T1/T2 → D1/D2 → D3/D4/D5 → D6 → P1/P2/P3 → P4 → R1/R2/R3/R4 → R5 → S1 → S2`。

工具链工作应尽早完成，使后续 RED/GREEN 有可信基线；这不意味着降低 P1 数据风险优先级。任何阶段都不要求先发布一个中间版本。

### 编辑所有权与并行边界

默认在本任务内按批次执行。本轮规划不创建分支、不启动子代理、不创建新任务。

- `package.json`、`package-lock.json`、CI：T 工作包统一负责；其他工作包不顺手升级依赖。
- `portrait-store.ts`、`archive-db.ts`、`character-write.ts`：D3—D5 串行，一个写入负责人。
- `reading-pack/import.ts` 与 source/dialog：P1—P3 串行，一个写入负责人。
- `NovelView.tsx`：R2—R4 串行；不能让三个修复独立改同一个 effect。
- D1 的 `src-tauri/src/lib.rs` 与用户 ST 工作重叠；只做普通文件 helper、两个既有 command 和路径链接检查的局部补丁，不格式化整个文件。
- 如用户后来同意并行代理，T、D、P、R 可在定义的边界下分工；P 的角色导入测试在 D3 更新契约后再做集成。不得并发运行依赖安装与整套测试。

## 3. S0 — 保护工作区与记录基线

**只记录代码与 git 状态，不复制真实 `user/`，不扫描 API Key 或真实库。**

### 已有源码改动的保护名单

| 类型 | 绝对路径 |
|---|---|
| tracked WIP | `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src-tauri/src/lib.rs` |
| tracked WIP | `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src-tauri/src/st_backup_import.rs` |
| tracked WIP | `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/tools/STImportCard.tsx` |
| tracked WIP | `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/tools/st-import/STImportSelectionDialog.tsx` |
| tracked WIP | `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/tools/st-import/STImportResultDialog.tsx` |
| tracked WIP | `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/vault/st-import.ts` |
| tracked WIP | `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/vault/tauri-fs.ts` |
| tracked WIP | `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/st-import.test.ts` |
| tracked WIP | `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/st-import-card-lifecycle.test.tsx` |
| untracked WIP | `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/tools/st-import/STImportProgressDialog.tsx` |
| untracked WIP | `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/vault/st-import-progress.ts` |

另有 `.gitignore` 修改、`_reference` / `start.bat` 删除、`.planning` / docs / release 内容，全部保留。禁止 `git reset --hard`、`git clean`、整体 stash、`git add .`。

- [ ] **S0.1** 保存 HEAD、source 范围的 tracked/untracked 清单和已改源码 SHA-256 到本机审查证据目录中的新子目录；不要覆盖上一轮证据。

```powershell
$root = (Get-Location).Path
$base = 'C:\Users\yicha\.codex\visualizations\2026\09\05\01a070f9-ec37-7c62-a1c0-387fa8937b90'
$out = Join-Path $base ('maintenance-fix-baseline-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $out | Out-Null
git rev-parse HEAD | Out-File -Encoding utf8 (Join-Path $out 'head.txt')
git -c core.quotepath=false status --short | Out-File -Encoding utf8 (Join-Path $out 'status.txt')
git diff --numstat -- src src-tauri | Out-File -Encoding utf8 (Join-Path $out 'source-diff-stat.txt')
$tracked = @(git diff --name-only -- src src-tauri)
$untracked = @(git ls-files --others --exclude-standard -- src src-tauri)
$paths = @($tracked + $untracked) | Sort-Object -Unique
$paths | ForEach-Object {
  $p = Join-Path $root $_
  if (Test-Path -LiteralPath $p -PathType Leaf) { Get-FileHash -Algorithm SHA256 -LiteralPath $p }
} | Export-Csv -NoTypeInformation -Encoding utf8 -LiteralPath (Join-Path $out 'source-hashes.csv')
```

- [ ] **S0.2** 从保护名单逐个复制源码到该证据目录的 `wip-source`，保持相对结构；只复制以上 11 个明确源码，不使用整个仓库递归复制。原文件不移动。
- [x] **S0.3** 核对 HEAD 和重叠 WIP；最终候选与当前源码逐文件哈希一致，没有覆盖新增工作。
- [ ] **S0.4** 以最近一次审查结果作为已知基线，执行修复前重新跑对应工作包的定向失败检查，不重复制作 16 个审查探针。

### 已有验证基线（不是本计划新跑出的结果）

| 检查 | 2026-09-05 审查结果 |
|---|---|
| 全量前端测试，当前工作区 | 153 文件；1303 通过 / 2 失败，均为版本同步 |
| app TS / lint / Vite build | 通过 |
| node TS | TS2769，Vite/Vitest 插件类型不兼容 |
| 固定 HEAD 的离线 Rust lib 测试 | 29/29 通过 |
| 当前 WIP 的原生测试、安装包、APK、真机 | 尚未独立验收 |

已保留的复现脚本对旧错误行为做了断言，**不能原封不动作为修复成功测试**；要改成正确行为断言放入正常测试目录。

## 4. S1 — 既有 ST 导入 WIP 独立验收

范围限上述 11 个源码的进度、取消、反馈与临时目录处理；独立验收保留 S1 标识，验收后的代码随用户后续授权的维护提交一并入库。

- [x] **S1.1** 当前实际工作区及包含 WIP 的候选均执行原生测试：42 通过、1 权限用例未验收；与旧 HEAD 29 测试分开记录。

```powershell
cargo test --offline --manifest-path src-tauri/Cargo.toml --lib
npm test -- src/test/st-import.test.ts src/test/st-import-card-lifecycle.test.tsx src/test/st-import-selection-lifecycle.test.tsx src/test/st-import-presentation.test.ts --reporter=dot
```

期望：退出码 0；测试数可能随新增用例变化，不固定要求仍是 29。离线缺少依赖时仅经许可下载；不得把缓存缺失记录为代码通过。

- [x] **S1.2** 已核对并补修以下生命周期矩阵，新增 `st-backup-import.test.ts`；故障注入和延迟回调通过，真实 picker/设备交互单列未验收。

| 情形 | 必须满足 |
|---|---|
| 校验、解压、扫描、入库分别取消 | 不再开始下一项工作；已有持久化成功项如实计数；不报告“全部完成” |
| 取消后立即重试 | 新任务不继承旧取消标记，旧异步回调不更新新界面 |
| 关闭弹窗 / 页面卸载 / 库切换 | listener、Channel、计时器解绑；未完成结果不能写入另一个库 |
| 巨量文件 | 阶段首尾必报；中间节流；总数未知时不伪造百分比 |
| 解压中断、导入失败、清理失败 | 临时目录只按明确准备根清理；失败有可读反馈；不触碰来源 ST 根 |
| 含 secrets 文件的合成备份 | 跳过统计准确；测试日志不得打印秘密内容 |

- [x] **S1.3** 执行报告单独登记 WIP-01 至 WIP-04，已补回归和修复；不并入 F01-F16 的原审查编号。
- [ ] **S1.4** ST WIP 的提交/发布纳入与否单独确认。D1 修改 `lib.rs` 的提交只能暂存本轮 hunks；暂存 diff 里不得出现整组 ST 功能。

## 5. S2 — 最终验证与交付

- [x] **S2.1** 最终组合源码通过前端门禁和普通 Rust 测试；权限用例和设备限制见执行报告，不记为全部平台通过。

```powershell
node scripts/sync-version.mjs --check
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
npm run lint
npm test -- --reporter=dot
npm run build
npx cap sync android
cargo test --offline --manifest-path src-tauri/Cargo.toml --lib
```

以上是必要条件，不等价于安装包、APK 或真实窗口验证。`cap sync` 可能产生平台文件变更，检查 diff，只保留预期生成文件。

- [x] **S2.2** 在 `D:/8.Project/0_0_维护/.ste-maintenance-candidate-20260908` 完成干净 `npm ci` 和对应门禁；逐文件复制最终源码与 WIP，未使用裸 HEAD。
- [ ] **S2.3** 使用合成库和可丢弃文件完成以下人工矩阵并记录运行环境、结果和截图/日志。

| 平台 | 场景 |
|---|---|
| 浏览器真实布局 | 三个编辑器搜索 A→B，取消丢弃草稿；长单楼跨页、字号/窗口变化、连续目录/书签跳转；普通 query 不重置状态 |
| Tauri Windows | 附件改名+旧名复用；权限失败；替换/移动立绘的恢复；阅读包覆盖后重开库；仅对合成文件验证回收站 |
| Android 窄屏 | 原生分享、取消分享、摘录编辑、滚动模式正文跳转；重复打开/关闭阅读器 |
| Android 横屏 / ≥768 CSS px | 全屏小说层返回先关闭自己；弹层优先；无重复注册或错误路由回退 |
| 安装/升级 | Tauri 候选构建、Android debug 构建与安装；保留现有版本号做验证，不自动签名/发版 |
| SW 更新 | 合成旧缓存升级到构建产物，旧缓存按策略清理；离线与联网路径均检查 |

构建命令：`npm run tauri:build`；Android 在 `D:/8.Project/0_0_维护/silly-tavern-explorer-main/android` 执行 `./gradlew.bat assembleDebug`。没有对应 SDK、设备或系统权限时，标为未验收，不用单测顶替。

- [x] **S2.4** 已创建逐 F 编号的验证报告，区分已有审查证据、新增 RED/GREEN、最终自动化、原生构建和未验收项。
- [ ] **S2.5** 重新核对 S0 源码快照：不应改动的 WIP 文件哈希不变；有计划重叠的文件逐 hunk 审核。列明新增计划/测试/代码文件，确认没有真实库、凭据、测试缓存或无关参考资料被暂存。

## 6. 提交与发布纪律

建议形成约 10—14 个逻辑提交，而非按改动行数拆零碎补丁：工具链、版本、文件边界、附件、事务基座、替换、批量移动、阅读包所有权与进度、有界解压、资产导航、阅读锚点、滚动跳转、返回与分享、最终验证。可把共享测试与对应修复合并。

- 每个代码提交要有同批回归测试；先 RED 后 GREEN。配置类问题先保存当前失败命令。
- 只暂存明确文件；涉及用户已有修改的文件用 `git add -p -- <精确文件>`，随后逐 hunk 阅读 `git diff --cached`。
- 按 2026-09-08 用户授权提交已验证的维护代码与 S1；不修改版本号为一个新发布版本，不打 tag、不 push、不发布。
- 数据兼容采用双读、新写；回退应用版本不能作为数据回滚方案。旧版不一定理解新附件路径标记或恢复日志，首次用候选版验证时使用合成库/经用户自行备份的副本。
- **完成定义：F01—F16 每项都有修复和回归证据，所有必要自动化通过；未满足的原生/设备门禁明确列出，未完成的发布验收不得标为完成。**

## 7. 规划自检记录（2026-09-06）

- 已从磁盘重新读取本总计划和四份子计划；五份计划的本地链接均可解析。
- 已核对 Files 清单：所有 `Create` 路径当前不存在；所有 `Test`、`Modify`、`Inspect` 和回归路径当前存在；不存在把已有 `novel-view-interaction.test.tsx` 误标为新建的条目。
- 已扫描计划中的未完成标记和此前发现的错误接口/路径示例；未发现未完成标记、已废弃示例、错误阅读包类型路径或错误 Tauri 测试路径。
- 已在内存中验证 Cargo.lock 替换示例 13 个 LF/CRLF、位置、重复/缺失和第三方字节保持用例；附件/journal 路径 helper 44 个边界用例；NovelLocation 页边界 15 个用例。
- 已从实际 fflate 0.8.2 类型声明核对 `UnzipFile` 的 `originalSize`、`compression` 和 `ondata` 接口，并对当前计划中的流式 ZIP 示例执行 15 个合成用例，全部通过；未写入仓库代码或真实用户数据。
- 编辑计划前后已对本轮保存的 14 个受保护工作区文件做指纹比对，结果为无变化；ST 导入 WIP 仍须按 S1 单独验收。
- 本记录不表示 F01—F16 已修复，也不表示 npm、Rust、构建、浏览器、Tauri 或 Android 门禁已通过；这些结果只能在执行阶段按 S1/S2.1—S2.5 填写。
