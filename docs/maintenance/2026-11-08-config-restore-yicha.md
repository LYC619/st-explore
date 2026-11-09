# 2026-11-08：按用户授权恢复 yicha 的 AI 配置

> **2026-11-09 撤回“桌面正式配置已恢复”的结论。** 本轮只读核验用文件句柄解析最终路径，确认即使账户为 DFQ\yicha、输入为用户 Roaming 绝对路径，实际读取仍重定向到 `C:\Users\yicha\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming\com.ste.explorer\config.json`。此前11:59写回及12:00复核只能证明 Codex 文件视图中的副本，不能证明双击启动的 STE 已恢复。下面保留为历史操作记录，涉及“正式／恢复成功”的表述按本更正收窄。身份、环境变量、沙箱外执行和 GetCurrentPackageFullName 均不足以排除重定向。新凭据：`.cache/feedback1109/config-path-evidence.json`。本轮没有写任何连接配置；桌面配置恢复仍未验证，须保留用户新增连接后由可独立确认宿主文件视图的程序处理。

用户转来 Claude 的第二次审查并明确要求“你来恢复吧”。本轮只恢复指定 config.json、核对结果并更新交接，没有修改运行代码、重打包或启动 STE。

## 账户与文件视图核对

普通沙箱命令的 `whoami` 为 `dfq\codexsandboxoffline`，但 `APPDATA` 和 `USERPROFILE` 分别指向 `C:\Users\yicha\AppData\Roaming`、`C:\Users\yicha`。此前只凭环境变量路径与哈希，把该执行环境读到的文件称作用户正式配置，证据不充分；此前报告不能据此反驳 Claude 的实际用户读取结果。

本轮随后使用沙箱外命令，实际 `whoami` 为 **`dfq\yicha`**，WindowsIdentity 为 `DFQ\yicha`，系统 KnownFolder Roaming 与 APPDATA 均为 `C:\Users\yicha\AppData\Roaming`。直接读取绝对路径 **`C:\Users\yicha\AppData\Roaming\com.ste.explorer\config.json`**。文件及父目录未显示为链接，STE.exe 进程数为零。

这次沙箱内外均读到15,137字节、9个连接／8项带密钥、SHA256 `412b30612f722539b407bd6e5c57620138833a5f3fed6e64795c7af00422aca8`；写入前mtime为00:51:52。它与Claude报告的11:14时765字节／5c136521不一致。**本轮没有证明这段差异的原因，也没有证明文件虚拟化或哪位操作者恢复过；不要把推测写成结论。** 当前核对只证明这次工具调用的观测结果。

## 实际恢复与结果

1. 核对指定源 `.cache/config-review-response-1108/config-current-complete.json` 的SHA256为412b全文，内容9连接／8密钥、stRoot存在。
2. STE未运行时，将目标原样备份至 `.cache/config-restore-yicha-1108-115955-247f51/config-before-restore.json`，核对字节哈希。
3. 2026-11-08 **11:59:55 +08:00**，在目标同目录暂存已核验源，以 `File.Replace` 原子替换 config.json。额外保留同目录 `config.before-restore-30e6d5a985af427ea12d120ff1010969.bak`。没有移动／替换整个配置目录或 WebView 目录。
4. 目标写入后为15,137字节、9连接／8密钥、stRoot存在，SHA256完整匹配412b；mtime为11:59:55。恢复前内容已相同，这次是按授权重新写回，不声称本轮观察到765→15137的变化。
5. **12:00:27 +08:00** 再用独立沙箱外命令核验：账户DFQ\yicha、上述绝对路径、15,137字节、412b哈希，STE仍为零进程。

首个替换尝试因PowerShell把空备份参数传给File.Replace导致参数错误，未替换目标；暂存文件已清理、原备份保留。随后改为显式同目录备份路径，原子替换成功。成功回执（无密钥）位于 `.cache/config-restore-yicha-1108-115955-247f51/receipt.json`；含密钥的备份仅留本机忽略目录及用户配置目录，不进入提交或交付包。

## 下一步使用与范围

请使用11月8日config-review新包。酒馆里仍可能保存旧占位主模型ID，需用户明确重选真实连接；本轮没有代选或改写故事。完整备份里的ST演示库注册也随原文件保留。没有新增真实模型请求或程序界面验证；S4扩展等待、S5退出及Rust跨进程竞争继续由后续审查处理。

今后涉及桌面用户正式数据，应同时记录执行身份、系统KnownFolder、明确绝对路径及哈希，并在沙箱外核验；环境变量中的用户名不能替代实际身份和文件视图验证。
