# 五阶段严格检查与交付加固

执行：Codex（阶段一，2026-11-21）→ Antigravity（阶段二至五，2026-11-21~22）。用户授权依次实现五阶段，每阶段验证后独立提交；未授权推送、打标签或发布。

基线：main / d4d79b8。保留原有 docs/guides/library-review.md 修改、start.bat 删除及未跟踪的本地文档与 .user。仅读取源码、规则和合成测试；不读取真实库、密钥或历史私密缓存。原生窗口测试必须独立 identifier、构建凭据和合成库。

## 执行顺序与提交记录

1. 未使用代码严格检查与全仓清理：已完成，提交 `4c4c23b`，`npm run verify:web` 全绿。
2. `src/tavern/` 严格 TypeScript 与统一 Discriminated Union 协议：已完成，提交 `90cb71c`，`npm run verify:web` 全绿（328 文件 / 2685 Vitest、宿主转译与酒馆源测试、smoke、构建通过）。
3. 多模型原生 `ProviderAdapter`（OpenAI/Ollama、Anthropic Messages、Google Gemini）与隐私红线静态/回归审计：已完成，提交 `f780cee`，`npm run verify` 全绿（330 文件 / 2703 Vitest、Web 全量 + Rust `cargo test --lib` + `cargo clippy --lib -- -D warnings` 全部通过）。
4. Vault Format 3 / 原生世界玩法 v3 边界单测、核心 Web E2E 与 CI 无头 E2E 接入：已完成，提交 `2e6c352`，本地 Playwright 生产套 7/7 通过，`npm run verify:web` 全绿。
5. Dockerfile 升级 Node 22、标签触发 Draft Release 工作流（`.github/workflows/release.yml`）与 `README.md` 同步重写：已完成，`npm run verify:web` 全绿，独立提交。

## 阶段摘要

### 阶段一（Codex，`4c4c23b`）
- 开启 TypeScript `noUnusedLocals` / `noUnusedParameters` 与 ESLint `@typescript-eslint/no-unused-vars`（`_` 前缀忽略），全仓清理未使用声明并限制 Vitest 并发 worker 为 2。

### 阶段二（Antigravity，`90cb71c`）
- 将 `src/tavern/` 下 16 个 JS/独立 `.d.ts` 文件全量迁为严格 TypeScript，建立统一 Discriminated Union 协议（`src/tavern/protocol.ts`）与运行时结构守卫（`isHelperToHost` / `isHostToHelper`）。
- 更新 `scripts/tavern/host-overlay.mjs` 通过 `ts.transpileModule` 编译桥接模块并重写 `/tauri-main.js` 的 `/ste/*.js` 相对导入；更新 `eslint.config.js`、`scripts/verify.test.mjs` 与 `scripts/tavern/*.test.mjs`。
- 新增 `src/test/tavern-bridge.test.ts` 补齐消息边界、状态轮询与草稿恢复 Vitest 单测。

### 阶段三（Antigravity，`f780cee`）
- 抽象统一 `ProviderAdapter`（`src/lib/llm/providers.ts`），接入 `src/lib/llm/client.ts` 与 `src/lib/roleplay/provider.ts`；保留 OpenAI / Ollama 空 Key 兼容，新增 Anthropic Messages 与 Google Gemini 原生适配器（流式 SSE、结构化输出、超时/重试/截断/空回复/安全拦截分类映射；Gemini 仅经 `x-goog-api-key` 请求头鉴权、绝不拼入 URL）。
- 全仓审计 `reportDiagnostic`、`console.*` 与 `throw new Error`：修复 `chat-jsonl.ts` 日志输出原始行、`preset-playground-stream.ts` 回显远端错误正文，并收敛 `st-import.ts` / `vault-backend.ts` / `bootstrap.ts` / `host-bootstrap.ts` 等异常日志仅输出错误类型名；新增 `src/test/llm-providers.test.ts` 与 `src/test/privacy-redline-audit.test.ts`。

### 阶段四（Antigravity，`2e6c352`）
- 新增 `src/test/vault-format3-hardening.test.ts`（角色可恢复保存中断回滚/提交后清理/篡改拒绝、高版本库拒绝、双窗口写锁提示与同库串行队列、过期临时目录清理重试）与 `src/test/play-world-v3-hardening.test.ts`（双视图记忆、私密知识隔离、Token 预算与输入上限拦截）。
- 新增 `tests/production/core-regression.spec.ts`（主路由导航、世界玩法规则沙盘创建/推进/重载持久化、Anthropic 探测分类错误无密钥泄露），并顺带修复 `src/lib/register-sw.ts` 在受限 SW 环境下空 `registration` 触发 `TypeError` 的边界缺陷；在 `.github/workflows/ci.yml` 接入无头 Chromium `e2e` 任务。

### 阶段五（Antigravity）
- `Dockerfile` 升级至 `node:22-alpine` 并完善 `.dockerignore`；新增 `.github/workflows/release.yml`（`v*` 标签触发，先过 `verify:web`，并行构建 Windows NSIS/免安装与 Android APK，校验并合并 `SHA256SUMS.txt` 后创建 Draft Release）；对照 `CHANGELOG.md`（至 v0.9.9）与 `src/pages/` 同步重写 `README.md`。
- 本机未安装 `docker` CLI，Docker 构建产物通过 `npm run build` 核验 `dist/`（含 `index.html`、`build-info.json`、`tavern.html`、`tauri-main.js`、`ste/*.js`），容器镜像实跑留待有 Docker 环境验证。
