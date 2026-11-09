# Claude 稳定性复核收尾（2026-11-09～11-10）

执行：Claude。用户先请 Claude 审查 Codex 11月7日～9日的工作，之后的指示是“合并，你把剩余事项都做完吧，我后续把你的工作内容转发给codex”。本文给用户和 Codex 看。

分支 `fix/stability-1109`，从 main `73a6f46` 拉出，main 没动，没有推送。统一包在 `release/2026-11-10-stability/`（release 目录被 git 忽略，只在本机）。

## 状态一览

| 事项 | 用户认可 | 实现 | 测试 | 打包 | 发布 |
|---|---|---|---|---|---|
| 正式配置与 Codex 容器配置合并 | 已批准 | 11-09 13:48 完成 | 合并凭据核对 | — | — |
| 提交整理（Codex 11 个 + Claude 4 个） | 已授权 | 完成 | 冻结快照全量通过 | — | 未推送 |
| S5：加载未完成时关窗不退出 | 授权收尾 | 完成 | 单测＋独立 Windows | 已打包 | 未发布 |
| 回收站名称与日期 | 授权收尾 | 完成 | 单测 | 已打包 | 未发布 |
| 配置写入跨进程锁 | 授权收尾 | 完成 | Rust 并发单测 | 已打包 | 未发布 |
| 删除角色慢 | 授权收尾 | 部分（见第 6 节） | 单测＋独立 Windows 计时 | 已打包 | 未发布 |
| 用户实测 | — | — | **未进行** | — | — |

## 1. 配置合并

原来：用户双击 STE 用的是 `%APPDATA%\com.ste.explorer\config.json`，当时只有 2 个连接（新“大锅饭”和一个占位连接）。Codex 是 MSIX 打包应用，它看到、恢复过的“正式配置”其实是 `%LOCALAPPDATA%\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming\com.ste.explorer\config.json`，有 9 个连接。两边共用同一批库文件夹，库里记的连接 ID 在另一边找不到，于是报“所选主模型连接缺失”。

做了什么：STE 没运行时，由非打包进程合并（脚本 `.cache/claude-review-1109/merge-config.mjs`，只输出名称、数量和哈希）：

- 保留容器里 9 个连接的原 ID，旧“大锅饭”（`api_1791131027807_8olc8t`）改名“大锅饭（旧）”。
- 加回真实配置里的新“大锅饭”（`api_1794111762733_94mlsr`），设为当前连接。
- 删掉占位连接 `api_1794045509287_i4otj8`，从容器副本补回 `stRoot`。
- `vaultRegistry`、`vaultRoot` 不动。

结果 10 个连接、9 个有密钥，19568 字节，sha256 `efcf6147…552c9c`。合并前备份 `.cache/claude-review-1109/config-real-before-merge.json`（sha256 `86c7eb87…`，**含密钥，不得上传或贴出**），凭据 `merge-receipt.json`。

之后：用户 11-09 23:52 在自己的 STE 里又新增 1 个连接并设为当前，现共 11 个，库登记没变。这是用户自己的操作。容器副本没改过，仍是 11-08 17:07 的 9 连接版本，不能再拿它核对用户配置。

用户要做的：“我的STExplore”库的主模型指向已删除的占位连接，进聊天会提示连接缺失，用提示里的按钮重选一次。工具模型（“自己”，`api_1791171731423_0osh2s`）合并后已经存在。

规则：AGENTS.md 新增一条，Codex 里不能用正式 identifier 的 STE 打开用户的真实库，也不能把 Codex 里看到的配置当成用户配置。11-08 17:07 Codex 曾在容器里用正式标识打开过真实库，这就是两份配置分叉的方式。

## 2. 提交

Codex 的工作按包和主题拆成 11 个提交。每个包的最后一个提交与该阶段包的冻结源码一致（忽略换行）：`436a4f7` 对 11-08 包 2147 个文件、`4d6d5a1` 对 11-09 包 2158 个文件，本轮重新逐文件核对；11-07 两个包对应 `a006663`、`9fd8fde`，上一轮用包内补丁核对。中间提交是按主题拆开的，没有单独打过包。

