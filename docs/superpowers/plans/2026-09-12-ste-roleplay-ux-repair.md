# STE 聊天体验修正实施计划

**目标：** 修复原生新聊天保存假冲突，提供可恢复的失败退出、独立聊天入口和可发现的玩法引导。

**结构：** 原 ST 继续管理聊天界面；文件库负责一致读取，STE 页面提供导航、引导和恢复操作。继续使用当前隔离工作树，单代理顺序实施。

- [x] 文件库回归：在 src/test/roleplay-vault-save.test.ts 延迟真实 VaultFs 读写，验证首次开场白保存期间的目录读取、迟到读取和后续保存。运行 npm.cmd run test -- src/test/roleplay-vault-save.test.ts --maxWorkers=2，先记录失败，再修 src/lib/vault/vault-backend.ts 的缓存版本与写入完成失效。
- [x] 错误与恢复：src/tavern/host-bootstrap.js 和哈希覆盖层保留服务端 error.message；src/pages/Roleplay.tsx 提供重试、独立快照导出及确认离开。扩展 frame.ts 的快照与打开设置接口；保存失败的浏览器用例验证原编辑与输入被保留。
- [x] 聊天入口：src/lib/navigation-model.ts 增加 /play 一级区域；新页面复用现有列表仓储和 startCharacterStory，加入最近对话、筛选与角色选择。App.tsx 注册列表路由，原 /chat 不变；新增导航与入口交互测试。
- [x] 引导：聊天页解释三种玩法，Roleplay 常驻设置/帮助按钮；打开原版对应抽屉并展开 STE 区域。引导展示当前连接和记忆维护条件，以现有 API 为准。
- [x] 验证：运行受影响的 Vitest、类型、lint、来源覆盖层及实际浏览器流程，在独立原生程序中验证新聊天、保存/重开和正常/失败关闭。已重建正常身份的 Windows 程序，更新 guide 与[验证记录](../../verification/ste-roleplay-ux-repair.md)并纳入本地提交。

原生验收还发现并修复了导出位置授权、自定义模型端口及 Tauri 窗口关闭权限问题。原生保存对话框尚未做端到端操作验收；选定文件的写入、取消和失败行为已通过 Rust 与桥接回归验证。

并发读写测试使用可控屏障，无固定睡眠。原生调查日志和临时用户样本仅在忽略目录中，不进入提交。
