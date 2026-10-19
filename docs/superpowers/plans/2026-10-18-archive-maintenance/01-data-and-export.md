# A：数据与导出可靠性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `executing-plans`。先读 [总计划](README.md)，按下列步骤实施。

**Goal:** 编辑后的内容可靠保存、归属正确、可从 STE 导回 ST。

**Architecture:** 共用现有写入队列与资产派生服务；导出从当前持久数据组装副本；原生保存通过现有选址命令扩展，完整备份与精简导出有明确契约。

**Tech Stack:** TypeScript/React、Tauri/Rust、VaultFs/IndexedDB、Vitest、Playwright。

## 执行状态（2026-10-19）

实现及自动化交付完成；A 真实页面 3 条通过，最终集成 2109 通过、1 跳过。勾选表示代码/对应自动化完成，不代表实机验收。未勾选的混合验收项已完成浏览器或仓储部分，Tauri 对话框、ST 实际往返及带脚本实机路径仍未覆盖。详见 [验证记录](../../../verification/2026-10-18-archive-maintenance.md)。

## A1. JSON 原生导出故障与 PNG 保存反馈

**修改：** `src-tauri/src/lib.rs`、`src/lib/vault/tauri-fs.ts`、`src/lib/roleplay/export-package-file.ts`、`src/lib/character-file.ts`、`src/pages/CharacterPage.tsx`。新增 `src/test/character-file-export.test.ts`，扩展 Rust 导出测试。

已发现明确源码缺口：`save_text_export` 的 extension 分支只接受 `jsonl` 和 `ste-play`；前端角色/故事 JSON 传 `json`。PNG 则直接 a.click，没有统一返回结果。

- [ ] 从详情页分别导出故事 JSON、角色 JSON、PNG；记录浏览器/Tauri 差异及原生实际错误，现状 JSON 应复现“不支持的导出文件格式”。
- [x] 将原生命令的允许集合显式扩为 `json`、`jsonl`、`ste-play`，为 JSON 设置适当文件过滤器；不要放开任意扩展或任意路径写入。
- [x] 增加二进制导出命令/桥接，复用 Rust 原生 save dialog 与原子文件写入。路径仅由保存对话框产生；PNG 不写进用户选定资料库冒充导出。注册到 invoke handler。
- [x] 统一文件保存结果为 `saved | downloaded | shared | cancelled`；网页用 Blob 下载、Android 保持分享语义、桌面实际选址。取消无成功提示，失败保留异常并反馈，成功包含文件名或位置（平台可获取时）。
- [x] PNG 统一走上述路径；生成 PNG 内容的当前世界书更新由 A3 完成。Blob URL 在下载调用有机会消费后再回收。
- [ ] 行为验收：JSON 文件可解析；PNG 可提取卡数据；取消零写入；无权限/空间故障不显示成功；从详情页重复导出不会锁住按钮。

原生允许集合的最小改动形状：

```rust
let label = match extension.as_str() {
    "json" => "JSON 文件",
    "jsonl" => "SillyTavern 聊天文件",
    "ste-play" => "STE 完整故事包",
    _ => return Err("不支持的导出文件格式".to_string()),
};
```

**验证命令：** `npx vitest run src/test/character-file-export.test.ts src/test/story-file-export.test.ts --reporter=dot`；`cargo test --manifest-path src-tauri/Cargo.toml`。首次新增回归应暴露当前行为，修复后全部通过；原生对话框另做实际操作记录。

## A2. 世界书自动保存、恢复与当前引用

**修改：** `src/pages/WorldBook.tsx`、`src/hooks/use-worldbook-session.ts`、`src/hooks/use-worldbook-draft-state.ts`、`src/lib/asset-cow-save.ts`、`src/lib/character-asset-ref.ts`（按需要最小修改）。新增 `src/hooks/use-worldbook-autosave.ts` 和 `src/test/worldbook-autosave.test.tsx`；更新原保存/导航用例。

**保存契约：** 已有目标书且内容变化 → 约 600ms 防抖 → 串行持久保存 → 标记对应版本已保存。期间新输入保留为下一版本，旧保存完成不能清除新 dirty；静止后写入最新版本。草稿暂存不是成功落库。