| 提交 | 内容 | 来源 |
|---|---|---|
| `a006663` | 聊天启动分阶段提示，加载失败可重试 | 11-07 chat-startup 包 |
| `9fd8fde` | 保存的连接缺失时聊天仍可读 | 11-07 chat-connection 包 |
| `332dc89` | 占位连接不再替换已保存连接 | 11-08 config-review 包 |
| `436a4f7` | 原生测试必须用独立 identifier（含 AGENTS 规则、隔离指南、隐私复核文档） | 11-08 config-review 包 |
| `88ec851` | 库内回收站查看与恢复，原生分块哈希 | 11-09 feedback-startup 包 |
| `272785c` | 聊天里删掉的预设可重新导入 | 同上 |
| `c9ca442` | logprobs、json_schema 按 ST 方式发送 | 同上 |
| `b0cdebe` | 角色详情里编辑总结和日记 | 同上 |
| `2bb75fd` | 采样器缓存被锁时不再卡住启动 | 同上 |
| `4d6d5a1` | 关窗诊断测试脚本 | 同上 |
| `8748a0e` | 稳定性审查、配置恢复和 11-07～11-09 验证文档 | 文档 |

Claude 本轮 4 个代码提交（第 3～6 节）和 1 个文档提交：

| 提交 | 内容 |
|---|---|
| `ebe0a62` | fix(tavern): let the window close while ST is still loading |
| `8c7bd20` | fix(config): serialize config writes across STE processes |
| `37af7aa` | fix(vault): name recycle-bin entries by record and show the real expiry |
| `6d97891` | perf(vault): stop rereading every record file on each character deletion（统一包的源码提交） |
| 本文所在提交 | AGENTS.md 规则与本文 |

有意没提交的：

- `docs/maintenance/CURRENT.md`：Codex 的条目里有私密库名，只在工作区更新。
- `_reference/` 下的删除和 `start.bat` 删除：用户自己的整理，不属于本轮。
- 旧藏整理相关文档和 `docs/guides/library-review.md` 的改动。
- Codex 11-10 正在写的“聊天整理标签筛选”（`ChatHub.tsx`、`roleplay/library-tags.ts`、`library-organizing-tags.ts` 及其测试）：浏览器验收还没做完。

另：`8748a0e` 里的 11-08 Claude 审查交接文档提到 1 个角色卡名。没有推送，用户如果介意，推送前改掉即可。

## 3. S5：加载未完成时关窗不退出

原来：ST 的 `script.js` 在顶层 `await` 等 iframe 的 load 事件。只要有一个资源一直不结束，模块就一直执行不完。关窗时 `__STE_TAVERN_FLUSH__` 要先 `import('./script.js')`，这个 import 会等同一个 load 事件，于是关窗永远等不到结果，窗口关不掉，进程留在后台。

现在：

- `scripts/tavern/host-overlay.mjs` 在 `script.js` 最后一行写 `globalThis.__STE_ST_EVALUATED__ = true`。
- `src/tavern/host-bootstrap.js`：标记没出现前，关窗只排空宿主写入就返回，不再 import。此时 ST 还没注册任何聊天和设置，没有可保存的内容。标记出现后走 Codex 原来的保存路径，不变。

验证：

- 酒馆测试 61 项通过，新增 2 项：未执行完时关窗不等 import（不写聊天、排空一次宿主）；标记确实在顶层等待之后且只出现一次（上游改了这段等待时测试会报出来）。去掉守卫后第一项失败。
- 独立 Windows：identifier `com.ste.explorer.feedback1109`，凭据 `.cache/native-test-artifacts/f8d45eec-f96f-472b-8785-93acd5826aa0/receipt.json`，exe sha256 `03b25c72f9c5d3f2611ef696ba323df3a49f9fc322351a7c9495ac8f88310dba`，合成库，脚本 `scripts/smoke/exit-failed-load-20261109-native.mjs`：

| 路径 | 关闭方式 | 主进程退出 | 残留进程 |
|---|---|---|---|
| 核心数据加载失败后 | 系统关窗 | 1.35 秒 | 0 |
| 核心数据加载失败后 | 标题栏关闭 | 0.33 秒 | 0 |
| 加载卡住（帧 readyState=interactive、标记未写、卡住的服务器收到连接） | 系统关窗 | 1.35 秒 | 0 |
| 加载卡住 | 标题栏关闭 | 0.33 秒 | 0 |

  证据 `.cache/s5-failed-load-1109/0c64173f-6acf-46fd-a6af-e9d2ef7d06db/result.json`。
