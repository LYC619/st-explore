# 早期实测遗漏项 Implementation Plan

执行：当前会话主 agent 按 executing-plans / TDD 顺序推进；保留性能第一批及其他未提交内容，不提交、不打包、不触碰真实库。

**Goal:** 补齐手动记录卷号/其他、稳定排序、备注目录与库内 30 天回收缓冲。

**Architecture:** 沿用现有角色详情、总结工作台及 Markdown 展示。新增可选 volumeCategory=other，不改变记录 kind；正常卷号兼容旧数据。删除沿用事务保留清单，新增回收期限，不把长期保留文件转成自动删除。

**Tech Stack:** React / TypeScript / Vitest / VaultFs。

## 1. 记录

- [x] 真实 SummaryWorkspace 手动添加 → 填卷号/其他 → 保存 → 返回 → 重开，覆盖仅修改卷号时草稿保护。
- [x] CaptureRecordDialog 选填楼层；普通手动录入空范围覆盖全部楼层，消息收录空范围维持未关联。
- [x] 新增共用排序：正常编号升序，未编号按已关联楼层/创建时间，其他最后；编辑时间不影响顺序。
- [x] 修改 summary types/factory/capture、RecordWorkbench、SavedSummaryList、SummaryGallery、StoryRecordsView；MD 持久化与导出保留分类。
- [x] 定向运行 `npx vitest run src/test/playtest-records.test.tsx src/test/summary-manual.test.ts src/test/record-capture.test.tsx`。

## 2. 备注

- [x] 真实 NotesSection 测试目录跳转、重复标题、Markdown 与保存重开。
- [x] 每条备注生成摘要目录，长备注可按 Markdown 标题跳转；保留原有备注 id/body/at，不做格式迁移。
- [x] 编辑器明确支持 Markdown，提供预览；目录可滚动，不扩大全局导航改版。

## 3. 文件删除

- [x] 用 MemFs 计数复现批量预检查重复遍历；共用一次预检查 inventory，提交仍重新确认。
- [x] 沿用事务暂存、版本校验、崩溃回滚，删除文件先移入库内回收区。
- [x] 用户已确认：每个文件保留满 30 天，应用运行时检查；关闭时下次打开该库检查。只调用系统 trash，不支持或失败则继续保留。
- [x] 测试删除不立即调用 trash、满期边界、长期保留不清理、修改/链接/引用/切库/部分失败；设置可查看路径和保留规则。
- [x] 定向运行 file-maintenance / delete-confirm-dialog / archive-deletion / portrait 测试。

## 4. 验证与交接

- [x] 应用/Node 类型检查、改动 lint、全量 Vitest、前端构建。
- [x] 浏览器真实入口检查新增/保存/返回、列表次序与目录跳转；明确未测 Tauri/Android 边界。
- [x] 更新 CURRENT 和验证记录，分别说明实现、验证及未打包状态。

## 完成记录

2026-10-23 已完成本批源码及验证，最终全量 262 文件 / 2203 通过 / 1 跳过。一次独立只读复核未发现阻断问题，原生 Tauri / Android 尚未验收；未提交、打包或发布。详见 [验证记录](../../verification/2026-10-23-playtest-followups.md)。
