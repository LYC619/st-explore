# 收口与可靠性执行记录

执行 Agent：Codex；开始日期：2026-11-12（Asia/Shanghai）。
依据：[执行方案](../superpowers/plans/2026-11-10-closeout-reliability.md)。用户已明确启动 goal，第 2 节授权生效；仅本地分支提交与最后一次统一打包。

## 当前恢复点

- goal 活跃，第0–12项实现与对应门禁通过；进入第13项，停止纳入追加项。集中执行第4、7、9项独立原生验收、最终统一门禁、第11项实际双包及最终报告／共享档案。
- 初始分支 `fix/stability-1109`，HEAD `b3f0ea346411c0f91c11a03eed3899c4abd52341`，与方案一致。
- 三批既有源码／测试改动已按第0项提交；同文件跨批不拆块，后批收纳并注明。
- 原 `_reference/`、`start.bat`、`.user/`、`user/`、`.planning/` 状态已仅按路径保存到 `.cache/closeout/protected-status-before.txt`，第 0 项完成时比较。
- 当前 shell 没有 `rtk`，直接运行原命令。没有其他执行者或子 Agent；用户明确要求接续原会话后，仅为恢复该任务读取其技术执行状态。
- 历史私密整理文档不回读正文、不暂存；第 2 项按文档用途保守归档，不运行旧内容筛查脚本。

## 项目与证据

| 项 | 状态 | 提交／证据 | 偏离与缺口 |
| --- | --- | --- | --- |
| 0 | 完成 | `4e342b8` 聊天标签；`1970f7f` 角色整组删除／资产刷新；`549e976` 既有附件路径；文档提交见本记录的 git 历史 | 全量基线存在环境限制和已知 lint／clippy 问题，详情如下；私密和隐私归属不明确文档留第 2 项本地归档 |
| 1 | 完成 | `0e55afa`；两套门禁结果在 `.cache/verify/` | 仅指定预设工作流用例超时放宽至 15 秒；断言不变 |
| 2 | 完成 | `85e7108`；`.cache/closeout/archive-map.json` | 为避免再次摘录私密段落，完整 CURRENT 原文整体存本机私密目录，公开 history 只保留索引；46 份未跟踪记录保守归档 |
| 3 | 完成 | `8d397dd`；`.cache/closeout/item3-*`、`about-{1360,390}.png` | 没有新依赖，原生环境变量与前端产物同源 |
| 4 | 实现与门禁完成，原生待验 | `142b43b`；`.cache/verify/2026-11-12T05-13-57-235Z/` | 第13项验日志落盘、原生命令失败与两种环境信号；日志原始异常消息不保留，主机／模型名保守散列 |
| 5 | 完成 | 本项提交见 git 历史；`.cache/closeout/item5-*` | 技术细节只显示错误类型与构建号，不摘录可能含私密正文的消息 |
| 6 | 完成 | `63fe5ca`；`.cache/verify/2026-11-12T05-53-48-405Z/`、`item6-browser.log` | 全部生成界面与类型迁移；保守默认及实际工作台重挂处理见下文 |
| 7 | 实现与门禁完成，原生待验 | 本项提交见git历史；`.cache/closeout/item7-*` | 单测58通过／1原有忽略；真实独立进程的启动清扫及5秒锁提示留第13项 |
| 8 | 完成 | 本项提交见 git 历史；`.cache/verify/2026-11-12T06-19-56-916Z/` | 26项定向、324文件2633项全量前端、Rust58通过／1原有忽略；未改产品代码 |
| 9 | 实现与门禁完成，原生待验 | 本项提交见git历史；`.cache/closeout/item9-*` | 104项相关测试、类型与lint通过；子格式兼容边界已记录，未扩改 |
| 10 | 完成 | 本项提交见git历史；`.cache/closeout/item10-*` | 67份脚本逐项归类，61份原样归档；全套E2E首跑29通过／27失败，修正测试后相关用例与生产4项通过；CI未实跑 |
| 11 | 入口与门禁完成，实际双包留13 | 本项提交见git历史；`.cache/verify/2026-11-12T07-38-56-192Z/` | 构建边界用合成产物验证；真实NSIS及同源检查在13执行 |
| 12 | 完成 | 本项提交见git历史；`.cache/closeout/item12-*` | README功能详解、截图及其他非指定小节逐段比较保持一致，版本仍0.9.9 |
| 13 | 进行中 | — | 独立原生、最终门禁、双包、报告与共享档案待完成 |

## 授权与验证边界

不推送、不合并、不改版本、不打 tag，不启动正式 identifier 程序或安装器，不读写正式配置，不打开真实库，不用真实模型。原生验证只使用独立构建凭据与合成库。历史测试证据不能替代本轮检查。最终报告分别注明 jsdom、生产浏览器、独立原生与用户桌面验收状态。

## 第 0 项基线（2026-11-12）

三批代码未作新的实现改动。`Library.tsx`、`ChatHub.tsx` 跨批整体归第二批，`file-maintenance.ts` 整体归第三批，不拆分既有补丁。检查在三批合成工作区执行；不声称中间提交独立通过。28 个源码／测试／脚本文件全部已入库；CURRENT 和私密记录未暂存。受保护路径的状态比较为 0 差异（`.cache/closeout/protected-status-{before,after}.txt`）。

