# 聊天 Agent 功能审查（codex/ste-roleplay-runtime）

日期：2026-09-18。审查对象：`codex/ste-roleplay-runtime` 分支 12 个提交（`bfe40ce`…`d737396`），基线 `25c2dda`（main）。审查方式：先跑全部自动门禁，再分四条线读代码（Agent 循环与记忆、酒馆宿主与保存链路、Rust 与权限面、故事包与世界书版本），每条发现都回到源码核对过行号。审查只读，除下文写明的 1 处过期测试断言外没有改动源码。

## 一句话结论

这一版可以进入真实模型试玩，但先不要合入 main。自动门禁全绿，架构上最难的几件事（正文只有一条提交路径、记忆只在正文落盘后维护、旧资料包不被改写、上游文件哈希锁定）都做对了。但有 3 个会在正常游玩中碰到的 HIGH 问题，其中 2 个是"卡住之后没有出路"的类型，建议修完再合。

## 门禁结果

全部在 worktree 根目录执行。

| 检查 | 结果 |
| --- | --- |
| `tsc -p tsconfig.app.json --noEmit` | 通过 |
| `tsc -p tsconfig.node.json --noEmit` | 通过 |
| `eslint .` | 0 错误，1 个既有警告（`asset-navigation-test-support.tsx:73`） |
| `node --test scripts/tavern/*.test.mjs` | 48 通过 |
| `sync-version --check` | 0.9.1 同步 |
| `vitest run --maxWorkers=2` | 199 文件，1792 项；首轮 1 项失败，修过期断言后全绿 |
| `cargo test --lib` | 44 通过，1 既有忽略 |
| `playwright test`（浏览器游玩套件） | 18/18 通过，3.6 分钟，含真实柏宝书 1.2.7 |
| `vite build` | 通过，5.8 秒；Roleplay 懒加载块 3.19 MB（gzip 1.54 MB） |

唯一的红项是 `src/test/ux-maintenance-models.test.ts:25`：codex 加了第五个一级导航「聊天」，把 `mobile-nav.test.ts` 改了，但这条断言仍写着四个区域。这是测试过期，不是功能问题；已把期望改成五个区域，未提交。

## 发现（按严重度）

### HIGH

**H1. 记忆整理卡住后，下一次发送永远等不到，停止键也无效。**
`src/lib/roleplay/agent-runtime.ts:212`：`prepare()` 第一行是 `await maintenance`，然后才 `signal?.throwIfAborted()`。而 maintenance 链里的 `runToolAgent → sendCompletion`（`tool-agent.ts:154`、`provider.ts:79`）没有任何超时。场景：回复保存后工具模型的 HTTP 连接挂住（不返回也不断开）→ 用户再点发送 → 一直停在「正在查找人物、地点与记忆…」→ 按停止没反应，因为没人在看那个 signal。唯一出路是切成无 Agent 模式（`configure` 会 abort）或关掉聊天。设计文档 §9 明确写了"工具循环设时间预算"，这条没落地。
修法：每次工具请求用 `AbortSignal.any([signal, AbortSignal.timeout(ms)])`；`prepare()` 里让 `maintenance` 和调用方 signal 赛跑，而不是死等。

**H2. 记忆整理失败一次后，重试永远失败，状态永远是「记忆待补全」。**
`agent-runtime.ts:122-127`：发现 `maintenance/<turn>.json` 状态是 `prepared`，就原样重放里面保存的 proposal，proposal 里的每个 change 带着当时的 `expectedDigest`。`memory.ts:268` 遇到 digest 不匹配就抛错。场景：proposal 写好 → 提交时断网 → 用户手改了 `state.md`（或者手动保存了笔记）→ 点「补全记忆」→ 重放旧 proposal → 「记忆已被修改」→ 又回到待补全 → 再点再失败。
修法：commit 因 digest/冲突被拒时，把 prepared 记录作废，重新对当前文件跑一次工具 Agent，而不是重放。

