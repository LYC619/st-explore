# 11月9日实测反馈修复与验证

Codex，2026-11-09。基线 `main / 73a6f461d4c2933cab5eb4b8a5a4c39323cda0af`，保留所有先前未提交内容。本轮仅本地主Agent实施；没有提交、推送、正式打包、真实模型调用或私密正文回传。测试使用合成库，不运行旧正式目录置换脚本。

## 五项反馈的结果

| 反馈 | 原因与本轮变化 | 已验证／限制 |
| --- | --- | --- |
| 删除慢、看不到回收内容 | 删除原已调用rename，移动前却通过IPC读取整份Base64再在JS校验。本轮增加Rust流式SHA256，64KiB缓冲区，只返回摘要；文件仍原字节移动。设置新增库内回收站，读清单显示原路径、时间、数量和恢复操作 | 原生20角色／40MiB附件移动约8.03秒，20份字节哈希全一致；4MiB校验IPC从5,592,408字符减为64字符。角色删除仍保留全库共享引用检查，未证明大型实库整体等待全部消除 |
| 删除聊天预设后重导失败 | 显式删除只清了presetMap，残留presetOwners／presetVersions，使同名再导被误判为旧编辑覆盖。成功删除后同时释放这两项 | MemFs先红后绿；内置ST真实文件导入→删除→重导同名→刷新保留通过。后台刷新／外部改名保护仍保留 |
| 同预设模型总结被拒 | 合成对照找出JSON Schema的value→schema及默认strict转换缺失、logprobs数量未转boolean＋top_logprobs；另修正response_format排除顺序 | 实际安装ST的CUSTOM后端代码与STE最终请求体，5组合成场景修正后全部一致。**未复现用户原始服务拒绝，不宣称总结拒绝已经解决** |
| 详情页直接编辑总结等 | 总结／日记卡片新增编辑标题、正文、预览；可展开修改卷号／分类／日记归属；保留故事、分支、楼层及生成参数。使用故事＋记录队列、库epoch及原记录比对 | 真实组件和独立Windows保存／刷新／磁盘回读／取消草稿通过；已被修改、移动、删除或切库的旧草稿不能覆盖。故事树仍沿原编辑路径，本轮不重做树编辑器 |
| 总结字体难读 | 仅记录阅读区采用系统无衬线、16px、1.85行距、76ch最大行宽、断行和主题正文色；增加可键盘操作的展开／收起 | 桌面和390px原生窗口已查看；编辑保存目标稳定布局44px。未宣称Android真机或用户阅读偏好验收通过 |

回收站路径为「设置 → 数据与备份 → 库内回收站」。它管理`.ste/retained`，不自动管理11月8日手工建立的`角色/回收站`。恢复预检全部文件，重名、缺失、内容变化或同身份冲突会停止；中途中断通过既有恢复日志完成剩余移动。兼容原有Base64／文本摘要清单。删除时解除绑定的故事、记录仍保持独立归属，不自动重新绑定。

## 请求差异的证据边界

`scripts/smoke/compare-summary-transport-20261109.mjs`读取本地安装ST的公开后端与消息转换源码快照，在VM执行真实`/generate`的CUSTOM路径，网络出口替换为本地捕获。STE使用实际`prepareCompletion`。全部输入为虚构航海记录、无用户预设／聊天／密钥，无服务请求。

修正前普通请求、strict处理、自定义YAML三组一致；schema与logprobs两组不一致。修正后五组一致，另有排除生成response_format的回归。参考源码SHA256：后端`43b70de92b41d0992a957589863b29c7342849e1201ae08c3c26cba6844cf052`，转换器`7c7f8dacbe45b27839c206eb2bd93c6b6a280aef0835a389e531123830fab230`。具体结果仅输出字段名和相等布尔值。

这不是完整前端／SPreset／扩展执行等价证明，也未验证媒体嵌入、schema flatten和所有provider路径。若用户复测仍拒绝，后续应由本机受控程序对比实际最终请求，仅向Agent返回字段差异类别、数量及服务状态；不得将真实请求、正文、截图或原始异常交给Agent。现有两处差异不能当作用户拒绝的既定根因，也不修改服务安全设置来掩盖拒绝。