| 检查 | 结果 | 耗时／证据 |
| --- | --- | --- |
| 版本一致性、版本脚本 | 通过，5 项脚本测试 | 0.111s／0.367s，`baseline-{version,version-tests}.log` |
| 现有根目录 lint | 扫描历史缓存 120.104s 仍未产出结果，仅停止已核对身份的该子进程 | `baseline-lint.log`；不是通过，第 1 项修正忽略目录 |
| 两套 TypeScript | 通过 | 45.018s／0.852s，`baseline-types-{app,node}.log` |
| Vitest | 312 文件，2538 通过／7 因本机连接 EACCES 失败 | 123.710s，`baseline-vitest.log` |
| provider 环境复核 | 同一 7 项在允许本机连接的执行环境全部通过，未改代码／断言 | 0.594s，`provider-recheck.log` |
| 酒馆源码测试 | 初跑 42 通过／19 因测试链接权限失败；权限具备时 61 全通过 | 37.858s／19.418s，`baseline-tavern.log`、`tavern-recheck.log` |
| 冒烟脚本单测 | 3 项通过 | 0.329s，`baseline-smoke-tests.log` |
| 生产前端构建 | 通过；未运行原生程序 | 17.766s，`baseline-build.log` |
| Rust 单测 | 初跑 46 通过／3 环境相关失败／1 原有忽略；相同源码权限复核 49 通过／1 原有忽略 | `baseline-rust.log`、`rust-recheck.log`，复核测试1.90s |
| clippy 严格检查 | 失败，`st_backup_import.rs:123` 的手工取余判断 | 8.911s，`baseline-clippy.log`；第 1 项处理 |

以上证据均在 `.cache/closeout/`。后续全量门禁使用具备本机固定响应网络与测试目录链接权限的执行环境；这些权限不授权接触正式配置或真实库。

文档分类仅在本机检查文档（不是库文件、原聊天或旧筛查脚本），输出路径、类别与固定原因到 `.cache/closeout/doc-inventory.json`。对隐私归属不明确的历史实测记录和夹具保守保留在本地，不以关键词检查证明没有私密内容；第 2 项整理后的实际清单作为最终依据。

## 第 1 项统一门禁（2026-11-12）

`verify` 和 `verify:web` 都已完整通过。上轮会话在等待前端入口完成时连接失败，接续时已核对两份完整 results.json 与当前补丁，未重复运行已通过且源码未变的检查。

| 步骤 | verify 秒 | verify:web 秒 |
| --- | ---: | ---: |
| 版本 | 0.1 | 0.1 |
| 脚本测试 | 0.4 | 0.4 |
| lint | 19.9 | 18.5 |
| 应用类型 | 40.8 | 40.4 |
| Node 类型 | 0.7 | 0.7 |
| Vitest | 73.9 | 71.8 |
| 酒馆源码 | 19.9 | 20.2 |
| 冒烟脚本 | 0.3 | 0.3 |
| 生产构建 | 9.2 | 9.1 |
| Rust 单测 | 8.3 | — |
| clippy | 2.1 | — |

证据：`.cache/verify/2026-11-11T18-27-33-284Z/`（完整）、`2026-11-11T18-31-14-304Z/`（前端）。目录按 UTC，实际本地执行日为 11 月 12 日。前端 312 文件 2545 项、酒馆 61 项、Rust 49 项通过／1 原有忽略；lint 0 错误／2 原有辅助导出警告。此前指定预设用例独立三次通过，见 `.cache/closeout/preset-single-{1,2,3}.log`，仅此一例上限改为 15 秒。

## 第 2 项状态与私密历史（2026-11-12）

CURRENT 为 4035 字节，全部相对链接可解析。原文全字节备份与46份移入记录逐份 SHA256 比较通过；只按已知用途和未跟踪状态归档，不输出正文、不重跑旧筛查。`git check-ignore` 确认私密目录不入库。产品代码未变，沿用第1项类型门禁。

同时修正公开文档与共享阅读源中的相关链接；公开历史索引说明完整原件仅在本机。`library-review.md` 的既有未提交编辑保留，本项只提交能从 HEAD 确认的链接更正。`.user` 9页发生相关链接／进展变更，统一生成一批（10个阅读页，110个来源页），旧快照、批注及日志保留，无待处理标记。源码／打包／用户验收状态分别记录，仍未打新包。

## 第 3 项构建标识（2026-11-12）

构建生成 `dist/build-info.json`，同一数据注入前端并由 Rust build.rs 读取到编译期；第11项可传入 `STE_BUILD_INFO_FILE` 让所有阶段沿用冻结清单。关于页保留原导航，显示版本／12位提交／北京时间日期／未提交标记；git 不可用时明确未知。只按列明的产品源码与构建输入统计 dirty，排除测试、文档与参考目录，删除／新增也被计入。

脚本2项、前端格式化与既有界面约定46项、两套类型、定向lint、生产构建通过。Rust clippy退出0，无代码诊断，当前受限环境有增量缓存硬链接降级复制的工具链警告。生产Edge在1360／390宽度两组通过：从设置进入关于、清单内容一致、切分区返回和刷新恢复、无源码请求和页面异常；截图已查看。初次生产浏览器检查因本机连接限制停在服务器探测，只停止核实过的该轮测试进程后在允许本机连接环境重跑通过，产品代码与断言未因此更改。