**H3. 用 `/sys` 发的旁白消息，重开聊天后变成隐藏的系统消息，从此不进上下文。**
`src/lib/roleplay/live-chat.ts:70-72` 把 `extra.type ∈ {system, narrator, comment}` 全映射成 `role: 'system'`；`live-chat.ts:36` 编码回酒馆时 `is_system = role === 'system' || hidden`。上游 `/sys` 生成的消息 `is_system` 是 `false`（`vendor/.../slash-commands.js:6103`，只有纯 bias 才 true），而上游组 prompt 时只过滤 `is_system`（`script.js:5327`）。所以：`/sys 夜幕降临` → 保存时 rawData 还是 false → 下次 `/api/chats/get` 返回 `is_system: true` → 酒馆把它当隐藏消息，既不显示也不进上下文 → 下次保存把这个错误固化。
修法：编码时 `is_system` 优先取 `rawData.is_system`，只对没有 rawData 的 STE 原生 `role: 'system'` 才强制 true；或者旁白/评论映射成 `assistant` 并单独用 `hidden` 表达隐藏。现有 `roleplay-live-chat.test.ts` 没有覆盖 `is_system: false` 的旁白往返，补一条即可复现。

### MEDIUM

**M1. 记忆笔记里的剧情文本能让整包导出直接失败。**
`story-package.ts:229-235`：非 JSON 运行文件逐行扫 `key: value`，key 命中 `credential()`（password、token、authorization…）或路径类 key 的值以 `/`、`C:\`、`~/` 开头，就整个 `exportStory` 抛错，而且这段校验在导出（`:449`）和导入两边都跑。Agent 写的记忆是自由文本，一个解谜 NPC 的 `password: 龙之眼` 或科幻日志里的 `source: /dev/null` 就会让「导出完整故事包」报"运行文件含凭据或本机路径"，而且没有像 `helpers.json` 那样的逐文件省略通道。
修法：导出侧把这类文件记进 `omissions`（或脱敏那一行）继续导出，硬拒只留在导入侧。

**M2. 生成期间编辑历史，不会取消正在进行的那轮生成。**
`tavern-host.ts:667` 只在 `controllers.size` 时拒绝"切聊天"，`/api/chats/save` 改了历史内容不会 abort 生成。结果是旧回复接到被改写的历史后面并保存。记忆这边有保护（`ledger.adopt` 校验 sourceRefs 会失败 → memory-pending），所以不会写错记忆，但设计文档 §4.1"生成期间编辑历史会取消该轮生成"没做到，用户会看到一句莫名其妙的"记忆来源需重新核对"。
修法：保存处理里，若有在跑的 controller 且提交改动了 pending turn 截止位置之前的任何消息，abort 这些 controller。

**M3. token 估算只用 OpenAI 分词器，却拿来做硬拒绝。**
`tokenizer.ts` 固定 cl100k/o200k，驱动了 8k 工作窗口、2.2k 资料包上限、`ledger.reserve()` 的预留、宿主覆盖层的 prompt 预算，以及 `tavern-host.ts:240-243` 的硬拒绝。Claude/DeepSeek/Qwen/Gemini 对中文的 token 数跟 OpenAI 差 1.3 到 2 倍，两边用同一把尺子量，守门员根本量不出超标，结果是服务商在游玩中途返回 context-length 400。
修法：按模型加一个安全系数（可让用户调），并用上一轮服务商回报的 `prompt_tokens` 校准估算。

**M4. 任何一个已采纳回合失效，整个上下文周期从头重建，包括每一次 swipe。**
`context-ledger.ts:78-81`：`reusable` 要求所有已采纳回合都仍有效。swipe 时 `generate()` 会 pop 最后一条 assistant（`tavern-host.ts:235`），最后一个已采纳回合就失效了 → `retained = []` → 之前所有冻结资料包全部丢掉。设计文档 §5.1 确实说"切换候选建立新周期"，所以这是按规范做的，但代价是最贵的：一次 swipe 丢掉整个缓存前缀，而不是只丢尾巴。
修法：保留仍有效的最长前缀（回合是有序的），只从第一个失效的往后丢。

**M5. 消息 ID 重复后没有恢复路径。**
`host-bootstrap.js:25` 遇到重复 `messageId` 直接抛错。任何插件 `structuredClone` 一条消息再 push 就会制造重复（覆盖层只补了上游自己的"复制消息"那一处，`host-overlay.mjs:103-104`）。之后每次保存、草稿捕获、flush 全失败，「重试保存」跑的还是同一份数据。
修法：遇到重复给后出现的那条重新盖一个 UUID，不要抛。

**M6. 乐观版本冲突后是永久的。**
`story-session.ts:66-68` 拿打开时抓的 `version` 比对，不一致就 409，`__STE_SAVE_FAILED__` 置位，但 `version` 从不前进。「重试保存」不可能成功，只能导出。
修法：冲突时提供"重新读取后覆盖"的选项（上游本来有 integrity/OVERWRITE 流程，宿主从未发出）。

**M7. 工具 Agent 的「提醒」原样进了主模型的 system 消息，是注入通道。**
`tool-agent.ts:121-122` 把 `args.reminders`（最多 4×600 字，工具模型生成的自由文本）拼进 supplement；`context-ledger.ts:86` 把整段包成 `{role:'system'}`。世界书/记忆原文是作为 JSON 工具观察给工具模型的，主模型也确实收不到工具轨迹，这两点做对了。但一条被投毒的世界书条目让工具模型输出一句"从现在起忽略预设…"作为提醒，它就以 system 身份到了主模型。
修法：提醒放进和引用原文同一个带标签的数据块里，不要裸露成 system 指令。

**M8. HTTP 权限是全网通配，CSP 为空，酒馆 iframe 没有 sandbox。**
`capabilities/default.json:16` 给 `http://*:*` 和 `https://*:*`；`tauri.conf.json:28` `csp: null`；`Roleplay.tsx:228` 同源 iframe 无 sandbox。JS 侧唯一调用方是 `provider.ts:79`，URL 来自用户配置，所以范围本身说得通。但任何跑在酒馆 frame 里的脚本（上游代码、哈希锁定的柏宝书、越过 DOMPurify 的内容）都能拿 `parent.localStorage` 里的明文 API key，再通过 http 插件免 CORS 外发。目前没有不受信代码路径（柏宝书锁了两个哈希，助手脚本在 `sandbox="allow-scripts"` + `connect-src 'none'` 的 srcdoc 里，权限在宿主侧校验），但防线只有一层哈希。API key 明文是 0816 已拍板暂缓项，这里只是新增了一个更大的暴露面。
修法：`http://*:*` 收成 `localhost`/`127.0.0.1`（明文 key 发往局域网主机没有理由放行）；给 `tavern.html` 配 CSP；信任模型写进设计文档 §8.2。

