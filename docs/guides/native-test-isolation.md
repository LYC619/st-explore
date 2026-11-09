# 原生测试隔离

正式 `%APPDATA%/com.ste.explorer` 与 `%LOCALAPPDATA%/com.ste.explorer` 是用户数据，测试不得删除、移动或替换。先备份再还原仍会改变运行窗口的数据归属，不能作为隔离方案。正式安装／卸载测试应在独立操作系统账户或虚拟机执行。

历史入口 `scripts/smoke-tauri.cjs`、`scripts/smoke/native-formal-20261105.ps1` 已停用，执行即失败，不再读取或写入正式数据。11月7日发布生命周期脚本及已确认的缓存目录置换脚本同样停用；原文以 `.disabled.txt` 保存于本机 `.cache/config-review-response-1108/retired-test-scripts/`，含 SHA256 清单。其他历史 `.cache/` 和 `release/` 脚本仅作为证据，不直接重跑。

## 当前连接回归

1. `node scripts/smoke/build-isolated-native.mjs com.ste.explorer.chat1107`
2. 将输出的 receipt.json **实际绝对路径**设为 `STE_NATIVE_TEST_RECEIPT`。
3. `node scripts/smoke/playtest-20261107-connection-native.mjs`

构建器固定独立 identifier，采用独立 Cargo 目标目录，不启动程序、不读取真实密钥。每次编译将 exe 复制到独立构建目录，并记录 identifier、路径、SHA256。运行器在任何测试写入或启动之前检查该凭据与 exe，拒绝正式 identifier、无凭据、路径不符和哈希不符。不能仅修改脚本中的目录名字，就运行来源不明的 `target/debug/STE.exe`。

连接回归使用合成库和本地无服务地址，不需要真实用户密钥。测试标识的 WebView/配置目录也要检查是否仍有测试进程占用；不得为获得“干净启动”删除正式目录。路径、凭据和端口核验失败时停止测试。

浏览器、jsdom/IPC 替身、Tauri 原生验证分别报告。源码测试通过不能表述成已安装程序修好；新源码未打包时，旧包仍有旧问题。