## 第4项日志与环境自检（2026-11-12）

正式和调试桌面构建共用自有受限字段日志出口，放在 Tauri 按 identifier 提供的日志目录；单文件5MiB，最多3个日志文件，跨进程非阻塞锁防轮转冲突，诊断失败不阻断业务。没有新增依赖；不接收第三方插件的任意日志文字。启动清单版本／提交／时间与前端同源，配置只记允许的键和数量，记录库生命周期、原生命令失败／耗时、导入／写回数量、锁等待及前端异常；聊天传输只加失败诊断，仍返回原始 Response、不读取响应正文、不改变请求体。第6项迁移后的重试序号将在统一请求层接入。

隐私取保守默认：原始异常消息全部省略（引号外也可能含正文），只记录固定类别和散列调用位置；私有路径名称用SHA256短散列，保留固定类别目录和常见扩展名；主机／模型名也散列。有限窗口去重、计数，退出刷出剩余计数。原生关于页显示配置名义／句柄解析路径与进程包身份，提供专用日志目录命令，未放宽 opener 权限。失败自检显示无法确认，不假称正常。网页／Android不写文件日志。

验证：前端7项定向检查（含实际关于组件）、脱敏／轮转Rust单测通过；完整 verify退出0：315文件2552项前端、酒馆61、Rust52通过／1原有忽略，版本／脚本／lint／两套类型／生产构建／clippy通过。各步秒数：0.1、0.5、23.4、46.9、0.8、81.2、23.8、0.3、12.6、11.5、2.4，证据见上表。原生实际落盘、失败命令、植入假标记检索、两种环境探测信号仍按方案集中到第13项；用户桌面“正常”仍待用户验证。第4项检查点的追加目录不存在，未收到追加项。

## 第5项异常恢复（2026-11-12）

根入口有应用级边界，真实路由有独立内容边界；内容出错时外层导航保留。中文提示支持重试／首页／刷新，分包失败明确要求重新加载；桌面端复用专用日志入口。技术细节只显示已知错误类型和构建号，原始错误文本不展示；全局异常与拒绝仅诊断，不弹通知。

修复前的实际 App＋外壳＋合成文件库已复现无兜底（`item5-before.log`）。修复后48项定向用例通过，覆盖真实导航保留、重试恢复、懒加载拒绝、应用级异常（含抛出null）、一次上报和全局监听脱敏，未增加产品测试开关。验证发现没有loader的渲染错误不会被一次同步revalidate清除；按路由实际状态机制改用同URL的新导航键重试，测试已验证恢复。

两套类型、定向lint和生产构建通过。最终生产Edge3组通过：关于页1360／390以及故意断开设置页分包后中文兜底、导航仍可见、返回真实首页。最初分包注入未命中，记录证实 blocked=0 且 serviceWorkerControlled=true；只在这条故障注入用例中阻止ServiceWorker接管，并断言确实拦到分包，其余生产用例保持原样。独立原生运行仍统一留第13项。

## 第6项统一AI请求（2026-11-12）

`src/lib/llm/` 沿用共享原始传输：桌面 plugin-http，网页 fetch。请求体字段与旧实现一致；旧请求模块已删除，所有调用和类型引用已迁移。聊天四个原始响应调用方、提示词处理、玩法预算及熔断保持原逻辑，酒馆只迁移模型列表入口。允许空密钥的保存、选择、状态栏及请求链路已打通。

默认首字节300秒／空闲180秒／非流式600秒；设置探测和模型列表30秒且不重试。最多3次重试，504／524至多1次，本地超时、有部分输出、被拦截、空回复及截断均不自动重试。分类中文错误带状态与次数，不复制服务错误正文。SSE坏行计数、Unicode跨块、取消、提前结束、部分输出及原生传输诊断有合成测试。保守默认：Retry-After超过5分钟时直接报告分类错误，绝不提前重试；列入最终待用户决定。

每个生成界面显示独立截断提示，部分改写可在原有对照窗保留；空回复不会自动暂存。真实 SummaryWorkspace 的自动暂存会重挂编辑器，已先复现提示消失（`item6-remount-before.log`），再由工作台保存当前会话的提示状态；提示不写正文、不改磁盘结构，离开工作台后的历史条目不持久保存该标记。此保守选择列入最终报告。

批量按完成顺序连续3段限流／服务故障后停止领取新段，在途段继续结束；取消会中止在途请求。错误、警告与正文分离，仅合并成功内容；默认并发和布局保持原样。真实组件测试覆盖全部迁移界面、批量在途成功保留／取消、截断提示、实际总结自动暂存及重挂，组件／上下文／持久层不 mock，只使用合成内存文件库和假网络。

阶段证据：`item6-focused-final.log` 55项通过，桌面传输边界随后纳入完整门禁。全量前端第一次进入Vitest时2604通过／1失败，唯一失败是酒馆模型列表仍断言原始错误“断网”；已改断言为分类网络提示和1次尝试，仍保留最后成功列表的缓存断言。不是改动酒馆聊天运行行为。

