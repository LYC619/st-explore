# 工具链与版本一致性修复 Implementation Plan

**执行更新（2026-09-08）：** T1/T2 已完成：干净 npm ci、版本检查、两个 TS 工程、lint、测试和构建通过；验证结束时未暂存或提交，此后用户授权本地维护提交。
完整证据：[维护修复验证记录](../../reviews/2026-09-05-maintenance-fix-verification.md)。以下设计片段保留为原方案，最终实现以源码和验证报告为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 关闭 F04/F05：app/node 两个 TypeScript 工程使用相容的工具链，正式版本、UI 与 Service Worker 版本不再漂移。

**Architecture:** 先核对实际 lockfile 和包元数据，再选择精确的 Vite/Vitest/SWC 组合；不凭记忆指定“最新”。package.json 是版本的唯一输入，独立脚本显式写入派生版本、CI 只检查不写入。工具链最小门禁与已知版本失败分阶段处理。

**Tech Stack:** npm、TypeScript、Vite/Vitest、Node ESM、Rust/Cargo、GitHub Actions。

---

## Task T1：兼容矩阵与 node 工程门禁（F04）

**Files:**
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/package.json`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/package-lock.json`
- Inspect / 仅必要时局部修改: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/vite.config.ts`
- Inspect / 仅必要时局部修改: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/vitest.config.ts`
- Inspect: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/tsconfig.node.json`
- Create（执行时记录选型证据）: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/docs/reviews/2026-09-05-toolchain-selection.json`

- [x] **T1.1 — 重现 RED，保存真实解析树。**

~~~powershell
npm ls vite vitest @vitejs/plugin-react-swc rollup rolldown --depth=2
npx tsc -p tsconfig.node.json --noEmit
~~~

Expected：审查基线是 root Vite 8.2.2 / SWC 4.3.3 / Vitest 3.2.6 内嵌 Vite 7.3.6 的 TS2769。若 S0 之后已变化，先记录新状态，不能强行制造旧失败。

- [x] **T1.2 — 查询精确候选的版本、依赖和 Node 要求。**

~~~powershell
node --version
npm view vite@8 version engines peerDependencies --json
npm view vitest@4 version engines dependencies.vite peerDependencies --json
npm view @vitejs/plugin-react-swc@4 version engines peerDependencies --json
npm view vite@7 version engines peerDependencies --json
npm view vitest@3 version engines dependencies.vite peerDependencies --json
~~~

选型规则：优先保留当前 Vite 大版本，Vitest 的 Vite 依赖范围、SWC 的 peer 范围与当前 Node 版本必须共同满足；若不存在这样的组合，优先退回声明支持的 Vite 7 组合，而不是加 any、skipLibCheck 或强制 overrides。对最终候选再以 `npm view 包名@精确版本 ...` 确认一次，记录每个精确版本、查询日期、支持范围和选择理由。

本规划阶段**尚未远程验证最终版本**；精确版本是 T1.2 的产物，不能替换成浮动 latest 标签。查询因权限/网络失败时按工具权限申请重试；仍不可用就保留 lockfile、不宣称完成 T1，其他无需换依赖的回归任务可以继续。

- [x] **T1.3 — 用已记录的版本安装并检查最小 GREEN。**

selection JSON 顶层必须有 `vite`、`vitest`、`swc` 三个完整 semver 字符串及 `checkedAt`、`rationale`；不接受范围或标签。执行命令读取该文件，避免另抄一组版本：

