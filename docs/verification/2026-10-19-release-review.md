# 2026-10-19 提交与打包前复核

用户授权：“再审查一下，没问题就 commit 并打包”。本批以 `codex/playtest-1007` / `92c18cebdb4831102750bb6a95409e5b581ea243` 为原基线，包含此前 10 月维护所需的完整源码、测试及交付说明；不纳入 `_reference`、`.planning`、使用指南草稿、无关启动文件删除。没有 push 或远端发布授权。

## 复核结果与修正

两份独立只读审查分别覆盖数据/保存/导出及立绘/故事树；主流程核对实际入口、复现并修正以下四项，未扩展字体、阅读整体改版、全局 Agent 或向量 RAG。

| 项目 | 原来怎样影响使用 | 本次修正与证据 |
| --- | --- | --- |
| P1 旧世界书会话 | 普通“工具 → 世界书”恢复旧正文，却把库内较新正文当作保存基线；再次编辑能抹掉新增条目 | 用会话实际正文作保守基线。版本不同保留草稿并报告冲突；缺失资产不静默重建。真实编辑器与 IndexedDB、Vault + MemFs 均复现过新增条目被覆盖，修正后拦截 |
| P2 恢复草稿归属 | “最近打开”切书或导入替换，失败草稿仍写到前一本书的恢复键 | 切换时同步恢复键和待恢复草稿；真实最近打开/文件导入入口触发写入失败，核对只写当前目标 |
| P2 强制重新导入 | 可见预览持有旧图，勾选“重新导入此链接”仍保存旧字节 | 强制导入绕过预览缓存；普通导入仍复用。真实缓存/任务/存储回归及独立浏览器复现：红图换蓝图后请求数由 1 变 2，第二图字节、哈希均更新 |
| P2 高级前瞻捕获 | `([^:]+)(?=: (.+))` 的匹配文本不包含变化的捕获内容，改换来源仍继承旧手改 URL | 预览身份加入原始解析 URL；前瞻回归先失败后修正，普通换序保留手改的既有用例仍覆盖 |

R1–R5 的原修正及 A/B/C 定向用例再次核对。额外静态假设“失败 A 切到有恢复草稿的 B 会覆盖 B 草稿”未在真实编辑器复现：未改生产代码即通过对应测试，保留此用例，不将假设写成已修复缺陷。

## 自动验证

- 最终 Vitest：`npx vitest run --maxWorkers=4 --reporter=dot --silent=passed-only`，**251 文件、2134 项通过，1 项跳过**，退出码 0；日志 `.cache/archive-review-20261019/release-full-suite-rerun.log`。
- 本轮首次全量：250 文件通过，一条 recent-list 导航用例在真实 600ms 自动保存计时下偶发提前变为 clean，导致预期确认框不存在。单独重跑通过；该用例明确检查自动保存前的 dirty 导航，现与同组用例一样固定定时器。全量重跑通过，原失败保留在 `release-full-suite.log`。
- Rust：`cargo test --manifest-path src-tauri/Cargo.toml --lib --quiet`，**46 通过、1 忽略**，退出码 0；日志 `release-rust-tests.log`。
- 应用及 Node TypeScript 检查通过；版本同步检查通过（0.9.1）；本轮修改的源码和测试定向 ESLint 通过。
- 四项产品问题均先取得失败断言，再实施修正。红绿日志：`release-regressions-red/green.log`、`release-recovery-red-rerun.log`、`release-lookahead-red.log`。最初导入测试缺少 jsdom 的 `File.text()`、恢复确认按钮名称错误属于测试边界错误，修正后才核对产品断言。
- 浏览器最终批次 **13 项全部通过**，退出码 0（4.3 分钟），覆盖旧会话保护、前瞻捕获、强制重新下载、世界书导出、成果复制、模型/Persona 及原立绘流程；日志 `release-browser.log`。命令：`npx playwright test --config=playwright.roleplay.config.ts tests/roleplay/archive-review-fixes.spec.ts tests/roleplay/portrait-import.spec.ts tests/roleplay/archive-maintenance.spec.ts --output=.cache/archive-review-20261019/release-browser`。
- Node 版本脚本 **5 项通过**，Tavern 来源/构建校验 **48 项通过**；日志 `release-version-tests.log`、`release-tavern-tests.log`。暂存差异空白检查通过，常见密钥/私钥模式检查未命中。

## 交付与验证边界

已先提交运行源码：`78938ab7a405e1b624c10f587783bfc8efe5887f`，源码树 `15596e92372d345acb3a8becb57510355ced3047`。随后 `npm run tauri:build` 于 20:10:42–20:13:42（UTC+8）完成，退出码 0；打包前后核对构建输入均与此提交一致，不含未提交运行代码。工作区总体仍为 dirty（保留原有非构建资料）。本交付状态后续仅以文档提交补记。

Windows x64 产物位于 `release/2026-10-19-archive-maintenance/`，附使用说明、更新记录、SHA256、构建清单及完整 `build.log`：

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `STE-0.9.1-2026-10-19-portable.exe` | 37,089,792 | `c4a86ba384bf16fd0045f2cd057cae0729a1c58e086f65fab42ea190d412d997` |
| `ST-Explorer-0.9.1-2026-10-19-setup.exe` | 26,840,146 | `ada8a5e5ec005d512445cf3c4646a4cd1c8b8b4a909a6f41db39ac7152f7ae9f` |

核对两份文件均为本次构建时间之后生成，副本哈希与原件完全相同；MZ/PE 标头有效，主程序 Machine 为 `0x8664`（x64），NSIS 引导程序 `0x14c`（x86，安装 x64 应用）。构建保留大 chunk、混合静态/动态导入及一条 Rust 链接器标准输出提示，未出现构建错误。未执行安装器，也未启动用户资料库。

浏览器测试使用隔离的合成资料和本地图片；文件库测试在 MemFs/IndexedDB 边界验证。Rust 单元测试及构建不等于真实 Tauri 对话框、用户资料库、ST 往返或 Android 真机验收。不会运行安装器或打开用户实际资料库。免安装版仅程序免安装，不承诺所有资料随 exe 便携。