最终 `verify:web` 全通过：321文件2605项前端、酒馆61项、脚本及冒烟单测、lint、两套类型与生产构建通过。各步秒数为0.1、0.5、21.6、45.6、0.8、75.8、20.7、0.3、12.1。生产Edge4项通过（29.2秒），新增实际设置页面空密钥保存、401分类、只有一次请求、不显示服务原文、刷新后配置仍在；另三项关于页／分包失败回归保持通过。原生HTTP在单测中只替换平台边界验证，实际原生应用留第13项；未使用真实模型。

## 第7项原生可靠性（2026-11-12）

配置写锁改为50毫秒间隔尝试，最多等待5秒，超时返回独立标记与中文提示并写受限诊断。系统配置桥接在调用方捕获错误时仍显示专门提示，原有敏感配置镜像逻辑未改。真实文件锁单测验证等待上限、失败不改配置、释放后可重试；配置恢复界面和新增提示4项通过，两套类型与定向lint通过。

启动后的后台清扫只处理严格生成名称 `ste-st-import-<pid>-<nonce>`、超过24小时且能证明进程已退出的目录；新目录、活进程、进程状态不明、名称不符、符号链接／重解析点及含嵌套链接的目录均保留。受限树检查超限也保留，访问或删除失败记安全日志并继续其他候选。Windows用只等待退出的进程句柄检查，Unix只发信号0探测，不发送终止信号。测试仅在新建合成父目录中使用模拟时间与生存状态，另核对当前进程不会被判已退出。初次创建Windows符号链接因1314缺少系统权限失败；没有新增跳过，改用无需管理员权限的目录联接，实际根／嵌套重解析点和目标保留测试通过。文件独占时跳过、继续清扫其他候选、释放后重试也通过。

解压最多读声明大小加1字节，超出即失败；总量按实际复制字节累计。测试100字节输入声称3字节时只读／写4字节就失败，正常与短流按实际3／2字节返回。最终Rust 58通过、1原有忽略（1.58秒），clippy退出0且无源码诊断；构建工具仍提示既有增量缓存硬链接失败后降级复制。证据为 `item7-rust-verified.log`、`item7-clippy-verified.log`、`item7-ui.log`、`item7-types-*`、`item7-lint.log`。

第13项独立原生启动验收必须同时把TEMP/TMP指到本轮新建合成目录，防止清扫触及历史导入残留；这只是独立identifier／构建凭据之外的附加隔离，不能替代原生隔离规则。届时核对真实退出进程候选、实际5秒锁超时提示、日志落盘。仍未启动正式程序。

## 第 8 项真实页面与启动协作测试（2026-11-12）

新增 `app-real-routes.test.tsx` 和 `vault-bootstrap-integration.test.ts`。22个具体路由分支（含跳转、缺失记录和404）在合成空库中渲染真实 App、外壳与页面；角色详情带真实信息栏、故事、评分和资产组件，切换故事／备注／关联资产／立绘／角色卡编辑／开场白并打开评分窗口。启动用例只替换原生 invoke，实际运行注册表、作用域、配置恢复、文件系统桥和后端，验证正常、本库API配置、失效根目录与配置损坏。

| 计划点名文件 | 第8项前的实际证据 | 第8项后 |
| --- | --- | --- |
| App | 第5项 app-error-boundary 已真实加载 App，故旧计划“从未加载”对此不成立 | 全部22路由真实渲染 |
| RatingPanel | 第6项 llm-ui 已真实渲染，旧结论已失效 | 随真实角色页渲染、打开评分窗口 |
| CharacterPage、AssetSection、CharacterInfoRail、StoryListSection | 搜索既有测试未发现真实加载；frontend-contract 等只读源码不算 | 合成角色页及六个标签页实际渲染 |
| ChatHub、CardViewer、Beautify、WorldPlay | 既有测试未发现真实加载 | 真实App路由渲染 |

针对这10个文件，未有真实加载证据的清单从8个降为0个。核对方法：检查既有测试的 import／vi.mock／源码读取，再核对新用例的真实模块加载和渲染路径；不把代码文本断言算作运行证据。

首轮发现的四处均为测试接线问题：原生根目录 stat 与 MemFs 空路径约定不同；酒馆入口会请求本地默认资源；404主动记录固定错误；冷加载整套页面的编译与React异步边界混入交互时限。只补平台替身及测试加载等待，未改产品代码；页面模块在 setup 中真实加载，未 mock 页面或子组件。未发现需另记的产品缺陷。所有网络仅固定本地资源替身，无模型请求。

验证：`item8-focused-third.log` 26通过；两套类型检查通过；全量 verify 的11个步骤全部通过，日志 `.cache/verify/2026-11-12T06-19-56-916Z/`。步骤耗时依次为0.1、0.4、20.3、40.3、0.7、79.7、21、0.3、10.3、9.5、2.9秒；前端324文件2633项，Rust58通过／1原有忽略。首次全量命令的自动权限审核超时未启动，允许的一次重试成功。追加项目录未出现文件，本检查点无追加项。以上为jsdom／构建／Rust单测证据，未启动原生程序。

## 第 9 项库格式说明与新版本保护（2026-11-12）

原先桌面启动及所有选库路径都能激活高于当前库级版本的库；五个新行为断言在实现前失败（`item9-red.log`），其余兼容用例通过。现在共用 `assertCompatibleVault`，在后端创建／扫描前直接读取元信息；高版本返回明确提示，启动保留选文件夹入口，运行中保留当前后端与下一启动目标，零目标库写入。版本常量拆至轻量 `archive-schema.ts` 并由原迁移模块重导出，值仍为2，不引入新依赖或磁盘字段。