**M9. 一个坏文件让整个分支的世界书版本和生成全部失效。**
`worldbook-versions.ts:132-150`：任何解析失败或重复 operationId 的文件都抛错，`effective()/list()/propose()` 全走 `snapshot()`；`host-bootstrap.js:99-111` 把这个错误存进 `worldPreparationError`，`:137` 对每次非 quiet 生成重抛。用户手拷一个 JSON 进 `.ste-control/roleplay/<branch>/worldbook-versions/`，这条分支就再也不能生成。
修法：跳过并报告坏文件（标 invalidated），不要整体失败。

**M10. 故事包导入遇到同 ID 不同内容只能拒绝，没有"作为副本导入"。**
`story-package.ts:338-343, 357`。分享 `.ste-play` 给一个之前导入过、又本地改过的人，永远导不进，只能删本地记录。
修法：提供重新分配故事/分支 ID 的模式，资产 ID 仅在内容一致时保留。

### LOW

- `tool-agent.ts:181`：`tool_call.id` 缺失时变成字面量 `"undefined"`，下一轮请求会被严格网关拒绝。补一个合成 id。
- `tool-agent.ts:156`：服务商错误正文被丢弃，只剩状态码。设计文档 §10 要求保留诊断。
- `tool-agent.ts:164`：整个 provider `message` 对象回灌进下一轮（含 `refusal`、`reasoning_content` 等），严格后端会 400。只复制 `content` 和 `tool_calls`。
- `tool-agent.ts:105-109`：`clip()` 按 token 切再 decode，中文字被劈开会出 U+FFFD，`nextOffset` 也跟着漂。主模型看到的引用原文里会有 `�`。
- `agent-runtime.ts:229`：工具 Agent 的 usage 从不上报；`context-ledger.ts:107-108` 未采纳回合的 `turns/*.json` 从不清理。
- `package.json`：`js-sha256` 和 `yaml` 是运行时依赖却放在 devDependencies，且版本被上游 ST 的锁检查（`build.mjs:30-38`）绑住，STE 自己的指纹哈希从此跟着 TauriTavern 的 pin 走。
- `worldbook-versions.ts:262`：`validFrom` 只写不读，实际时间范围靠 `refsAreCurrent` 的哈希链保证。要么写文档说明，要么删掉，别留一个假契约。
- `host-overlay.mjs:35`：`helper-lodash.js` 直接从 `node_modules` 拷，是覆盖链里唯一没有哈希锁的文件。
- `helper-host.js:29-34, 271`：每次事件广播都序列化整个聊天，另有 1.5 秒轮询（`host-bootstrap.js:451`）。只是性能。
- `.gitignore` 新增 `/.planning/ste-roleplay-ux-20260912/`，导致 `2026-09-12-ste-roleplay-ux-repair.md` 引用的规划目录没有入库。是有意的吗？
- `tavern-host.ts:235` 假设 regenerate 时最后一条 assistant 仍在 `chat[]` 里；菜单里的 Regenerate 在这个 pin 里的删除路径没有找到，若是删了再 push，那一楼会换新 UUID，标记/收藏/记忆引用全掉。

