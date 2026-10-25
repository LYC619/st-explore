# 回顾备注导航与角色信息栏 · 2026-10-26

本轮用户指出角色库回顾的备注仍是旧布局、折叠信息栏偏宽及栏侧滚动条突兀。基线 `codex/playtest-1007`／`18e820e`，与预设库打磨和全局交互修正并行实施。此记录仅描述本子任务，统一构建和原生验收由主任务收尾记录负责。

## 原来与现在

| 入口 | 原来 | 现在 |
| --- | --- | --- |
| 角色详情信息栏 | 收起仍占 48px；展开用可见滚动轨道 | 收起 36px，展开按钮保留 32px 点击区；展开栏可用滚轮和键盘滚动，但不绘制轨道，防止白色条带及横向溢出 |
| 角色库 → 回顾 → 备注 | `ReviewEdits` 单独实现连续备注列表，无右侧导航 | 与角色详情共用 `NotesBrowser`；左侧一篇正文，右侧上方切备注、下方跳标题；窄屏导航位于正文上方 |
| 回顾备注编辑 | 六行旧弹窗，无预览 | 与详情共用 `NoteEditorDialog`，大正文区、Markdown 预览及保存错误显示 |
| 角色切换与保存 | 回顾按打开时角色 ID、库 epoch 保存 | 保留该保护和功能更新逻辑；新增共享备注选择按角色和资料库恢复，不把 A 的选择带给 B |

实现文件：

- `src/components/character/CharacterInfoRail.tsx`
- `src/components/character/NotesBrowser.tsx`
- `src/components/character/NoteEditorDialog.tsx`
- `src/components/character/NotesSection.tsx`
- `src/components/library/review/ReviewEdits.tsx`

`ReviewCharacterContent` 的真实回顾入口继续进入 `ReviewEdits`，没有另建只供测试访问的入口。备注正文仍经已有 Markdown 解析和净化，原文、重复标题锚点、悬停全文及选篇偏好逻辑保留。回顾的备注保存仍只合并所编辑备注，保留其他备注；未扩大为角色资料整体覆盖。详情页增加提交期间的重复点击保护，并保留删除失败时的确认框。

## 本子任务验证

命令：`npx vitest run src/test/notes-navigation.test.tsx src/test/library-review-view.test.tsx src/test/review-markdown.test.tsx --maxWorkers=2 --reporter=dot`。

结果：3 文件、23 项通过。覆盖共享 Markdown／重复标题导航、详情编辑预览保存、真实回顾内容挂载、角色 A/B 选择隔离与重新打开恢复、回顾大编辑器原文与预览、保存失败后重试、保存期间切角色仍只写原实体，以及现有回顾阅读位置与资料加载保护。首次新用例把弹窗标题的 h2 当正文标题，改为限定预览正文后通过，没有据此修改产品行为。

7 个改动组件／测试文件定向 ESLint 退出 0，无告警。日志在 `.local/verification/2026-10-26-review-notes-rail/`。未运行全量测试或构建。

## 真实浏览器验收

命令：`node scripts/smoke/experience-notes.mjs`，复用 Vite `4193`。Edge 无头浏览器挂载实际 App，两个隔离 MemFs 资料库通过真实 repo 保存测试数据；没有 mock 业务组件，未读写用户资料库。入口为 `/library` 工具栏实际“回顾”按钮，不使用伪造的查询参数切换。脚本退出 0，页面异常 0。

- 桌面回顾：长标题显示省略号、悬停保留全文；上方切篇、下方目录均位于正文右侧。点击最后一个重复小标题，实际回顾滚动容器滚动超过 1000px，目标标题获得焦点并进入视口。
- 新建与保存：备注弹窗宽度超过 850px、正文编辑区高度超过 400px；Markdown 预览正常，点击保存后实际 repo 新增备注，界面选中该篇。随后手动改选旧备注，切换角色、离开页面再返回均恢复用户选择，不被之前新建的篇目覆盖。
- 资料库隔离：两库故意使用相同角色 ID、备注 ID；切到库二显示库二默认篇目，返回库一恢复库一所选篇目。
- 窄屏回顾：390×844 下导航移至正文上方；目录仍可滚动到目标标题，页面没有横向溢出。
- 信息栏：1440×700 短窗口中，展开栏内容高 753px、可视高 585px，隐藏滚动轨道；鼠标滚轮、聚焦后的 Home／End 都能实际改变滚动位置，末尾“操作”按钮可打开真实角色卡操作弹窗。
- 收起栏实测宽 36px，内容不溢出；展开、收起、离开再返回均正确恢复。深咖啡、墨黑、深夜蓝、米色典雅四主题下展开栏均不绘制滚动轨道。

截图已人工查看：`.cache/experience-notes/review-notes-desktop.png`、`review-notes-jump.png`、`review-note-editor.png`、`review-notes-mobile.png`、`info-collapsed.png`、`info-{cocoa,ink,midnight,cream}.png`。机器结果为同目录 `results.json`，命令日志为 `.local/verification/2026-10-26-review-notes-rail/browser.log`。

验证边界：以上是 Edge + 实际前端 + 隔离内存存储；保存失败重试及保存期间切角色另有上述组件集成测试。原生 Tauri／WebView2、Android 与用户真实资料库没有在本子任务中执行验收；统一构建和客户端交付由主任务处理。

现有 `feedback-release.mjs` 的折叠宽度断言应由 48px 更新为 36px。回顾备注输入现在统一为 `aria-label="备注正文"`，保存按钮为“保存”，不再使用旧的“备注内容／保存备注”名称。修改关联测试时应验证真实行为，不仅替换字符串。
