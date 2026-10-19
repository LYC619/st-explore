# 归档维护复审修正（2026-10-19）

续接会话 `01a15272-82f3-7d50-9632-df9d163c7fc3` 最后的“根据审查发现进行修正”授权，修复 [复审记录](2026-10-19-archive-maintenance-review.md) 的 R1–R5。范围仍为原 A/B/C 维护，不包含全局 Agent、向量 RAG、字体或阅读整体改版。

## 基线与结果

分支 `codex/playtest-1007`，HEAD `92c18cebdb4831102750bb6a95409e5b581ea243`。本次修复叠加在已有大量未提交内容上；既有修改、未跟踪文件及删除均保留。没有提交、打包或发布。

| 复审项 | 原来对使用的影响 | 修正后的行为与证据 |
| --- | --- | --- |
| R1：角色库原生导出旧世界书 | 单张和批量目录导出直接使用列表缓存和旧 PNG | 每张卡读取当前角色/绑定世界书快照并重写导出 PNG 元数据；多候选提示去角色详情选择后单独导出，缺失和写入失败逐项报告，其余角色继续。真实 Library 单张 JSON、PNG 及批量入口均提取最终文件核对当前内容；来源卡不变 |
| R2：部分保存后无法重试 | 世界书已落库、角色引用写入失败，再试被当成外部冲突 | 当前编辑会话保留已写入目标和确切内容基线，继续编辑也可重试同一副本。文件写入失败不虚构部分提交；外部实际修改及不同的既有派生内容仍拦截。IndexedDB、Vault + MemFs 的编辑/保存/返回/重开用例通过 |
| R3：冲突草稿无法导出 | 提示先导出，但导出又强制保存并失败 | 保存错误时，原工具栏导出按钮明确变为“导出未保存草稿”，文件名带相同标记，直接输出编辑器内容；库内新版本和失败状态保留。正常导出仍等待保存 |
| R4：高级接口链接被拒绝 | 无扩展名 HTTP(S) 图片 URL 在来源去重前被拦，根本未下载 | 来源规范化与自动列表的扩展名识别分开；高级链接及逐行手动修正保留协议/登录信息校验，由下载后的真实字节验证格式。真实 PNG 响应、预览、导入和再次打开去重通过 |
| R5：同名新源行继承旧链接 | 改换原文图片后，旧手动 URL 被套到新图片 | 高级解析保留完整匹配文本和原始行号；按源内容继承修正。同名不同链接、原行换序、不连续行号和源内容变更均有回归 |

## 验证与失败处理

- 修复前将原复审的 5 个期望行为断言恢复为正式回归，重新运行均失败；修复后均通过。
- 最终全量：`npx vitest run --reporter=dot --silent=passed-only --maxWorkers=4`，**251 文件通过，2127 项通过、1 项跳过**。日志：`.cache/archive-review-20261019/fix-full-suite-rerun.log`。
- 首轮全量与构建同时执行时，新增集成文件首条用例触及 5 秒上限，后续用例受到尚未完成的测试流程影响；其余 250 文件通过。已将该文件的固定等待改为条件等待、清理 Router，并为真实编辑器集成用例设置 15 秒上限。保留首轮日志 `fix-full-suite.log`，不将其计作通过。
- 应用/Node 类型检查通过：`npx tsc --noEmit -p tsconfig.app.json`、`npx tsc --noEmit -p tsconfig.node.json`。
- 本次涉及的源码和测试定向 ESLint 通过，无错误或警告。
- `npm run build` 通过，日志 `fix-build.log`；仍提示大 chunk、Vite 配置和插件性能建议。本次未按这些建议扩大为构建重构。
- 浏览器首批：高级接口 URL、源行变更以及既有立绘自动解析、修正、AVIF、重试、取消与设置恢复等 **6 条通过**。草稿恢复用例初次因状态选择器同时匹配工具栏和通知提示而失败；已收窄到 `main` 内状态，并保留日志 `fix-browser.log` 与失败现场。
- 草稿实际文件导出及既有角色世界书 JSON/PNG 正常导出补验 **2 条通过**，日志 `fix-browser-rerun.log`。本轮累计 **8 条不同浏览器流程通过**；前次选择器失败不掩盖，修正后只补跑受影响流程和正常导出对照。

浏览器命令：

```powershell
npx playwright test --config=playwright.roleplay.config.ts tests/roleplay/archive-review-fixes.spec.ts tests/roleplay/portrait-import.spec.ts
npx playwright test --config=playwright.roleplay.config.ts tests/roleplay/archive-review-fixes.spec.ts tests/roleplay/archive-maintenance.spec.ts --grep 'conflict recovery|character asset editing' --output=.cache/archive-review-20261019/browser-rerun
```

## 证据边界

Library 原生路径测试保留真实页面、菜单/选择、快照、仓储和文件序列化；只在原生目录选择与文件系统边界使用 MemFs。没有运行真实 Tauri 对话框、真实文件库安装包、ST 回导或 Android。浏览器测试使用合成角色和本地图片夹具，不能代替用户原始资料验收。

本次“修复完成”和“测试通过”不等于用户认可、实机验收、安装包交付或发布。世界书部分提交基线用于当前编辑会话；本次没有引入跨进程事务恢复系统。

浏览器失败现场截图还显示 1360×900 下世界书顶栏标题受挤压换行；保存、草稿导出按钮可操作。本次按既定范围保留布局现状，未扩展为阅读/字体改版。
