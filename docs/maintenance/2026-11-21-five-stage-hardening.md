# 五阶段严格检查与交付加固

执行：Codex，2026-11-21。用户授权依次实现五阶段，每阶段验证后独立提交；未授权推送、打标签或发布。

基线：main / d4d79b8。保留原有 docs/guides/library-review.md 修改、start.bat 删除及未跟踪的本地文档与 .user。仅读取源码、规则和合成测试；不读取真实库、密钥或历史私密缓存。原生窗口测试必须独立 identifier、构建凭据和合成库。

## 执行顺序

1. 未使用代码严格检查与全仓清理：已实现，npm run verify:web 全绿，独立提交随后记录。
2. src/tavern 严格 TypeScript 与统一消息协议：待执行；实际输入为 13 个 JS、3 个独立声明文件；验收 npm run verify:web。
3. 多模型原生 ProviderAdapter、隐私输出审计：待执行；验收 verify:web、cargo test --lib、cargo clippy --lib -- -D warnings。
4. Vault Format 3 / 世界玩法 v3 边界与 Web E2E：待执行；验收 verify:web 与新增 Playwright 用例。
5. Node 22 Docker、标签触发 Draft Release、README：待执行；验收 verify:web 与可用构建检查。

## 环境与验证记录

- 普通执行通道启动失败（Windows 1920）；本机执行通道已成功读取规则与仓库状态。rtk 当前不可用，使用原命令。
- 源码实现、自动检查、打包、发布、人工验收分别记录，不以旧报告代替本次证据。

## 阶段一

- 开启 TypeScript noUnusedLocals/noUnusedParameters 与 ESLint 未使用声明检查；保留下划线参数豁免。
- 清理无用导入、常量、类型与解构，保留公共属性声明、测试初始化与原有调用副作用。
- 首次完整验证发现旧 frontend-contract 测试依赖 Home 中无用导入字符串；改由首页真实 CharacterTile 渲染测试验证展示名、查看时间与更新时间回退。相关53项专项检查通过。
- 新增测试曾误用 displayName 字段，已改用项目实际 displayMeta.name。
- 无界并发导致4个jsdom文件5秒超时及后续缺控件；原断言和超时不变，限制2个worker后专项50项及完整2677项通过。
- 最终 npm run verify:web 全绿；证据 `.cache/verify/2026-11-21T13-55-31-219Z/results.json`（2677 Vitest，酒馆脚本、smoke、版本脚本、lint、双类型检查、build通过）。未运行原生窗口或真实库。