补充 `docs/principles/vault-format.md`，逐项核对11种Repo store与旁路写入器，记录真源／派生文件、必填与可选字段、运行与恢复资料、导出包、外部编辑和不可改的身份；不扫描真实资料。迁移已有失败重试和幂等测试，本轮引用并重跑，没有重复实现迁移。

验证：`item9-final-focused.log` 8文件104项通过，其中新门禁13项；真实 VaultGate 与 VaultSwitcher 显示同一句错误且仍可选库，高版本启动／引导／已注册切换／新增下次启动目标均拒绝；文件系统写入记录为空，原内容与当前后端保持。当前／旧版／缺字段／字符串／null均可启动和切换，缺元信息与JSON损坏沿用既有处理；读取权限失败不绕过。网页启动不触发原生命令。两套类型与改动文件lint通过，最终测试变更后的app类型和lint重跑通过。第8项两个旧接线单测的文件系统替身增加元信息读取能力，未删改原断言。独立原生仍留第13项。

子格式静态核查发现、按计划只记录不修：预设标签的更高schema会在规整／保存时回到2；显式ST重导会以version1写生成的personas清单；故事摘要缓存忽略更高schema后可重建覆盖（可丢弃缓存）；完整备份未按高DB_VERSION拒绝且仅处理已知store。最终报告需区分数据兼容风险与缓存例外。新库级规则要求未来不兼容格式先提升库级schema，不能只升子格式。

## 第10项冒烟与 CI（2026-11-12）

实际盘点为67个原顶层脚本（旧方案为68）；61个原样归档且逐份SHA256一致，6个保留／更名，加统一入口共7个顶层文件。原生构建与凭据工具只提供隔离支持，不随冒烟启动程序；实际浏览器冒烟为阅读包和路由资源两项。后者只证明11条HTTP路由及入口资源响应，不替代页面交互。

稳定冒烟已通过，证据 `.cache/smoke/2026-11-12T07-04-45-188Z/`。三个候选失败后原样归档：maintenance-editors等旧“保存”；library-maintenance-smoke已完成合成删除但等旧回收区标题；preset-series-production等旧“打开完整详情”。maintenance-service-worker静态核对发现硬编码旧缓存版本，未执行。真实模型／正式目录脚本均未执行。候选日志见 `.cache/smoke/2026-11-12T06-57-19-391Z/`、`2026-11-12T06-59-29-715Z/`、`2026-11-12T07-00-50-544Z/`。

统一入口：`npm run smoke`按顺序运行凭据安全测试、构建、独立dev阅读包检查与preview路由检查；`npm run verify:e2e`依次运行smoke、roleplay、production，失败即停。CI前端改用verify:web，Windows Rust任务先构建dist，再test及clippy，不构建安装器或发布；YAML解析通过，命令已有本机证据，**CI未实跑**。

本机Vite测试服务器的配置加载在 `ste-pinned-tavern-frontend.configureServer` 阻塞。默认加载120秒及runner方式45秒超时，native加载加类型剥离后也阻塞；阶段探针定位后，预先原生import同一份完整配置，再用`configFile:false`创建服务器约2.1秒启动，所有插件保留。最终仅在测试服务器入口预加载配置，alias用`import.meta.dirname`，不同端口用独立缓存。证据 `.cache/closeout/item10-vite-{probe,traced,preloaded}.log`；不是停用酒馆插件或改运行行为。

两套类型、7项脚本测试已通过；浏览器全量与失败用例原因待下文补齐。

### 原脚本 → 去向 → 理由

路径均相对 `scripts/smoke/`；archive内脚本不再是执行入口。