- 对照：Codex 的基线构建（凭据 `a9b1fce3-…`，exe sha256 `68df782e…`）在“加载卡住＋系统关窗”下 15 秒没退出，留 9 个进程，只能由测试清理本测试进程树。证据 `.cache/s5-failed-load-1109/a15c05a8-f42a-4500-bac8-bbf86e9cf7b0/failure.json`、`cleanup.json`。“加载失败”这一路在基线上没跑，不知道基线是否也能关。

还缺：没有复现用户原始那次 S5，只修了“加载没完成时关不掉”这一类。用户实测前不结案。

## 4. 回收站名称与日期

原来：条目标题是第一个文件路径，可能是附件；日期一律写“30天后转系统回收站”，与删除时间无关。

现在：`listRetainedOperations` 多返回 `title`（档案和故事用所在文件夹名，其他记录用文件名），界面显示“类型 · 名称”。日期由 `recycleExpiryLabel` 生成：“N 天后（日期）移入系统回收站”；已到期显示“已到期，稍后自动移入系统回收站”；长期保留照旧。

验证：回收站测试新增 1 项（标题取记录名而不是附件、第 27 天、已到期、长期保留）。没有做原生界面截图，用户实测时看一眼。

## 5. 配置写入跨进程锁

原来：`config_set` 读整个文件、改一个键、改名覆盖。两个 STE 进程（免安装版和安装版，或没关的旧窗口）各自读到旧文件再写回，后写的会把另一个刚写的键改回旧值或抹掉。

现在：`config_set` 和 `config_repair` 在读改写全程持有配置目录下 `.config.lock` 的排他锁（std `File::lock`），随句柄释放。锁旁边的固定文件而不是 `config.json`，因为后者会被改名替换。`File::lock` 需要 Rust 1.89，`rust-version` 从 1.77.2 改为 1.89（本机 1.97.1）。读取不加锁：写入是改名替换，读不到半个文件。

验证：新单测每个可写键一个线程、各写 40 轮，最后每个键都必须是 39。去掉锁时 3 次都失败；加锁后通过。没有用两个真实 STE 进程做原生测试。

## 6. 删除角色慢

原来：删一个角色时，`deleteCharacter` 先 `stories.list()` 读出所有故事正文找归属；接着文件检查 `inventory()` 把库里每个记录文件再读一遍、收集引用。合成库按用户最大库的数量和体积生成（119 角色、1627 文件、445.6 MB、113 个文件超过 1 MB，全部生成文本），Codex 基线调试版连删 3 个：142.7、150.4、142.3 秒。

现在：

- `deleteCharacter` 改用 `listLight()`（带 characterId、不带正文），命中的故事仍在各自队列里重读后再改。
- `inventory()` 按“大小:修改时间”缓存每个文件贡献的事实（记录身份、归属需要的字段、引用的路径哈希），没变的文件不再读。缓存跟 `VaultFs` 实例走，切库就失效，只保留本次清单里还在的文件。引用只存路径哈希，查询方都只问清单里存在的文件；哈希碰撞只会多算一个引用者，结果是多保留一个文件，不会误删。原来的去重从 O(n²) 改成 Set。

验证：

- 两项新单测：第二次扫描不再读没变的档案、只重读改过的；扫描后新增的引用仍能保护共享立绘不被删。把缓存改成不看戳时两项都失败。
- 本机 Node 计时（同一合成库，临时脚本已删除）：改前 10.9、9.7、9.9、12.8 秒，改后 5.7、0.84、0.63、0.63 秒。
- 独立 Windows 调试版同一合成库连删 3 个：133.1、25.5、20.2 秒。证据 `.cache/large-vault-1109/f2707459-d016-4350-9ad9-2a371499f992/result.json`；基线 `ff4fb339-fa94-48cb-9323-09a9f33dadf5/result.json`。合成库本体已删除，可用 `scripts/smoke/large-vault-fixture-20261109.mjs` 重新生成（该脚本只允许写 `.cache/large-vault-1109/` 下的目录）。

