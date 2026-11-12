# 本地打包与发布清单

当前版本仍为0.9.9。打包只产生文件，不安装、不启动正式程序，也不自动发布。

1. **打包前**：核对分支、HEAD、工作区，保留无关改动；完成 `npm run verify`，阶段结束运行 `npm run verify:e2e` 并逐条说明任何失败。更新 `docs/maintenance/CURRENT.md`，区分实现、自动检查和待用户验收。停止其他会改动构建输入的工作。
2. **Windows x64 打包**：运行 `npm run release:pack -- <标签>`，例如 `npm run release:pack -- closeout`。标签仅用小写字母、数字和短横线。产物进入按北京时间计算的 `release/<日期>-<标签>/`；已存在时拒绝覆盖，失败目录也保留，修复后换新标签，不能删除旧证据后冒充首次构建。
3. **核对交付**：目录应包含安装版、免安装版、`build-info.json`、`build-manifest.json`、`build-execution.json`、`build.log` 和“使用与体验更新.md”。补全体验更新模板。清单记录版本、源码提交、未提交的构建输入及路径、时间、Node/npm/Rust/Tauri版本、两个产物的字节数及SHA256；测试、文档和参考资料不计入“产物含未提交内容”。
4. **核对同源性**：命令冻结一次构建清单，经 `STE_BUILD_INFO_FILE` 交给前端，Rust再从dist读取；打包结束核对前端清单与exe内嵌清单，并核对提交／改动路径未变化。本机固定 `CARGO_PROFILE_RELEASE_CODEGEN_UNITS=256`。构建过程中不要编辑源码，现有同路径未提交文本的再次修改不由该路径检查检测。
5. **用户桌面验收**：用户自行双击正式包，对照清单检查“设置 → 关于与引导”中的构建号。按最终报告复查真实配置位置、日志、生成、双窗口、关窗与库内操作。自动测试及Codex的独立identifier环境不替代这一步。免安装版仍使用正式配置，需已有WebView2 Runtime；安装版含运行时引导安装器。
6. **发布需单独授权**：合并到main、推送、升版本、tag及GitHub Release分别取得用户明确指示。本命令不会执行这些动作。

目前有意不做代码签名和自动更新；待准备公开发布、拥有签名主体和稳定下载／更新渠道时再议。原生测试遵循[隔离规则](native-test-isolation.md)，禁止为测试修改正式AppData或运行正式identifier产物。
