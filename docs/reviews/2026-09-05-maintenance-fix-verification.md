# 维护修复验证记录

执行日期：2026-09-06 至 2026-09-08，Asia/Shanghai。
依据：`2026-09-05-maintenance-review.md` 和四份 maintenance 子计划。
验证时 HEAD：`fc26f091e0d2c7f32b9e6d3235fd4830bb912fd4`，分支 `main`。
以下命令结果记录提交前的验证状态：版本保持 `0.9.1`，验证结束时修复尚未暂存或提交。
2026-09-08 用户授权本地提交，范围包括 F01-F16、已独立验证的 S1、回归测试及维护文档。
无关工作区改动继续保留；未安装、推送或发布。

## 结论与验收边界

- [x] F01-F16 的代码修复和自动化回归。
- [x] ST 导入 WIP 的取消、进度、切库隔离、清理生命周期验收与补修。
- [x] 干净依赖安装、两个 TS 工程、lint、1581 项前端测试、前端构建。
- [x] Windows 原生普通测试：42 通过；Tauri/NSIS 安装包构建成功。
- [x] Edge 真实编辑器导航、阅读包 Worker、阅读重排与书签滚动、SW 升级与离线回退。
- [x] Android `cap sync`，仅表示资源与插件同步成功。
- [ ] Windows 符号链接特权用例：实际执行失败，系统错误 1314。
- [ ] Tauri 安装/升级、交互窗口内的文件对话框、回收站和恢复流程。
- [ ] Android APK、安装、窄/宽屏系统返回、原生分享与设备内存。

以上完成的是维护修复与当前环境可执行的验证，不是全部平台发布验收。
测试仅使用合成记录、隔离浏览器上下文和临时文件；未读取真实用户库。

## 最终候选与可复查证据

候选目录：`D:/8.Project/0_0_维护/.ste-maintenance-candidate-20260908`。
从当前工作区逐文件复制源码、配置、原生工程和未跟踪 WIP，省略原本已删除的文件；
没有用裸 HEAD 冒充验证当前修改。依赖在候选目录执行 `npm ci`。
最后比较确认，源码、配置和烟雾脚本与工作区字节一致。

- `_verification/source-fingerprints.csv`：574 个非 Android 源码/配置文件的 SHA-256。
- `_verification/tracked-source.patch`：tracked 源码、配置与版本修复的完整 diff。
- 候选目录内的源码副本另包含新增的 untracked 模块和测试。
- Android 同步只在候选目录执行，没有把生成文件回写原工作区。

交接前的 S0 原始源码快照和哈希文件本轮未能在原计划指定目录找到，因此不能声称
完成了“与修复前每个 WIP 文件的哈希一致”检查。已经逐项复核重叠 ST 代码，保留其
进度弹窗、选择/结果弹窗、取消、部分导入计数与错误反馈。最终指纹可用于后续复核，
不能倒推为修复前证据。`_reference` 删除、`start.bat` 删除和其他规划/发布 WIP 均未回退。

## 命令与结果

除注明者外，以下最终门禁在候选目录执行；当前工作区对应源码已校验相同。

| 检查 | 结果 |
| --- | --- |
| `npm ci --no-audit --no-fund` | 退出 0，安装 476 个包 |
| `node scripts/sync-version.mjs --check` | 退出 0，版本源均为 0.9.1 |
| `node --test scripts/sync-version.test.mjs` | 退出 0，4 项通过 |
| `node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit` | 退出 0 |
| `node node_modules/typescript/bin/tsc -p tsconfig.node.json --noEmit` | 退出 0 |
| `node node_modules/eslint/bin/eslint.js . --quiet` | 退出 0 |
| `node node_modules/vitest/vitest.mjs run --reporter=dot` | 退出 0，170 文件 / 1581 测试，2026-09-08 00:26 开始 |
| `npm run build` | 退出 0，包含独立阅读包 Worker 产物 |
| `node node_modules/@capacitor/cli/bin/capacitor sync android` | 退出 0，App/Filesystem/Share 三个插件 |
| `cargo test --offline --manifest-path src-tauri/Cargo.toml --lib` | 工作区及候选均退出 0，42 通过、1 ignored；候选复用 Cargo 编译缓存 |
| `npm run tauri:build`，原工作区 | 退出 0，生成 STE.exe 和 NSIS 安装包 |
| `git diff --check`，原工作区 | 退出 0；使用原仓库换行配置 |
| `git diff --cached --stat`，原工作区 | 验证结束时为空；此后用户授权本地提交 |