| 原脚本 | 去向 | 理由 |
| --- | --- | --- |
| `benchmark-vault-20261105.mjs` | `archive/benchmark-vault-20261105.mjs` | 旧绝对目录性能基准，未证明样本为合成；不执行 |
| `build-isolated-native.mjs` | `build-isolated-native.mjs` | 保留独立构建／凭据校验支持；安全单测接统一门禁，实际程序不随smoke启动 |
| `compare-summary-transport-20261109.mjs` | `archive/compare-summary-transport-20261109.mjs` | 历史配置与提示词传输比较；不重读历史配置，统一请求已有新用例 |
| `delete-large-vault-20261109-native.mjs` | `archive/delete-large-vault-20261109-native.mjs` | 历史原生专项，不能以旧进程或旧构建凭据证明本轮行为；留第13项统一复查 |
| `existing-paths-20261111-native.mjs` | `archive/existing-paths-20261111-native.mjs` | 历史原生专项，不能以旧进程或旧构建凭据证明本轮行为；留第13项统一复查 |
| `exit-20261109-native.mjs` | `archive/exit-20261109-native.mjs` | 历史原生专项，不能以旧进程或旧构建凭据证明本轮行为；留第13项统一复查 |
| `exit-failed-load-20261109-native.mjs` | `archive/exit-failed-load-20261109-native.mjs` | 历史原生专项，不能以旧进程或旧构建凭据证明本轮行为；留第13项统一复查 |
| `exit-process-20261109.ps1` | `archive/exit-process-20261109.ps1` | 历史原生专项，不能以旧进程或旧构建凭据证明本轮行为；留第13项统一复查 |
| `experience-notes.mjs` | `archive/experience-notes.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `feedback-20261109-native.mjs` | `archive/feedback-20261109-native.mjs` | 历史原生专项，不能以旧进程或旧构建凭据证明本轮行为；留第13项统一复查 |
| `feedback-release.mjs` | `archive/feedback-release.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `global-ui-consistency.mjs` | `archive/global-ui-consistency.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `large-vault-fixture-20261109.mjs` | `archive/large-vault-fixture-20261109.mjs` | 旧原生专项的合成夹具生成器；随该组归档，第13项另建合成现场 |
| `library-maintenance-smoke.mjs` | `archive/library-maintenance-smoke.mjs` | 本轮实跑已完成合成删除，但断言仍找旧“删除时保留的文件”分组；界面已改为“库内回收站与长期保留文件”，按方案归档 |
| `library-review-smoke.mjs` | `archive/library-review-smoke.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `maintenance-editors.mjs` | `archive/maintenance-editors.mjs` | 本轮合成实跑等待旧“保存”按钮超时；按计划归档，不修改产品迁就旧选择器 |
| `maintenance-reader.mjs` | `maintenance-reader.mjs` | 真实阅读包Worker、桌面重排、移动书签和重复定位通过；接smoke |
| `maintenance-service-worker.mjs` | `archive/maintenance-service-worker.mjs` | 硬编码旧缓存版本 st-chat-v0.9.1，现已过时；不为旧断言改产品 |
| `native-formal-20261105.ps1` | `archive/native-formal-20261105.ps1` | 已停用的正式目录测试；保持原样，不执行或复活 |
| `native-integrated-20261105.ps1` | `archive/native-integrated-20261105.ps1` | 涉及正式目录或身份，未满足本轮原生隔离要求；不执行 |
| `native-performance-20261105.mjs` | `archive/native-performance-20261105.mjs` | 历史原生专项，不能以旧进程或旧构建凭据证明本轮行为；留第13项统一复查 |
| `native-performance-20261105.ps1` | `archive/native-performance-20261105.ps1` | 历史原生专项，不能以旧进程或旧构建凭据证明本轮行为；留第13项统一复查 |
| `native-test-artifact.mjs` | `native-test-artifact.mjs` | 保留独立构建／凭据校验支持；安全单测接统一门禁，实际程序不随smoke启动 |
| `native-test-safety.test.mjs` | `native-test-safety.test.mjs` | 保留独立构建／凭据校验支持；安全单测接统一门禁，实际程序不随smoke启动 |
| `performance-library.mjs` | `archive/performance-library.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-20261031-chat.mjs` | `archive/playtest-20261031-chat.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-20261031-presets.mjs` | `archive/playtest-20261031-presets.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-20261031-production.mjs` | `archive/playtest-20261031-production.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-20261031-round2-concepts.mjs` | `archive/playtest-20261031-round2-concepts.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-20261031-round2-scan-regex.mjs` | `archive/playtest-20261031-round2-scan-regex.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-20261101-chat-presets.mjs` | `archive/playtest-20261101-chat-presets.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-20261104-extensions.mjs` | `archive/playtest-20261104-extensions.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-20261104-frontend-refresh.mjs` | `archive/playtest-20261104-frontend-refresh.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-20261104-frontend.mjs` | `archive/playtest-20261104-frontend.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-20261104-native-integrated.mjs` | `archive/playtest-20261104-native-integrated.mjs` | 历史原生专项，不能以旧进程或旧构建凭据证明本轮行为；留第13项统一复查 |
| `playtest-20261104-native.mjs` | `archive/playtest-20261104-native.mjs` | 历史原生专项，不能以旧进程或旧构建凭据证明本轮行为；留第13项统一复查 |
| `playtest-20261104-process.mjs` | `archive/playtest-20261104-process.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-20261104-real-model.mjs` | `archive/playtest-20261104-real-model.mjs` | 依赖真实模型／配置，超出本轮授权；不执行 |
| `playtest-20261104-usability.mjs` | `archive/playtest-20261104-usability.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-20261105-diagnostics.mjs` | `archive/playtest-20261105-diagnostics.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-20261105-native-integrated.mjs` | `archive/playtest-20261105-native-integrated.mjs` | 历史原生专项，不能以旧进程或旧构建凭据证明本轮行为；留第13项统一复查 |
| `playtest-20261107-chat-load.mjs` | `archive/playtest-20261107-chat-load.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-20261107-chat-native.mjs` | `archive/playtest-20261107-chat-native.mjs` | 涉及正式目录或身份，未满足本轮原生隔离要求；不执行 |
| `playtest-20261107-connection-native.mjs` | `archive/playtest-20261107-connection-native.mjs` | 历史原生专项，不能以旧进程或旧构建凭据证明本轮行为；留第13项统一复查 |
| `playtest-20261107-world-b25.mjs` | `archive/playtest-20261107-world-b25.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-20261107-world-compatibility.mjs` | `archive/playtest-20261107-world-compatibility.mjs` | 旧扩展专项的包装入口；依赖归档脚本，不接稳定集合 |
| `playtest-20261107-world-load.mjs` | `archive/playtest-20261107-world-load.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-20261107-world-native.mjs` | `archive/playtest-20261107-world-native.mjs` | 涉及正式目录或身份，未满足本轮原生隔离要求；不执行 |
| `playtest-20261107-world-production.mjs` | `archive/playtest-20261107-world-production.mjs` | 依赖旧 .cache 世界包；按规则不复用历史产物 |
| `playtest-20261107-world-real-model.mjs` | `archive/playtest-20261107-world-real-model.mjs` | 依赖真实模型／配置，超出本轮授权；不执行 |
| `playtest-20261107-world-real-prose.mjs` | `archive/playtest-20261107-world-real-prose.mjs` | 依赖真实模型／配置，超出本轮授权；不执行 |
| `playtest-20261107-world-recovery.mjs` | `archive/playtest-20261107-world-recovery.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-20261107-world-soak.mjs` | `archive/playtest-20261107-world-soak.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-20261107-world.mjs` | `archive/playtest-20261107-world.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-followups.mjs` | `archive/playtest-followups.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-polish-smoke.mjs` | `archive/playtest-polish-smoke.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-presets-chat.mjs` | `archive/playtest-presets-chat.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `playtest-round2-resources.mjs` | `archive/playtest-round2-resources.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `preset-experience.mjs` | `archive/preset-experience.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `preset-navigation.mjs` | `archive/preset-navigation.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `preset-series-production.mjs` | `archive/preset-series-production.mjs` | 本轮生产构建实跑等待旧“打开完整详情”按钮超时；不硬修历史界面流程，原样归档 |
| `preset-series-workbench.mjs` | `archive/preset-series-workbench.mjs` | 历史界面／性能专项；本轮不判定其仍可运行，不扩修旧选择器或重复加入稳定集合 |
| `stage10-route-smoke.mjs` | `route-assets.mjs` | 生产HTML路由与入口资源响应通过；稳定命名，接smoke；不把HTTP检查声称为页面交互验证 |
| `startup-20261109-native.mjs` | `archive/startup-20261109-native.mjs` | 历史原生专项，不能以旧进程或旧构建凭据证明本轮行为；留第13项统一复查 |
| `verify-final-20261105.ps1` | `archive/verify-final-20261105.ps1` | 旧门禁包装已由 verify／verify:e2e 与原生凭据工具替代；不再重复维护 |
| `verify-native-artifact.mjs` | `verify-native-artifact.mjs` | 保留独立构建／凭据校验支持；安全单测接统一门禁，实际程序不随smoke启动 |
| `verify-platform-20261105.ps1` | `archive/verify-platform-20261105.ps1` | 旧门禁包装已由 verify／verify:e2e 与原生凭据工具替代；不再重复维护 |