- [x] 复现“从角色资产进世界书 → 加总结条目 → 直接返回角色 → 重新打开/重启”；检查真实仓储、角色引用与编辑器会话，不只看 sessionStorage。
- [x] 把手动保存现有业务抽为可等待的共用保存操作，自动保存和 Ctrl+S 调同一条路径；不要在 effect 里复制第二套 COW 逻辑。
- [x] 保存捕获库 epoch、角色 ID、书 ID、修订；首次派生只创建一次，后续编辑转到当前书；退出、切书和导出前 await flush。页面导航使用可等待的边界，不能依赖异步 unload 才写盘。
- [x] 标题区显示“保存中/已保存/保存失败”；失败保留草稿、提供重试并阻止把失败快照当导出新版本。新建未命名书初次明确目标后启用自动保存。
- [x] 基于现有 COW 保留原资产作恢复依据，改后引用指向当前书；多个角色共享原书时不悄悄影响其他角色。补上从当前书查看来源/恢复内容的轻量入口；恢复也通过同一保存链，不删除当前书和记录。
- [x] 自动保存不得仅因挂载、切换、恢复草稿而创建新副本；当其他界面已改同一本书，检查修订并保留双方内容/冲突信息，不用旧编辑快照覆盖新值。
- [x] 自动保存生效后保留 Ctrl+S 作为立即 flush；统一提示，避免每次键入 toast。

**必须覆盖的行为：** 连续三次输入只持久最新值；第一次保存未完成时再编辑；首次 COW 队列只产一个副本；保存失败重试；切库后旧回调不写新库；角色删除；切页重开；重启回读；恢复旧内容；共享书另一角色不变。

**命令：** `npx vitest run src/test/worldbook-autosave.test.tsx src/test/worldbook-session-persist.test.tsx src/test/worldbook-save-guard.test.tsx src/test/worldbook-navigation.test.tsx --reporter=dot`。旧测试若断言手动保存行为，按新用户要求调整期望，但保留失败/冲突保护。

## A3. 当前世界书装入角色卡；统一聊天导出含义

**修改：** `src/lib/character-file.ts`、`src/lib/card-export.ts`、`src/lib/png-writer.ts`、`src/lib/story-file-export.ts`、`src/components/chat/ExportButton.tsx`、`src/components/character/StoryListSection.tsx`、`src/pages/CharacterPage.tsx`。
**新增：** `src/lib/character-export-snapshot.ts`、`src/test/character-export-snapshot.test.ts`；需要共用聊天组装时新增 `src/lib/chat-export-policy.ts`、`src/test/chat-export-policy.test.ts`。

- [x] 从当前仓储重新读取角色与引用世界书，不能直接序列化页面挂载时的 character。A2 待保存编辑必须先完成。
- [x] 目标优先使用当前 `embedded` 引用；没有内嵌则选明确的 `primary`。同一目标重复引用折叠；多个候选不猜测，展示本次导出选择（不更改库内关系）。额外/聊天世界书保持各自归属，可另导出；不静默合并。
- [x] 在导出快照中用当前世界书更新 `character_book` 及对应 ST 绑定信息。复用现有 ST 转换器，保留条目未知字段、MVU 变量、脚本、正则及卡片其他字段。不得把 STE 展示简介意外覆盖卡原字段。
- [x] PNG 用当前卡快照重新嵌入角色数据；保留图片内容并处理已有角色元数据块；JSON 与 PNG 提取后的卡内容应等价。A1 的“导出成功”必须发生在真正保存之后。
- [x] 明确菜单：`SillyTavern JSONL（精简）` 作为常用项；完整 JSONL/JSON 有可发现的备份入口，更多设置继续保留但不承担必要的普通导出。
- [x] 两处相同导出选项共用一个处理函数：范围、隐藏标记、规则深度、当前 swipe 内容同步、其他候选/缓存处理一致。详情页读当前故事保存的规则；没有规则不猜测另一故事的设置。已“应用到原文”的非幂等规则不得因无意重复应用破坏正文。
- [x] 导出副本变化不反写故事真源；完整导出保留所有原始候选和扩展，精简导出仍能导回 ST。

**用例：** 卡内书原内容 A → 编辑为 B 并增加卷总结 → 导 PNG/JSON → 提取皆为 B；原资产 A 可恢复；无世界书卡无新增空书；多来源冲突显式选择；当前选中 swipe 被编辑后两出口内容一致；不同故事规则隔离；导出前后真源哈希相同。