较早的组合测试分别为 1576 和 1580 项通过；最后追加卸载后原生清理失败提示回归，最终以 1581 项为准。
定向检查包括 D 的 169 项、R1 的 115 项、实际 TanStack 阅读器的 55 项，以及 P 的 85 项；
这些范围互有重叠，不相加作为测试总数。
依赖弃用提示、Vite/React Router 迁移提示和负例日志仍存在；本报告不声称零警告。

## F01：附件在角色改名后定位错误

`attachment-store.ts` 统一解析角色相对路径，兼容旧记录但不回退到旧角色目录。
预览、读取、外开、定位、删除通过角色 ID 和附件 ID 重读，并将文件访问保持在角色队列内。
`attachment-safety.test.ts` 覆盖改名、重开、旧名复用、文件缺失及 read/open/reveal 与改名交错。
原错误证据见审查 F01；上述回归在最终全量中通过。真实 Tauri 外开仍未验收。

## F02：阅读包覆盖本机字段

`reading-pack/import.ts` 只接收发送端拥有的内容字段，保留接收端附件、关联、未解析关联和来源路径。
`reading-pack-source.ts` 在 apply 时重读当前记录并重新判断覆盖。
`reading-pack.test.ts` 覆盖注入字段、并发更新/删除，以及文件库新 backend 和 IDB 新连接重开。
P1/P2 初次运行 13 项失败，修复后通过；详细 RED/GREEN 见 `2026-09-07-reading-pack-execution.md`。

## F03：立绘替换失败丢失旧图

`portrait-store.ts`、`character-mutation.ts`、`portrait-journal.ts` 将替换拆为准备、档案提交、清理。
准备阶段保留旧文件；通过真实档案判定提交或回滚，派生快照不作为提交依据。
`portrait-mutation.test.ts` 覆盖 journal/临时写/rename/profile 故障、写后报错和清理重试。
后续复核补齐连续清理失败的写入门禁、错误编号和损坏档案重开提示；最后 4 项有明确 RED/GREEN。
最终全量通过；进程重启通过新 backend 合成恢复验证，真实壳故障恢复仍未验收。

## F04：Vite/Vitest 类型不兼容

保留 Vite 8.2.2 和 SWC 4.3.3，Vitest 固定为相容的 4.1.11。
选型记录在 `2026-09-05-toolchain-selection.json`；原 node 工程 TS2769 见审查证据。
没有用 `any` 或 `skipLibCheck` 遮蔽该错误。干净安装后两个 TS 工程和构建均通过。

## F05：版本源不一致

新增 `scripts/sync-version.mjs` 和独立脚本测试，package version 为输入，check 模式只检查。
同步现有 0.9.1，CI 接入版本检查与两个 TS 工程；`.gitignore` 明确保留这两个必要脚本。
原两个版本失败见审查；当前版本套件和 4 项脚本测试通过，覆盖只读 check、幂等写入、
异常标记预检、Cargo 本包定位和其他包字节保持。真实 SW 等待、激活、旧缓存清除也已通过。

## F06：阅读包覆盖分支阅读进度

同 ID 分支保留接收端进度；主线和分支缩短时夹取到有效楼层，删除分支不复活。
`reading-pack.test.ts` 覆盖保留、缩短、新增、删除、空内容及异常数值。
RED 属于 P1/P2 的 13 项初始失败；最终全量及文件库/IDB 重开均通过。

## F07：query 身份导航没有更新编辑内容

三个编辑器使用 `use-asset-identity-navigation.ts`，区分身份 query 与普通显示 query，
以请求序号隔离旧加载/保存，拒绝丢弃草稿时恢复 URL，COW 保存使用已接受的角色上下文。
R1 初始 33 项失败；`worldbook-navigation`、`preset-navigation`、`regex-navigation` 与
`app-layout-navigation` 回归通过。独立审查另复现旧保存覆盖新导入 ID，补充 RED/GREEN。
Edge 实际执行三种编辑器 A/B 切换、脏稿取消及普通 query 保留草稿，全部通过。