### 首次完整浏览器检查（失败保留）


`npm run verify:e2e`：smoke通过，roleplay 29通过／27失败，用时732.4秒，production因前项失败尚未执行。日志 `.cache/verify/2026-11-12T07-04-45-120Z/`；截图、trace与失败上下文已另存 `.cache/closeout/item10-first-browser/`，避免复验覆盖。

| 用例 | 原因及处理 |
| --- | --- |
| `archive-workflow.spec.ts:32` detail moves records to a sibling branch, reads full content and preserves ownership on reload | 旧正文样式／楼层处理菜单／收录及批量管理入口；已按真实界面更新，待复验 |
| `archive-workflow.spec.ts:64` processing clears numeric input and persists a single batch unhide without plugin changes | 旧正文样式／楼层处理菜单／收录及批量管理入口；已按真实界面更新，待复验 |
| `archive-workflow.spec.ts:85` captures consecutive records from a saved message and imports them once into the current character worldbook | 旧正文样式／楼层处理菜单／收录及批量管理入口；已按真实界面更新，待复验 |
| `playtest-1006.spec.ts:55` library return keeps sorting and tags; cloud portrait preview downloads a selected image | 图床导入已改自动预览／高级设置入口；已更新入口及保留导入、并发和后台保存断言，待复验 |
| `playtest-1007.spec.ts:75` Catbox preset downloads concurrently in the background with Chinese names | 图床导入已改自动预览／高级设置入口；已更新入口及保留导入、并发和后台保存断言，待复验 |
| `playtest-controls.spec.ts:22` visible branch and script controls keep live execution and persistence on the selected line | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:117` original Tavern opens a STE story, streams a reply and persists it for reopening | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:154` a delayed welcome template cannot insert its panel or greeting into an opened story | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:175` a character without archived chats starts a new story using the original greeting | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:198` Agent mode automatically reads green lore, freezes actual provider context and commits sourced file memory | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:251` classic mode uses the linked preset, depth lore and original regex editor without losing WI placement | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:301` built-in helper scripts and HTML use scoped variables and clean up on chat reload | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:398` complete story package downloads from Tavern and restores through the STE library | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:442` original chat history exports raw JSONL and character import opens the STE library after saving edits | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:466` a 2000-message story stays virtualized with bounded Agent input and no per-token story writes | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:527` helper download and project links reach the parent external browser bridge | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:571` native overswipe generates and reopens candidates without a branch (stream=true) | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:571` native overswipe generates and reopens candidates without a branch (stream=false) | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:615` existing swipes and original message editing keep STE IDs and candidate data | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:643` stop cancels the actual provider stream and the accepted partial text can be reopened | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:660` browser Back retains the current editor and explicit close flushes it | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:684` a failed story write keeps the live chat open and retry preserves the edited prose | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:712` failed saving still lets the player export the editor and input, then explicitly leave | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:757` the chat hub opens conversations directly and guides a new chat to its real settings | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:794` the original branch command creates an internal STE branch and continues only that line | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:861` a reload recovers the composer and an unfinished editor draft without treating it as a generated fact | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |
| `runtime.spec.ts:883` real BaiBai 1.2.7 installs, summarizes through ST, survives reopening and yields ownership to the native Agent | 本地固定响应服务未处理模型列表GET，错误地解析空正文；已补合成列表响应，待复验 |


