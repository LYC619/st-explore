# v3 Batch 0＋1 实施记录

2026-11-07 · Codex。用户正式批准v3并明确授权Batch 0＋1；仅实施规则沙盘，不启动Batch 2～5、真实模型、打包或发布。两批连同授权，本轮不在原型后重复请求批准，用户可随时纠正形态；可玩性认可仍待交付试玩。

基线 codex/playtest-20261031 / 01686330ad5e64b2ec2f90e257dabe813afbf7f1。已有未提交成果保留，快照`.cache/play-world-b01-before/`。

- [x] 规则世界：8区域、12人、3资源、8种持续动作、移动/竞争/协作、事件因果。
- [x] 独立WorldRepo：Vault与IDB、不可变提交、分支、回放、备份与回收站恢复。
- [x] 独立地图入口与桌面/390px界面、追踪、事件、干预、单步/自动暂停。
- [x] Worker、会话边界、切库/后台取消、停止和过期结果隔离。
- [x] 规则/存储测试、真实浏览器流程、类型/lint/构建与交接。

实现可按当前代码调整文件拆分；不复制旧失败实现。

最终 300 文件/2465 项通过；生产与源码浏览器通过。实际源码、接口、试玩路径、截图、验证边界及SHA256见[交付核验](../verification/2026-11-07-play-world-b01.md)。原生/Android、长时间性能与用户可玩性认可仍待验证，未打包。

本轮拆分：`src/play/world/{schema,simulation,simulation.worker,session}.ts`；`src/play/storage/{world-commit,world-repo}.ts`；`src/components/play/world/{WorldCanvas.tsx,world.css}`；`src/pages/WorldPlay.tsx`。规则与路径保留在小型纯模块，后批有新规则包再拆；不提前制造空框架。

关键接口：`stepWorld(state, command?) -> {state, events}`；`WorldSession.step(command?) / stop()`；`WorldRepo.create / load / list / append(expectedCommit, result, kind, command?) / checkpoint / fork / archive / export / import`。规则版本 `shanhai-1`，状态 schema 1，IDB v12。应用通过当前文件库 epoch 获取固定会话repo，写入时检查原库身份。

与初稿的明确调整：0＋1联合授权后直接交真实运行视图；结构化干预确认即推进一步，未确认可关闭；首批8动作全部有规则结算，竞争是失败结果而非单独按钮；回收站只逻辑归档，未知附件永不自动删；整档恢复含未来版本撤回提示；独立备份导入保留为新世界。本批不含AI决策、记忆中枢、角色卡导入、GAL或冒险接管。