## F08：小说页测量和重排重置位置

测量节点固定在稳定容器，忽略已卸载和零尺寸节点；分页携带原始文本块偏移。
布局变化按当前逻辑锚点定位，故事/分支身份变化才重新初始化。
`novel-location.test.ts` 初始 3 项失败；交互组初始 4/5 项失败，修复后通过。
Edge 桌面窗口缩放确认同一段落保留；Android 旋转和设备字体仍未验收。

## F09：目录/书签只变页码、不滚正文

显式跳转与滚动进度反馈分开；新跳转替换旧 timer/RAF，用户滚轮/触摸取消跳转。
真实浏览器补修了列表原点重复计算造成的 44px 偏移。
独立审查发现 TanStack 自身仍会继续协调已取消跳转，现通过公开 `scrollToFn` 边界
阻止过期滚动指令，保留正常尺寸补偿。实际 TanStack 回归先失败 2 项，再全部通过。
Edge 移动视口书签落点 `scrollTop=28707`、目标距离 `0px`，重复选择通过。

## F10：分享事件冒泡及摘录变化

分享入口和 portal 阻止阅读翻页事件；打开时冻结文本及标题/角色/楼层，保留用户编辑。
每次弹窗使用独立会话序号，旧图片生成或原生分享完成后不能关闭新弹窗。
`reader-view-share.test.tsx` 覆盖摘录/元数据、pointer/touch/click、真实 ReaderView 不翻页，
另有两项关闭重开后的延迟回调 RED/GREEN。最终通过；原生分享调用使用 mock，真机未验收。

## F11：宽屏返回关闭顺序错误

`useReaderBack` 的注册与视口宽度分离，以 ref 更新回调，避免重新注册后越过弹层。
embedded 阅读器不抢路由返回，沉浸外壳锁保持独立。
`reader-back`、`back-button`、`reader-view-keyboard` 等回归通过；R4 首轮分享/返回共 6 项失败。
Android 系统返回事件的窄/宽屏设备验收仍待执行。

## F12：阅读包解压无界与取消失效

使用 fflate 流式 Unzip，每 4KiB 输入计数，限制压缩体积、条目数、单条、总展开量和 JSON。
校验路径、目录结构、压缩格式、CRC 和声明/实际大小。Worker 请求独立拥有 buffer，
取消/失败/关闭/切换请求时终止并释放，UI 不保存模块级大缓存。
解压首轮 30 项失败、Worker 客户端缺模块、dialog 首轮 7 项失败，修复后全部通过。
真实 Edge Worker 解析合成包通过；大包设备峰值内存未验收。具体预算见 P 执行记录。

## F13：批量移动立绘产生部分状态

批量移动深克隆记录，先完成所有副本准备，再提交整个 patch，最后按 journal allow-list 清理。
`portrait-mutation.test.ts` 覆盖第二次临时写/rename 失败、档案失败、共享旧文件、篡改日志，
以及 journal/两次临时写/两次最终文件/metadata/committed 七个重启点和重复恢复。
原故障见审查 F13，新增回归和最终全量通过；真实 Tauri 中断恢复仍未验收。

## F14：附件删除失败却移除记录

物理删除失败保留记录并返回结构化错误；文件已删除但元数据写失败时明确报告部分结果，
允许用户再执行仅移除记录。目录、链接、权限、缺失及异常 IO 均有回归。
`attachment-safety.test.ts`、`tauri-fs-mutation.test.ts` 最终通过。
真实回收站行为没有通过 mock 或单元测试宣称已验收。

## F15：替换后仍使用旧内嵌图

文件库替换移除旧 `dataBase64`，内嵌路径更新数据；缩略图按新内容源重新加载，
已打开的大图在持久化成功后刷新，晚到刷新不覆盖用户关闭/切换。
`portrait-mutation.test.ts` 和 `portrait-lazy-load.test.tsx` 覆盖新图可读及失败时旧图保留。
最终全量通过；该修复沿用现有展示界面。

## F16：原生单文件操作允许目录或链接