~~~powershell
$selection = Get-Content -Raw -Encoding UTF8 -LiteralPath 'docs/reviews/2026-09-05-toolchain-selection.json' | ConvertFrom-Json
foreach ($version in @($selection.vite, $selection.vitest, $selection.swc)) {
  if ($version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { throw '选型记录不是精确版本' }
}
npm install --save-dev --save-exact "vite@$($selection.vite)" "vitest@$($selection.vitest)" "@vitejs/plugin-react-swc@$($selection.swc)"
npx tsc -p tsconfig.node.json --noEmit
npx tsc -p tsconfig.app.json --noEmit
npm run build
~~~

Expected：两个 TS 工程与 build 退出 0；不升级 React、Capacitor、Tauri、fflate 或业务包，不手工编辑 lockfile 的嵌套依赖。本阶段全量测试允许且只允许 S0 中确认的 F05 两个版本失败；修完 T2 后才要求全绿。配置运行时保留 `plugins: [react()]`，依赖对齐即解决时不改配置源码。

## Task T2：单一版本输入、显式同步与 CI 检查（F05）

**Files:**
- Create: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/scripts/sync-version.mjs`
- Create: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/scripts/sync-version.test.mjs`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/package.json`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/package-lock.json`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/GlobalSettings.tsx`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/public/sw.js`
- Modify / verify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src-tauri/tauri.conf.json`
- Modify / verify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src-tauri/Cargo.toml`
- Modify / verify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src-tauri/Cargo.lock`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/version-sync.test.ts`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/.github/workflows/ci.yml`

- [x] **T2.1 — RED：扩展一致性与脚本 fixture 测试。**

保留现有源文件扫描测试，不能用 mock 常量绕过 UI/SW 漂移。增加 Cargo.lock 中 **name = ste-explorer 的 package block** 版本断言；不能匹配任意第一个 version。六处为 package / Tauri / Cargo.toml / Cargo.lock 本包 / APP_VERSION / CACHE_VERSION，另检查 npm lock 顶层与 `packages['']` 两个镜像版本。

~~~ts
const lock = read('src-tauri/Cargo.lock');
const packageBlocks = [...lock.matchAll(/^\[\[package\]\]\r?\n[\s\S]*?(?=^\[|(?![\s\S]))/gm)]
  .map(match => match[0]);
const selfPackages = packageBlocks.filter(block => /^name\s*=\s*"ste-explorer"\s*$/m.test(block));
expect(selfPackages).toHaveLength(1);
expect(selfPackages[0].match(/^version\s*=\s*"([^"]+)"/m)?.[1]).toBe(pkgVersion);
~~~

fixture 使用 `mkdtemp` 创建合成项目，不写真实源码；每个 fixture 提供 package、npm lock、Tauri、Cargo、UI、SW。断言：check 对漂移退出非零且所有文件 hash 不变；write 后检查通过；第二次 write 返回空变更；marker 缺失/重复或 Cargo 同名包重复时，**全部文件保持原样**；第三方 Cargo version 不变。另覆盖 LF/CRLF、self package 位于首/中/尾、顶层 lock version、尾部 [metadata]、self 缺失/重复、self version 缺失/重复；所有非 self 字节必须完全相同。

~~~powershell
npm test -- src/test/version-sync.test.ts --reporter=dot
node --test scripts/sync-version.test.mjs
~~~

Expected：现有 F05 RED + 脚本尚未实现的 RED，失败原因明确。

- [x] **T2.2 — 实现预检全部目标后再写入的同步核心。**

脚本导出 `syncVersion(root, mode)`，供 fixture 直接调用；CLI 只接受 `--check`、`--write`，默认 check，未知参数退出 2。以下函数完整定义唯一匹配操作与 TOML 区块替换，实际文件读取和替换都使用它们，不做全文件 version 替换：

~~~js
export function replaceExactlyOnce(text, expression, replacement, label) {
  const flags = expression.flags.includes('g') ? expression.flags : expression.flags + 'g';
  const matches = [...text.matchAll(new RegExp(expression.source, flags))];
  if (matches.length !== 1) throw new Error(`${label}: expected one marker, got ${matches.length}`);
  return text.replace(expression, replacement);
}

export function replaceCargoPackageVersion(text, version) {
  return replaceExactlyOnce(text,
    /^\[package\]\r?\n[\s\S]*?(?=^\[|(?![\s\S]))/m,
    block => replaceExactlyOnce(block, /^(version\s*=\s*)"[^"]+"/m,
      `$1"${version}"`, 'Cargo package version'), 'Cargo package section');
}

export function cargoLockPackageBlocks(text) {
  const headers = [...text.matchAll(/^\[[^\r\n]+\][ \t]*(?:\r?\n|$)/gm)];
  return headers.flatMap((header, index) => {
    if (header[0].trim() !== '[[package]]') return [];
    const start = header.index;
    const end = headers[index + 1]?.index ?? text.length;
    return [{ start, end, text: text.slice(start, end) }];
  });
}

export function replaceCargoLockVersion(text, version) {
  const matches = cargoLockPackageBlocks(text).filter(block =>
    /^name[ \t]*=[ \t]*"ste-explorer"[ \t]*\r?$/m.test(block.text));
  if (matches.length !== 1) throw new Error('Cargo.lock: expected one ste-explorer package');
  const block = matches[0];
  const replaced = replaceExactlyOnce(block.text, /^(version[ \t]*=[ \t]*)"[^"]+"/m,
    `$1"${version}"`, 'Cargo.lock self version');
  return text.slice(0, block.start) + replaced + text.slice(block.end);
}
~~~

`syncVersion` 固定操作顺序：

1. 从 root/package.json 读 version，按现有测试要求校验 `^\d+\.\d+\.\d+$`，本次不升版，输入仍是 0.9.1。
2. 一次性读取全部目标进内存；Tauri 和 npm lock 先 `JSON.parse`，校验旧 version 字段存在、类型 string；npm lock 只改顶层 version 与 `packages[''].version`。
3. Cargo 两文件调用上述函数；UI 用 `/\bAPP_VERSION\s*=\s*'[^']+'/` 唯一替换为 `APP_VERSION = 'v${version}'`；SW 同理 `CACHE_VERSION`。保留文件其余文本和换行，不格式化大 TSX。
4. 生成 `Map<absolutePath, newText>` 并比较差异。所有变换成功后才进入 write；任一匹配/解析失败不得写任何目标。
5. check 返回变更路径并设置非零退出码，绝不写入；write 只写不同目标，返回变更路径。日志不得把 package 以外的环境配置内容输出。

