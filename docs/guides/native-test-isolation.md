# 原生测试隔离

正式 `%APPDATA%/com.ste.explorer` 与 `%LOCALAPPDATA%/com.ste.explorer` 是用户数据，测试不得删除、移动或替换。先备份再还原仍会改变运行窗口的数据归属，不能作为隔离方案。正式安装／卸载测试应在独立操作系统账户或虚拟机执行。

历史入口 `scripts/smoke-tauri.cjs`、`scripts/smoke/archive/native-formal-20261105.ps1` 已停用，执行即失败，不再读取或写入正式数据。11月7日发布生命周期脚本及已确认的缓存目录置换脚本同样停用；原文以 `.disabled.txt` 保存于本机 `.cache/config-review-response-1108/retired-test-scripts/`，含 SHA256 清单。其他历史 `.cache/` 和 `release/` 脚本仅作为证据，不直接重跑。

## 当前隔离工具

1. `node scripts/smoke/build-isolated-native.mjs com.ste.explorer.regression`
2. 将输出的 receipt.json **实际绝对路径**设为 `STE_NATIVE_TEST_RECEIPT`。
3. `node scripts/smoke/verify-native-artifact.mjs com.ste.explorer.regression` 核对凭据。此命令只校验，不启动程序。

构建器固定独立 identifier，采用独立 Cargo 目标目录，不启动程序、不读取真实密钥。每次编译将 exe 复制到独立构建目录，并记录 identifier、路径、SHA256。运行器在任何测试写入或启动之前检查该凭据与 exe，拒绝正式 identifier、无凭据、路径不符和哈希不符。不能仅修改脚本中的目录名字，就运行来源不明的 `target/debug/STE.exe`。

实际原生回归必须另建合成库并使用固定响应，不需要真实用户密钥。旧连接与其他原生专项脚本已原样移入 `scripts/smoke/archive/`，不作为当前运行入口；本轮统一验证由收尾方案第13项登记。测试标识的 WebView/配置目录也要检查是否仍有测试进程占用；不得为获得“干净启动”删除正式目录。路径、凭据和端口核验失败时停止测试。

浏览器、jsdom/IPC 替身、Tauri 原生验证分别报告。源码测试通过不能表述成已安装程序修好；新源码未打包时，旧包仍有旧问题。

## 独立酒馆原生回归

核验新建测试包后，可运行 `scripts/smoke/run-native-detached-regression.ps1 -Identifier <独立标识> -Receipt <凭据绝对路径> -OutputDirectory .cache/verify/<本批目录>`。此入口在单独的 Windows 桌面启动测试，从不切换用户当前桌面；不直接运行 `.cache/` 中的历史脚本。输出目录变更时使用新的测试标识，避免复用其他批次配置。

正式驱动 `native-detached-regression.mjs` 只导入自产合成角色卡，验证原生子窗加载、帮助／过程弹窗时主阅读区滚轮、同步后关窗改名保存、带草稿收回和主窗退出。关闭验收同时检查页面 `closed` 与原生窗口列表，防止 WebView 已关而外壳残留。最终跟踪测试进程及其子进程退出。

WebView2 的新子窗 CDP 会话可能不可用，驱动通过主窗的同源窗口引用访问实际子窗；主阅读区使用真实 CDP 滚轮，子窗 Esc／遮罩使用 DOM 事件。该结果覆盖真实 WebView2 渲染、保存和窗口生命周期，不代替用户桌面的物理键盘焦点、拖动分屏或 Android 验收。报告保留就绪超时与调试连接失败，不能把这些尝试写成通过。
