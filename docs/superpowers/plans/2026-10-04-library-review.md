# Library Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增角色库回顾视图，连续切卡阅读按故事分组的全部总结。

**Architecture:** 角色库查询和视图入口保持在 Library。独立的回顾组件使用轻量故事索引聚合总结，仅打开故事时加载正文；会话记忆按文件库隔离，保存使用现有事务入口。

**Tech Stack:** React 18、TypeScript、Tailwind、Radix、现有 archive/repo、Vitest、Playwright。

用户在当前会话已批准设计方向与全部故事分组默认值。设计细节见同日 spec；工作目录为已有 linked worktree，分支 codex/library-review。

## Task 1: 回顾聚合、会话与内容组件

**Create:** src/components/library/review/LibraryReviewView.tsx、review-model.ts、review-session.ts、ReviewRecords.tsx、ReviewCharacterContent.tsx，以及 src/test/library-review*.test.tsx / .ts。

接口固定为：

```ts
interface LibraryReviewViewProps {
  characters: ArchiveCharacter[]; // 已经筛选、排序后的完整结果
  storyIndex: StoryIndexEntry[];
  onCharacterChange: (character: ArchiveCharacter) => void;
  onStoriesChange: () => Promise<void>;
}
```

- [ ] 写行为测试，使用 A/B 两卡、A 的两故事与主线/分支总结；断言两个故事全文同时出现、切 B 保留总结页签、切回 A 恢复位置。
- [ ] `npx vitest run src/test/library-review.test.tsx` 确认新入口缺失失败，然后实现上述组件。聚合函数输入为故事索引与总结，不读正文。
- [ ] 在 `review-session.ts` 导出当前库作用域的会话读写及清理函数，同时支持 Library 的 searchQuery、tagFilters、typeFilter、sortKey、sortAsc、page。由父组件集成时确定类型接口。
- [ ] 编写并验证迟到读取、错误重试、空总结、主线/分支来源、只加载选中故事、元数据保存失败的测试。
- [ ] 用现有 updateCharacter/commitCharacterPatch/applyCharacterTagPatch 实现备注、评分、标签，故事状态走 updateArchiveStory。复用阅读器时保留保存切换约束。
- [ ] 跑组件相关测试并自查 spec；提交本任务文件，报告命令、结果和任何偏差。

## Task 2: 角色库入口与查询恢复

**Modify:** src/lib/library-view.ts、src/hooks/use-library-view-prefs.ts、src/components/library/LibraryToolbar.tsx、src/pages/Library.tsx。

- [ ] 给现有角色库行为测试添加 `ste-library-view=review` 和第三入口测试，先确认失败。
- [ ] ViewMode 扩展为 `'grid' | 'list' | 'review'`，合法偏好恢复 review；保留旧非法值回退 grid。
- [ ] Toolbar 增加回顾入口和外观选项；回顾中不显示不能操作的批量管理，切换视图关闭批量选择。
- [ ] Library 保存现有 load 读取的 StoryIndexEntry[]，把完整 filtered 结果传入回顾组件，回顾不使用卡墙分页；收起筛选栏但保留展开入口。
- [ ] 使用 Task 1 会话状态保存查询/返回位置，库切换隔离；onCharacterChange 只按 ID 更新当前角色，onStoriesChange 调 load。
- [ ] 验证视图切换、搜索、返回恢复和原网格/列表/批量管理测试。

## Task 3: 审查、验证与交付

- [ ] 独立 spec review，修复缺项后独立 code quality review。
- [ ] `npx tsc --noEmit -p tsconfig.app.json` 与 node 配置类型检查无错误。
- [ ] `npm run lint` 无新增错误；`npm test -- --reporter=dot` 全量通过。
- [ ] `npm run build` 成功；在桌面和窄屏使用合成数据验证实际切卡与来源展示，不接触用户归档。
- [ ] 更新使用文档与验证记录，检查 diff 只包含本次功能；提交完成结果。无远端推送或发布。
