# Gemini 审查 R1–R9 修复执行记录

2026-11-23，Codex；用户授权在 `refactor/ux-and-polish` 串行修复全部九项、转正式回归并运行完整 verify 与相关 Web／分屏 E2E。起始 HEAD `01e316fa89e1df918ea6049b3a3fc7e5536f773a`；保留已有审查报告及 CURRENT 修改。不合并、不推送、不打包。

## 范围与恢复点

- R1 / R7：阅读同步保存基准、关窗末次同步、故事及支线阅读位置。
- R2 / R5：工厂预设完整恢复与运行设置保留、角色副本显式改名。
- R3 / R4 / R6：首次保存失败可重试、标题进入保存队列、Esc 取消。
- R8 / R9：三种跨文档弹窗隔离、受控关闭一次性放行与确认关闭后切状态。
- 保持已回退的 0.9 交互；只使用合成资料，不启动正式原生程序或读取真实库。

## 进展

- R1：接纳远端同步同时更新保存基准，保存回调包含独立窗口状态；OS 关窗后的最终 flush 使用 closing 状态保留内容所有权，完成后再读回一次。最终读回后停止订阅，避免普通编辑被自己的保存通知重新覆盖；读取失败显示恢复指引。
- R7：轻量指针增加 branchId，旧指针按主线兼容，active session 读取对应支线；主线／支线的 lastFloor 单独写回，分屏只读时也能记位置。恢复计时器在实际跳楼后才消费目标，避免导航二次读取取消计时器后丢失恢复位置。
- R2：从工厂预设目录取回实际正文，切换时不继承旧预设的提示词／采样残留；连接、模型格式、请求头等运行设置按名单保留。同一预设有效草稿仍保留。R5：显式改名意图传入 COW，覆盖新建和已有专属副本。
- R3 / R4 / R6：首次写入及后续修改共用串行保存链，成功后才建立保存基准；失败保留草稿，空白创建成功提示等待实际写盘。标题和内容共同进入快照与续写队列，失败改名保留供重试；Esc 用 ref 跳过一次 blur 提交。
- R8：新增小型跨文档弹窗内容层，遮罩、焦点、键盘关闭与滚动仅归属子窗口；同文档保留原 Radix 内容和样式。覆盖 Dialog、Sheet、AlertDialog（含取消按钮）。
- R9：保存成功后仅放行本次子窗口 beforeunload，随后立即复位；先核对 win.closed 再卸载 portal／清理监听／导航。关窗被取消时保留窗口与内容，删除故事和主工作区释放入口也尊重取消。
- 已更正前序执行记录中不存在的 preset-compiler.ts 及“统一引擎”说法。保留上一轮只读审查原始结论，不把后续修复回写为当时已通过。

## 验证

临时输出写入 `.cache/verify/2026-11-23-gemini-fixes/`。所有输入为合成资料，未调用真实模型。

| 缺陷 | 正式回归及关键断言 |
| --- | --- |
| R1 | `reader-sync-progress.test.tsx`：真实阅读工作台接纳新增楼层，关窗后改名写回；延迟最后一次 flush 后再编辑，新增回复仍保留。 |
| R2 | `roleplay-factory-preset-restore.test.ts`：恢复选中工厂预设正文与上下文长度，旧预填词消失，必要运行设置保留。 |
| R3 | `worldbook-save-lifecycle.test.tsx`：空白创建和文件导入首次失败后仍可保存重试，创建失败不报成功。 |
| R4 | 同上：写入中改名等待正确标题保存；失败后新名保留可重试。`worldbook-autosave.test.tsx` 补充跨资产串行 flush 的完成时机。 |
| R5 | `preset-rename-cow.test.tsx`：真实 COW 链路保留显式新名。 |
| R6 | `worldbook-save-lifecycle.test.tsx`：真实输入框 Esc 后触发失焦仍保持原名。 |
| R7 | `reader-sync-progress.test.tsx`：实际工作台跳楼并切出／切回支线，楼层与带 branchId 的轻量指针一致；旧指针兼容主线。 |
| R8 | `foreign-dialog.test.tsx` 与 `detached-review-regression.spec.ts`：三类子窗弹窗、主窗真实滚轮、Esc／遮罩关闭和保存失败重试。 |
| R9 | `detached-close-cancel.test.ts` 与上述 E2E：带草稿受控收回／关闭不二次询问，重新弹窗恢复防丢保护；另一关闭监听取消时保留原 iframe 和路由。 |

保存页面测试对存储接口注入故障，阅读与 COW 测试使用合成库；浏览器用例运行真实酒馆 iframe 与同源子窗口。两类证据不混作原生桌面验证。

- 正式回归迁移前，9 项检查中 7 项正确行为断言失败、2 项正常对照通过；baseline.log 记录旧代码缺陷。
- 定向检查逐批覆盖真实阅读工作台、真实 host、世界书页面、COW 及内存／浏览器库。reader-sync-progress、roleplay-factory-preset-restore、worldbook-save-lifecycle、preset-rename-cow、foreign-dialog、detached-close-cancel 六个正式文件。
- 新增 detached-review-regression.spec.ts 的 5 项真实 Chromium 分屏 E2E 已通过：主窗实际滚轮、子窗三类弹窗 Esc／遮罩、保存失败恢复、带草稿收回与关闭、再次弹出恢复 guard、外部 beforeunload 取消仍保留 iframe。第二次运行日志 browser-second.log；首次运行只有重新弹出后未等酒馆 ready 的测试失败，增加真实“过程”按钮就绪等待后通过。Windows 测试服务未自行结束，全部用例完成后按本轮已知 PID 停止服务，使 Playwright 汇总退出。
- 首次完整 verify 的 lint／两组类型检查通过，Vitest 为 336 文件通过、2 文件失败（2,721 通过、2 失败、1 原有跳过）。两项均按本轮改动处理：默认第 0 楼与未记录位置视为等价，避免仅打开就写库；导入新书时 flush 等待旧任务后确实写入新书，旧任务失败也不能冒充新书保存结果。原导航用例改为断言串行写入及目标不被旧保存夺回，另补跨 scope flush 完成时机回归。修正后相关 6 文件／53 项全部通过，见 boundary-followup.log。
- 第二次完整 `node scripts/verify.mjs` 以 `VITEST_MAX_WORKERS=1` 串行完成，11/11 全通过：338 文件、2,724 项前端测试通过／1 原有跳过；16 项工程脚本、64 项酒馆脚本、3 项冒烟脚本；版本、lint、两组类型检查与生产构建通过；Rust 66 项通过／1 原有忽略，Clippy 通过。逐步日志在 `.cache/verify/2026-11-23T12-08-41-307Z/`，汇总为 `verify-final.log`。
- 最终产品与正式测试的 27 个变更文件 SHA256 已写入 `verified-inputs.json`；后续完成交接时再次比对，确保验证与交付源码一致。
- 最终源码上重跑完整酒馆／分屏 E2E，62 项通过、1 项原有跳过（缺少可选 helper.zip）；生产 Web E2E 7/7，通过桌面／窄屏、页面资源失败恢复、主导航及合成服务错误分类等路径。日志分别为 `roleplay-final.log`、`production-final.log`，均退出码 0。两次测试服务在全部用例完成后未自行退出，分别仅终止本轮已确认的服务 PID 22760、33204，随后取得 Playwright 成功汇总。

## 交付边界

本轮不改版本，不提交／合并／推送，不打包；原生 WebView2 与 Android 未重跑，用户体验验收未完成。修复仍在当前分支工作区，旧体验包不包含本批改动。