还缺：

- 打开库后的第一次删除仍要冷读全部记录文件（调试版 130 秒级）。打开库本身也会全读一遍（调试版约 70～80 秒）。
- 每次删除仍有约 1570 次列目录、1160 次 stat 的 IPC 往返。
- 正式版（release）下的耗时没测。下一步可以考虑在 Rust 里一次完成整库列目录和读取。

## 7. 门禁与统一包

全部在打包用的冻结快照上运行（`git checkout-index` 检出 `6d97891` 到空目录，不读工作区）：

- `tsc -p tsconfig.app.json --noEmit`：0 错误。
- `vitest run`：310 个文件，2518 项通过，1 项跳过（`roleplay-tavern-helper-package` 在没有 `.cache/helper.zip` 时跳过，原本就有）。
- `node --test scripts/tavern/*.test.mjs`：61 项通过。
- `native-test-safety` 与 `sync-version` 测试：8 项通过。
- `cargo test --lib`：48 项通过，1 项原本就忽略。
- 改动文件的 ESLint：0 错误（`scripts/` 下的文件不在 ESLint 范围内，另用 `node --check` 检查过语法）。

统一包 `release/2026-11-10-stability/`：

- `STE-0.9.9-2026-11-10-stability-portable.exe`：37458944 字节，sha256 `f490e67c8bc27c43938249cfd136a82d2c59b5f3e5748b32834bec0fdb0a5bb6`。
- `ST-Explorer-0.9.9-2026-11-10-stability-setup.exe`：27141740 字节，sha256 `a5b02e42665db42518fd309fda3c0b69d71e1dddfc6e50feaa705eeea536bc1e`。
- 清单 `build-manifest.json`：源码提交 `6d97891`，不含未提交修改；2442 个源码文件、1190 个前端文件。构建配方 `build-recipe.mjs`（prepare／gates／build／smoke／finalize）。
- 构建中 `tauri build` 改写了快照里的 `src-tauri/Cargo.toml`，去掉 CR 后与提交内容逐字节相同，已在清单 `lineEndingOnlyChangesDuringBuild` 记录；其他源码文件构建前后不变，前端在原生编译期间不变。
- 生产前端浏览器冒烟 5 组通过（正常加载与重载、模块失败后重试、连接缺失仍可读、390px 抽屉与重选、重选在重载后保留）。
- 原生实测用的是 11-09 22:54 从工作区构建的独立调试版。它的 `dist/` 与统一包快照的 `dist/` 1190 个文件中 1184 个逐字节相同，其余 4 个只差换行，2 个第三方库包只差模块编号（按路径生成）。Rust 源码在那之后没改过。统一包的 exe 和安装器没有运行过，也没有碰正式配置。

## 8. 仍未解决

- 用户遇到的总结被拒：没有复现，也没有解决。Codex 11-09 只修了与原版 ST 的请求参数差异。
- S4 聊天启动偶发卡住的原始原因没有证明；S5 原始现场也没有确认。
- Android 没测；安装器的安装和卸载没测。
- 删除：见第 6 节“还缺”。
- Codex 容器里有 28 个测试 identifier 的 Roaming 目录和 23 个 Local 目录（`com.ste.explorer.chat1107`、`test-result1105formal-*` 等），以及一份正式 identifier 的副本。这些是 Codex 的测试残留，Claude 没动，是否清理由用户决定。Claude 自己在真实 AppData 里留下的 `com.ste.explorer.feedback1109` 测试目录已删除。

## 9. 给 Codex

- 在 Codex 里看到的 `%APPDATA%`、`%LOCALAPPDATA%` 是容器副本。核对或修改用户配置，只能由用户自己的 STE 或非打包环境的工具来做。
- 不要在 Codex 里用正式 identifier 启动 STE 打开用户的真实库。
- 原生测试照旧用 `scripts/smoke/build-isolated-native.mjs` 构建独立身份并核对凭据；本轮两个新脚本也是这样做的。
- 继续开发前先看工作区：本轮提交之后，Codex 的标签筛选改动仍未提交，与本轮提交没有重叠文件。