## 验证与产物身份

- 修复前：同名预设重导、schema/logprobs/排除顺序均有失败回归。新增记录编辑测试先复现缺少编辑入口，再通过真实组件保存和重开。
- 针对性：最初10文件64项通过；provider两文件14项；最终主题与编辑／恢复相关6文件32项通过。
- 全量首跑：310文件中309通过，2515项通过、1项主题变量约定失败。改为项目`--text-primary`后，最终全量 **310文件／2516项全部通过**（114.09秒，4 workers）；日志`.cache/feedback1109/full-tests-final.log`。
- 应用TypeScript通过；变动TS/TSX定向ESLint通过；Smoke脚本不在ESLint范围，以实际执行检查。`git diff --check`通过（有既存换行提示）。
- Rust `cargo test --offline --lib fingerprint_streams_raw_bytes_and_survives_rename`通过，验证分块读取跨多个缓冲区及rename后字节摘要一致。
- 最后源码已编译独立Windows调试程序，内含生产Vite前端。identifier：`com.ste.explorer.feedback1109`；exe SHA256：`ebc69adcdde17af6b4cfc3f58fee4f6016d889a4ef78de46d0f9b8ebde1de136`。构建前核验identifier、固定独立Cargo目录，运行前核验receipt路径和exe哈希；只在该标识下写合成配置。
- 原生7组通过：摘要校验、总结编辑/预览/刷新/取消、总结与日记磁盘持久化、390px/44px、实际角色删除/回收/恢复/重开、ST预设实际重导/刷新、20角色40MiB批量移动核对。无pageerror，无真实生成。最终证据：`.cache/feedback1109/native/bac7c508-119e-427d-8e2e-a06ce756b7a8/result.json`。

4MiB原生调试版三轮：旧Base64读取传输191.5～203.1ms，新分块计算及摘要传输75.2～88.9ms。旧数值还不包含JS哈希；这是该步骤测量，不是完整删除加速比。批量从确认点击到确认框关闭8,028ms，包括实际移动与列表刷新；未做旧版同负载全流程对照。

原生Smoke早期出现合成记录前缀不符、按钮定位不符，以及在弹窗zoom-in动画未结束时测得42.83px。已修夹具／定位／稳定布局等待后最终7组通过，未把这些失败改写成产品回归。所有失败证据与最终结果同存本机忽略目录。正式程序、真实资料库、Android、安装器均不在这次验证范围。

## 配置恢复结论的纠正

04:00只读Win32句柄核验：账户DFQ\yicha，输入`C:\Users\yicha\AppData\Roaming\com.ste.explorer\config.json`，最终文件实际位于Codex包的`LocalCache\Roaming\com.ste.explorer`。因此此前“正式配置完整／已恢复”的声明不能证明用户双击程序使用的宿主文件恢复。已更正CURRENT、11月8日恢复／审查／打包记录及共享阅读档案。

本轮**没有写任何AI配置**，也未通过其他路径绕过重定向。保留新增连接，宿主桌面配置恢复仍未证实。无密钥的路径凭据位于`.cache/feedback1109/config-path-evidence.json`。S4扩展初始化、S5退出、Rust跨进程配置写竞争仍独立跟踪。

## 修改入口

数据层：`src/lib/vault/{fs,tauri-fs,file-maintenance,vault-backend}.ts`、`src-tauri/{Cargo.toml,Cargo.lock,src/lib.rs}`、`src/lib/summary-db.ts`、`src/lib/roleplay/{assets,provider}.ts`。

界面：`src/components/settings/RecycleBinPanel.tsx`、`src/components/GlobalSettings.tsx`、`src/components/DeleteConfirmDialog.tsx`、`src/components/summary/EditRecordDialog.tsx`、`src/components/character/StoryRecordsView.tsx`、`src/index.css`。本轮新增/补充的回归及Smoke脚本留在源码中，既有未提交修复未重置。正式0.9.9包不会自动包含上述更改，本轮未打正式安装／免安装包。
