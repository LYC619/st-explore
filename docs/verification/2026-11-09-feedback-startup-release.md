# 2026-11-09 反馈与启动修补：阶段快照双包

用户要求打包，随后说明Claude仍在修复。双包已从独立快照构建完成；**本批是阶段快照，不是Claude修复完成后的统一验收包**。无需中断或覆盖他的修改，本次没有提交、推送、安装或启动正式程序。

## 来源与构建

- main `73a6f461d4c2933cab5eb4b8a5a4c39323cda0af` 加冻结时未提交的配置保护、五项反馈及S4补修。
- 2,158项源码冻结于 `.cache/package-feedback-startup-1109/source`；Node依赖使用现有node_modules链接，未安装或改动依赖。
- Vite和Tauri release/NSIS均在快照工作目录执行；仅复用 `.cache/package-config-review-1108/target` 编译缓存，与日常工作区target及独立原生测试target分离。没有运行旧数据目录测试脚本。
- 版本检查、生产前端、原生优化编译及NSIS打包通过。2,158项冻结源码在构建前后相同，1,190项最终前端在原生编译前后相同。
- 完成时工作区 `scripts/tavern/host-overlay.mjs` 已有后续修改，快照未吸收。差异是新增模块求值完成标记及其返回路径调整；没有检查或验收这项进行中的修复。

## 文件

位于 [release/2026-11-09-feedback-startup](../../release/2026-11-09-feedback-startup/使用与体验更新.md)：

| 文件 | 大小 | SHA256 |
| --- | ---: | --- |
| STE-0.9.9-2026-11-09-feedback-startup-portable.exe | 37,424,640字节 | 19a1c37896889ee66a517b50b004e92d98553e57341da922bff9855a3d6b63e8 |
| ST-Explorer-0.9.9-2026-11-09-feedback-startup-setup.exe | 27,143,028字节 | cacc9c9d35272c165aa4b234f328f3af0f5affbadfc61141a618dae81c4fa4d7 |

复制后哈希一致，文件时间属于本次构建；应用PE为x64，NSIS引导PE为x86、安装目标为x64。未签名状态没有改变；本轮未执行安装器或正式exe。

## 验证与证据继承

- 最终生产前端5组浏览器冒烟通过：正常加载/刷新、模块失败重试、连接缺失仍阅读、390px/44px重选、刷新后保留选择。仅合成故事，无真实模型请求。
- 与[S4证据](2026-11-09-s4-startup.md)7项及[五项反馈证据](2026-11-09-feedback-fixes.md)23项文件哈希匹配。沿用此前310文件2516测试、59酒馆测试、类型检查及独立Windows测试，不称本轮重跑全量或正式exe运行。
- 最终1,190前端文件与工作区此前dist相比，1,188相同，两个重新编译的lib bundle字节不同。新浏览器验证使用本轮最终dist；不声称旧原生测试二进制与正式包字节相同。
- `source-inputs.json`、`frontend-inputs.json`、`build-execution.json`、`evidence-reuse.json`、`previous-dist-comparison.json`、`worktree-comparison.json`、`browser/result.json`及`build-manifest.json`记录输入、验证与差异。补丁和未跟踪源码副本保留在包目录用于追溯，不含配置备份和私人库。

## 剩余边界

真实总结拒绝、原始S4偶发原因、S5关窗残留、配置跨进程写入竞争均不能凭此包宣称解决。Android真机、本次安装生命周期和真实库实测未完成。打包没有访问或恢复正式配置，也不沿用此前Codex虚拟化视图的“已恢复”结论。

建议Claude完成修复和验证后，冻结新的完整源码再打统一包；这份包只代表冻结时已有成果。
