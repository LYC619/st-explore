# 2026-10-11 文件维护与故事操作验收

## 实施范围

- 用户主动删除角色、故事、记录、故事树和独立资产时，文件库弹窗显示文件数量、大小和“同时删除 STE 库内文件”，默认不勾选。浏览器 IndexedDB 模式不显示磁盘文件选项。
- 未勾选时将受管理文件移入 `.ste/retained`，避免重新打开文件库后重新索引；勾选时优先回收站，不支持时明确提示永久删除。立绘清理在档案持久化后执行。单独移除附件保持既有原地保留方式，并增加同样的选择项。
- 删除角色将故事转为未绑定；删除故事将日记、总结和故事树转为永久未绑定记录。浏览器模式同时通过事务删除该故事的运行文件，防止隐藏占用。
- 设置 → 数据与备份 → 文件检查与清理：分类、大小、定位、勾选、确认和结果报告。保留文件、确认无引用的 STE 立绘及空目录可清理；有效独立资产、备份和不明文件受到保护。读取失败、未恢复操作、切库、链接、引用或内容变化会阻止或跳过清理。
- 单条日记、总结、自定义记录可移动至另一故事的主线或分支。保留最初来源；原楼层不会直接用于目标故事跳转或重新生成，须主动关联目标楼层。未保存的正文或楼层关联阻止直接移动。
- 故事列表可复制已保存的完整故事：主线、分支、章节、收藏、设置、状态、记录、故事树和持久化记忆。ID 与引用重映射；正文、外部扩展字段与共享资产保持原值。副本清除 ST 写回和旧聊天定位信息，生成期间拒绝复制，暂存失败清理残留。
- 未打开过的分支在复制前完成已保存记忆的继承；未完成或损坏的记忆操作阻止复制。世界书版本链经真实读取服务验证。
- 标签数字按类型和搜索范围计算；不叠加已选标签条件。全库标签定义、管理计数与已选零计数标签保留。
- 阅读体验记录为后续方向，本轮没有新增阅读布局改造。

## 验证

| 检查 | 结果 |
| --- | --- |
| 最终全量 Vitest | 232 个测试文件通过，2037 项通过、1 项跳过，耗时 73.44s |
| 最终删除、移动、复制与记录界面回归 | 7 个文件、45 项通过 |
| 副本与分支继承、聊天目录回归 | 3 个文件、50 项通过 |
| TypeScript 应用与 Node 配置 | 通过 |
| 本轮 55 个变更源码文件 ESLint | 0 errors；共享测试辅助文件有 1 条已有 Fast Refresh warning |
| 最终生产构建 | `npm run build` 通过，耗时 47.60s；保留已有大 chunk、静态/动态混合导入及构建工具建议 |
| 浏览器冒烟 | Edge headless，7 个流程通过，页面运行异常 0 |
| 差异空白检查 | `git diff --check -- src scripts/smoke/library-maintenance-smoke.mjs` 通过 |

浏览器脚本：`scripts/smoke/library-maintenance-smoke.mjs`。使用全新浏览器上下文与测试数据，不访问真实用户库。流程包含 18 张剧情卡/6 张精品、复制故事、跨故事移动日记及禁止错误重新生成、IndexedDB 删除弹窗、文件库默认保留、设置扫描和清理、390px 窄屏布局。文件库浏览器流程使用正式文件后端配合内存文件系统。

文件故障测试覆盖多文件删除部分失败、回收站失败、事务恢复、未知/共享文件保护、扫描不完整、切库、文件变化、跨目录记录移动与重启、副本写入或发布失败、正文恰好等于 ID、真实世界书版本链与未打开分支记忆。

主要命令：

```powershell
node node_modules/vitest/vitest.mjs run --reporter=dot
node node_modules/vitest/vitest.mjs run src/test/story-maintenance.test.ts src/test/archive-deletion.test.ts src/test/organize.test.ts src/test/summary-workspace.test.tsx src/test/story-workspace-views.test.tsx src/test/move-record-dialog.test.tsx src/test/delete-confirm-dialog.test.tsx --reporter=dot
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json
npm run build
node scripts/smoke/library-maintenance-smoke.mjs
```

日志保存在 `.cache/maintenance-*.log`；截图保存在 `.cache/library-maintenance-smoke/`。源代码快照 `.cache/maintenance-1011-baseline/src` 用来区分本轮与原有工作区改动。没有提交或重置原有未提交内容。

## 平台限制

本轮未运行原生 Tauri 安装包、真实 Windows 回收站或 Android 设备。回收站分支及其失败处理使用 VaultFs 替身验证，不能替代原生平台验收。对无法证明归属的旧文件只提供查看/定位，不自动删除。