本次维护中的Playwright用例与历史smoke不同：保留实际浏览器行为断言，只修正过时入口／夹具。具体为：记录正文改定位现有阅读区，并验证展开后完整文本和无裁切；批量隐藏从“楼层处理”进入，正则栏按当前展开状态操作；收录使用当前按钮并先开“批量管理”；图床使用高级模板与自动预览，夹具采用不同图片字节避免现有内容去重；并发检查直接验证4个导入任务在途、1个等待，同时证明确有并发网络请求，避免把共享预览请求误当成导入线程。运行测试的本地固定响应服务补GET模型列表（第6项允许空密钥后会走真实刷新）；权限断言定位具名脚本frame，不任取第一个srcdoc。未改酒馆、图床、记录等产品实现，未删断言或放宽全局时限。

### 第10项最终结果

第二次仅跑5个受影响文件：34项中30通过／4失败，证据 `.cache/closeout/item10-browser-focused.log`，失败现场留 `.cache/closeout/item10-second-browser/`。4项分别为正则栏本已自动展开却再次切关、同字节图片被去重、预览队列改变了网络请求计数、权限检查取错匿名frame。按实际状态修正后，这4项全部通过：`.cache/closeout/item10-browser-final-focused.log`，含助手50次真实重载的清理断言。其余52项已有相同相关实现的通过证据；这不是声称一次全套verify:e2e退出0，最终统一重跑留第13项。

生产构建Edge检查4项全通过：`.cache/closeout/item10-production.log`，覆盖两种宽度关于页、真实分包加载失败兜底和空密钥固定服务错误。7项脚本安全测试与5文件定向lint通过；最终两套类型证据为 `.cache/closeout/item10-types-{app,node}-final.log`。没有修产品以迁就旧测试，未执行旧原生／真实模型脚本。

## 第11项统一打包入口（2026-11-12）

新增 `npm run release:pack -- <标签>`，北京时间目录，原子占用新目录并拒绝覆盖。一次冻结build-info，前端及Rust同源；构建后核对dist清单与exe内嵌清单、源码提交和dirty路径，生成安装版／免安装版、两份清单、执行状态、构建日志与体验更新模板。固定Windows x64及本机release codegen-units=256，不运行任何产物；打包、用户验收和发布分开记录。失败目录保留，无“已完成”清单，不以删除目录方式重试。发布指南记录打包前检查与需另行授权的发布步骤。

脚本行为测试修改前3项失败，修改后3项通过：`.cache/closeout/item11-{red,focused}.log`，覆盖非法标签／旧目录保护、冻结清单与两份文件实际SHA256、失败记录及拒绝覆盖重试。仅在构建进程边界注入合成产物，不能替代真实NSIS打包；实际双包仍集中在第13项。没有新依赖。

保守边界：打包期间禁止编辑源码；结束时会检测提交和dirty路径变化，但同一路径的未提交文本再次变动不靠该路径检查检测。此限制已写入发布清单。第11项追加项目录不存在，没有追加项。全量verify进行中，最终结果在本节补齐。

第11项完整门禁第一次在Vitest失败（2645通过／1失败）：第10项重命名后遗漏 `src/test/smoke-fixture.test.ts` 的旧文件路径，确认为本轮遗漏而非历史问题；保留断言更新引用，定向通过，并单独补交第10项提交 `7795f32`（主提交 `7c1be14`）。证据 `.cache/verify/2026-11-12T07-34-53-639Z/`、`.cache/closeout/item11-smoke-fixture.log`。

修正后重新运行完整verify全部11步退出0：325文件2646项前端、酒馆61项、Rust58通过／1原有忽略，脚本、lint、两套类型、构建与clippy通过。证据 `.cache/verify/2026-11-12T07-38-56-192Z/`；各步秒数0.1、0.4、17.8、39.9、0.7、79.8、19.1、0.3、9.5、9.5、2.7。追加目录在本项完成后复核仍不存在，无追加。

## 第12项README与定位（2026-11-12）

徽章同步到实际0.9.9，并纳入sync-version的唯一标记检查、只读漂移报告和幂等写入。扩展原有合成夹具后先复现漏查README（1失败／4通过），接入后5项全通过；`npm run version:check`及两套类型通过。证据 `.cache/closeout/item12-version-{red,tests}.log`、`item12-types-{app,node}.log`。

README仅改版本徽章、项目简介、路线图，并在简介中加“继续游玩与实验玩法”小节，按用户11月10日原话含义区分存档回味与游玩实验；新增定位原则页及索引，CHANGELOG加未发布变化。逐段比较确认功能详解、截图与两小节之间原有内容不变。版本号、已有磁盘格式和玩法代码均未改。进入第13项后不再收追加项。