**命令：** `npx vitest run src/test/character-export-snapshot.test.ts src/test/card-export.test.ts src/test/story-file-export.test.ts src/test/chat-export-policy.test.ts --reporter=dot`（共用模块未新建时从命令去掉对应新测试，保留同等行为覆盖）。

## A4. 副本与原故事的成果归属核查

**检查/修改：** `src/lib/story-maintenance.ts`、`src/lib/summary-db.ts`、`src/lib/story-tree-db.ts`、`src/components/character/StoryRecordsView.tsx`、`src/pages/CharacterPage.tsx`、`src/lib/editor-story-context.ts`；扩展 `src/test/story-maintenance.test.ts`，新增 `src/test/character-record-scope.test.tsx`。

- [x] 创建 S1（2 总结、2 日记、1 树，含一分支），复制 S2；记录前后故事/成果 ID、bookId、branchId 和文件路径。当前设计应为复制新记录，原记录不移动。
- [x] 从 S2 清理并生成新树，返回角色详情切 S1/S2，验证加载请求乱序、切 tab、返回后的选中故事；找出实际错误层再修复，不能仅删掉复制成果功能“解决”。
- [x] 初始化与切换按稳定故事 ID；列表刷新删除/移动后，目标不存在才选择明确回退；迟到请求不能覆盖当前故事列表。
- [x] 修复实际发现的共享引用、持久化或状态错误；若原数据正确且是复制结果认知问题，显示“包含总结/日记/树的完整副本”及来源，不伪称数据修复。
- [x] 重开页面与资料库后复核；保证 S1 后续编辑不会改变 S2，反之亦然。

**命令：** `npx vitest run src/test/story-maintenance.test.ts src/test/character-record-scope.test.tsx --reporter=dot`。浏览器同一真实流程必须记录。

## A5. 模型刷新与 unused 用户名称

**检查/修改：** `src/lib/roleplay/tavern-host.ts`、`src/components/ai-tools/useApiProfiles.ts`、`src/components/ai-tools/useOpenAI.ts`、`src/lib/roleplay/live-chat.ts`、`src/lib/roleplay/user-avatars.ts`、`src/tavern/host-bootstrap.js`；补充 `src/test/roleplay-tavern-host.test.ts`、`src/test/roleplay-live-chat.test.ts`，新增 `tests/roleplay/archive-maintenance.spec.ts`。

- [x] 模型 fixture 第一次返回 M1、第二次 M1/M2；在真实继续聊天入口点击模型刷新/连接，记录是否只读保存的 modelList。
- [x] 将显式刷新接到已有模型获取逻辑，并保存到对应 profile；切换连接、重新进入页面时重新验证列表，可先展示缓存但必须标清并刷新。取消/失败保留旧列表并提示，手输自定义模型仍可用；不在每次渲染时请求。
- [x] 捕获 profile ID 和地址版本，旧请求返回不能覆写新连接模型；不把 API Key 放到夹具快照或日志。
- [x] 为 unused 分别追踪所选 Persona、实际发送请求、生成消息 name、首行 metadata 和 STE 阅读展示。旧聊天每条合法名字必须保留；不能全文件替换 unused 或直接把所有 user 改成当前 Persona。
- [x] 只在无效占位名字的正确边界取已选 Persona/会话的有效名称；修复后的新消息、保存、刷新、导出均一致。若用户真命名为 unused，用来源语义而非字符串全替换处理。
- [ ] 测试更换 Persona 后新消息正确、旧消息名字不变、主线/分支互不串名；带脚本与不带脚本各验证入口。

**命令：** `npx vitest run src/test/roleplay-tavern-host.test.ts src/test/roleplay-live-chat.test.ts --reporter=dot`；`npx playwright test --config=playwright.roleplay.config.ts archive-maintenance.spec.ts`。

## A6. 批次出口

- [x] 运行总计划的类型检查、改动文件 lint、构建和本批测试；保留基线比较。
- [ ] Tauri 实测 JSON/PNG 保存及取消、编辑立即返回/导出；浏览器实测复制、切故事、模型和 Persona。
- [ ] 导回 ST 检查世界书新增条目和 MVU 数据；更新验证记录和 CURRENT。到此才可报告 A 批完成，无法覆盖平台单独列出。