脚本本身不修改 package.json 的源 version，不挂到普通 build 的自动写入前置步骤。若写盘中断，下一次 check 仍能检测漂移，不能声称跨文件原子发布。

- [x] **T2.3 — 显式同步当前版本并接入脚本。**

package scripts 新增：

~~~json
{
  "version:check": "node scripts/sync-version.mjs --check",
  "version:sync": "node scripts/sync-version.mjs --write",
  "test:version-script": "node --test scripts/sync-version.test.mjs"
}
~~~

~~~powershell
node scripts/sync-version.mjs --write
node scripts/sync-version.mjs --check
node --test scripts/sync-version.test.mjs
npm test -- src/test/version-sync.test.ts --reporter=dot
~~~

Expected：当前 UI/SW 更新为 v0.9.1；六处及 npm lock 镜像一致，重复 write 不产生新 diff。CI 在 install 后执行 `npm run version:check`、脚本 fixture 测试及 app/node typecheck；CI 不执行 version:sync。

- [x] **T2.4 — 合并工具链全绿门禁。**

~~~powershell
npm ci
npm run version:check
npm run test:version-script
npx tsc -p tsconfig.node.json --noEmit
npx tsc -p tsconfig.app.json --noEmit
npm run lint -- --quiet
npm test -- --reporter=dot
npm run build
~~~

Expected：全部退出 0；若 `npm ci` 必须联网，先获准依赖下载再执行；无法下载不伪报通过。对照 S0 snapshot 检查本任务未改变 ST WIP，不要求 HEAD diff 为空。

- [x] **T2.5 — 检查暂存与提交边界。**

只在执行获准后按本文件 Files 清单逐个暂存；先看 `git diff --cached --check` 与 `git diff --cached --stat`，确认没有用户 WIP、构建产物或真实数据。建议 T1/T2 两个独立提交：`fix: align vite and vitest toolchain`、`fix: synchronize release version sources`。不创建 release/tag、不自动发布。