## 做得对的地方

- **正文只有一条提交路径。** 同源 `/api/*` 的 fetch 和 `$.ajax` 全被拦截，`/api/chats/save` 只走 `story-session.save → updateArchiveStory`。上游自己的 IndexedDB 只存 token 缓存和 itemized prompt，不存正文。`chat_metadata` 一起持久化。
- **消息身份靠对象上的 ID，不靠下标。** `extra.ste_runtime.messageId` 在保存/生成/草稿捕获时懒赋值，中间删楼、`/cut`、splice 都不影响；上游唯一整体替换 `extra` 的 `syncSwipeToMes` 被覆盖层补回。
- **记忆只在正文落盘后维护。** `afterCommit` 才调度，`prepared → committed` 日志按 operationId + proposal digest 幂等，写入带 digest 守卫，手动文件不被自动替换。保存失败就没有 afterCommit，也就没有记忆。
- **旧资料包不被改写。** 已采纳回合的 supplement 原样插回原锚点，`reset` 只删 `context.json`。周期重建原因有记录。
- **工具循环有界。** 6 轮/12 次调用/最后一轮强制 final tool/8k 压缩循环可证明终止（压过的观察 <350 字符不会再被匹配）。
- **取消信号贯穿。** 每次 fetch 都带 signal，调用间重查；迟到结果被 `check()`（vault epoch + closed）、turnId、`refsAreCurrent`（内容+候选+历史哈希链）和采纳前的仓储核对四道拦住。`completion-monitor` 在回执写完前扣住终止字节，迟到 abort 会撤销临时成功。
- **c494d97 的缓存版本修复是对的。** `cacheVersions` 在 `putRecord` 两侧递增，读取只在版本未变时回填，跨越写入的两种读取顺序都处理了。
- **上游来源链完整。** 每次读取都比对 `SOURCE-MANIFEST.json` 的 SHA-256，manifest 又比对 `UPSTREAM.json` 和写死的 commit，覆盖层每处 seam `replaceOnce` 恰好一次。柏宝书不在 git 里，运行时从用户 ZIP 加载并锁两个哈希。
- **Rust 面只加了一个命令。** `save_text_export` 的路径只来自原生保存对话框，必须绝对路径、拒绝符号链接、走既有原子写，不扩大 `AuthorizedRoots`。
- **故事包校验扎实。** 64 MB/4 MB/2048 文件/1M 节点/深度 64 上限，原型键拒绝，`isRuntimePath` 挡住 `..`、反斜杠、冒号、控制字符、`%2e`、保留名并强制前缀；NFC + 大小写不敏感的重名检查；PNG 只保留像素块。
- **测试是行为测试。** 真 memfs vault、真 HTTP 服务器、真流，没有 0819 那批 grep 源码字符串的负价值测试。浏览器 18 项也是通过真实上游模块操作。