remove/trash 共用普通文件检查，校验全部祖先的链接/reparse 属性，结构化保留 IO 错误类别。
操作计数器证明目录、越界、junction 和非 symlink reparse 祖先不会进入实际删除操作。
Rust 正常套件 42 通过、1 ignored；单独执行
`cargo test --offline --manifest-path src-tauri/Cargo.toml --lib file_mutations_reject_file_and_ancestor_links -- --ignored`
退出 1，创建符号链接夹具时报系统错误 1314。该项必须在具备符号链接权限的机器补验。

## S1：ST 导入 WIP 独立验证

| 独立编号 | 修复 |
| --- | --- |
| WIP-01 | 导入捕获目标 repositories，切库后后续单元停止，已写入项保留在原库 |
| WIP-02 | 卸载/切库使旧回调失效，临时来源在正在执行的导入结束后清理 |
| WIP-03 | 准备调用串行并等待 cancel IPC，原生独占准备且不在 picker 之后重置取消 |
| WIP-04 | 临时目录删除成功后才撤销授权；失败报告可见，下一次准备前重试清理 |

保留原有的解压/扫描/导入进度、取消、部分结果汇报和临时来源处理。
导入开始时捕获目标 repositories，进行中的单元只落原库；切库/取消后不再开始下一单元。
组件卸载和切库使旧进度、结果和 finally 失效，正在读取的临时来源等导入结束再清理。

本轮追加 6 项前端 RED/GREEN：准备调用串行、等待旧 cancel IPC 完成后重试、预取消
不打开 picker、失败清理在下一轮重试、并发清理共享同一 promise，以及切库后清理失败可见。
其中第一轮为 3 项失败，第二轮为 2 项失败；最后补充原生清理失败在卸载后仍可见，1 项 RED/GREEN。
相关 2 个文件最终 12 项通过。原生失败标识 `STE_ST_IMPORT_CLEANUP_FAILED:` 保留路径和原因，
即使旧准备的 UI 已失效，也显示清理错误。解压半途且原生清理失败的目录需按错误路径处理；
已成功准备、随后清理失败的目录则保留授权，并在下一次准备前重试。
Rust 增加准备独占、取消后重试不继承标记、取消仍暴露清理失败、删除失败保留临时目录授权等检查。
S1 全部测试包含在最终 1581 项前端和 42 项原生结果中；文件选择与设备取消体验未手动验收。

## 浏览器与产物

Edge headless，隔离上下文；桌面 1440x1000 / 1280x820，移动 390x844。
脚本位于 `scripts/smoke/maintenance-{reader,editors,service-worker}.mjs`，
阅读器夹具是 `scripts/smoke/maintenance-reader.html`。Playwright 来自本机 Codex runtime，
没有作为新依赖加入项目。运行时设置 `NODE_PATH` 到该 runtime 的 `dependencies/node/node_modules`。

最后截图目录：`C:/Users/yicha/AppData/Local/Temp/ste-maintenance-reader-1788797227099`。
移动截图确认正文和工具栏布局，桌面截图确认跨页重排。浏览器运行无 pageerror。
SW 脚本使用候选生产预览，验证用户接受前旧 worker 保持控制、激活后移除旧缓存、
联网 HTML 与离线缓存响应相同。

Windows 产物（未安装）：

- `src-tauri/target/release/STE.exe`，SHA-256 `8F52E38C5C7FA1F7C53440DFD9AB71C7690CD299BB4F396521140193BAFB133B`。
- `src-tauri/target/release/bundle/nsis/ST Explorer_0.9.1_x64-setup.exe`，SHA-256 `FA46FADEF1F2B0D4ACED3C5C8510A6D9CCA9AED59B6E44665299057EFB961F6D`。

Android 在候选的 `android` 目录尝试 `./gradlew.bat assembleDebug --console=plain`。
本机无 `ANDROID_HOME` / `ANDROID_SDK_ROOT`，默认 SDK 目录不存在，PATH 无 adb。
默认 Java 为 25，另有 JDK 17；Gradle wrapper 首次下载未完成，在确认 SDK 缺失后停止，
该命令退出 1，未生成 APK。不能把 `cap sync` 成功当作 APK 或真机通过。

## 剩余工作

1. 在具备 Windows symlink 权限的环境重跑明确标出的 ignored 用例。
2. 用隔离合成库验收 Tauri 安装/升级、原生外开/回收站及故障恢复。
3. 配置 Android SDK、相容 JDK 和设备后构建/安装 debug APK，检查返回、分享、旋转、滚动和内存。