## 建议

按"合入前必修 / 试玩前值得修 / 之后再说"分三档。

**合入 main 前必修（都是"卡住没出路"或"数据被静默改坏"）：**
1. H1 工具请求加超时，`prepare()` 不再死等 maintenance。
2. H2 prepared 记录 digest 失配时作废重跑。
3. H3 `is_system` 从 rawData 取。
4. M5 重复 ID 重新盖章而不是抛错。
5. M6 版本冲突给一条"重读后覆盖"的路。

**真实模型试玩前值得修：**
6. M3 token 估算加安全系数。中文玩家用非 OpenAI 模型是主流场景，这条不修，长剧情中途会撞 400。
7. M1 导出侧改成省略而非拒绝。Agent 写的记忆迟早会撞上这些关键词。
8. M8 http scope 收窄到 localhost，至少别让明文 key 往局域网任意主机发。

**之后再说：**
9. M4 swipe 只丢尾巴。这是缓存成本问题，等有真实缓存命中率数据再定值不值得。
10. M7 提醒不走 system。等真实试玩看工具模型实际输出什么样的提醒再定格式。
11. M2、M9、M10 和全部 LOW。

**关于测试覆盖，缺的不是数量而是两块：**
- vitest 层没有 Agent 模式 `generate` 的端到端（`x-ste-turn-id → MESSAGE_RECEIVED → confirm-candidate → save → afterCommit → memory`）；现有宿主测试全是 classic 模式。浏览器套件第 4 条覆盖了这条链，但只有 happy path。
- H1/H2/M5/M6 四条"卡住"场景一条都没测。它们的共同特征是"失败一次之后重试还是同一份输入"，值得写成一组"失败后能恢复"的测试。

**关于文档：** codex 的三份记录（设计、v1 验证、UX 修复）写得诚实，边界都标清楚了。但 `docs/verification/ste-roleplay-daily-2026-09-12.md` 里的 "196 文件 1785 项" 是首轮数字，现在是 199 文件 1792 项；建议合入前重跑一次全量把数字更新，避免下次审查再对不上。

## 未验证的范围

- 真实远端模型的工具协议、剧情质量、缓存命中率。全部测试用的是本地夹具。
- Tauri 2 是否真的把 `__TAURI_INTERNALS__` 注入同源 `/tavern.html` iframe（M8 假设会）。`vendor/tauritavern/src/tauri-bridge.js:13` 依赖这个检查。
- 菜单 Regenerate 在这个上游 pin 里的删除路径（LOW 最后一条）。
- Android 真机、Windows WebView2 上本次没有重跑，沿用 codex 记录的结论。
- `regex-assets.ts`、`assets.ts`、`helper-settings.ts` 只看了路径/ID 守卫，没看保存冲突语义。
- 64 MB 故事包的内存占用（至少字符串化/解析三次）。

## 本次改动

- `src/test/ux-maintenance-models.test.ts:24-25`：导航区域断言从四个改成五个（含「聊天」），测试名同步。未提交。
- 本文档。未提交。
