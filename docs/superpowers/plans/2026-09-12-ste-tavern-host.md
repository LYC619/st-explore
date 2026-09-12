# STE 酒馆宿主与正文接入实施包

日期：2026-09-12。已获用户自主实施授权。依赖 `2026-09-12-ste-tavern-source.md` 锁定的真实上游；旧 P0 示例不再执行。

状态：已执行。本包保留实施时的契约与步骤，最终支持范围、结果和平台限制见[实现与验证记录](../../verification/ste-roleplay-runtime-v1.md)。

**目标：** 同源 frame 运行 TauriTavern 原始 ST 文档，父页面持有当前 STE 文件库、故事仓储与连接配置。上游 canonical chat[] 是编辑中的状态，`ArchiveStory` 是唯一持久化正文。原始入口、抽屉、预设、世界书、宏、正则和流式显示继续由上游负责。

## 1. 正文契约

- 新增 `src/lib/roleplay/live-chat.ts`：ST header/messages 与既有 `ChatSession` 的实时转换，保留未知元数据、空消息、系统消息、隐藏状态、候选和逐候选信息。
- `extra.ste_runtime.messageId` 保存现有 STE 消息 ID；额外保留 role 以区分隐藏消息与真正系统消息。生成或插件新插入的消息在实际 chat[] 序列化前补 ID。
- 不复用会过滤消息、重新生成 ID 的导入解析器。正文以 canonical content 为准，导出时同步 mes 与所选 swipe。
- 新增 `src/lib/roleplay/story-session.ts`：打开时捕获 Repo、storyId、branchId 和源会话版本；队列内使用 `updateArchiveStory` 合并最新故事，正文冲突拒绝覆盖。未涉及的评分、收藏、阅读进度和其他分支保留。
- 主线 ID 为 null；不存在的分支明确报错。持久化失败不推进已确认版本，允许原地重试；关闭后的迟到保存被拒绝。
- 新增契约测试：无损转换、ID/候选同步、空/隐藏/系统消息、重复 ID 拒绝、外部正文冲突、元数据并发、捕获库、不存在分支、失败重试、迟到保存。

## 2. 原始文档宿主

- 源码保持原件；使用明确的构建覆盖层接入 STE 的 `tauri-main.js`、`tauri-bridge.js` 和必要聊天传输边界。
- 原始入口 `/tavern.html` 通过父页面能力对象调用仓储。资源仍是实际同源文件，不能以 fetch 拦截代替模块、样式和图片服务。
- bootstrap 真实返回序列化 settings、角色、预设、world_names、themes 等上游 DTO。未支持的命令返回具体错误，不伪造成功。
- jQuery 同步 tokenizer 与 fetch 异步接口分别接入；token 估算不得冒充 Provider 的真实用量/缓存命中。
- 原始角色/聊天切换和 STE 路由均先等待编辑保存并取消前台生成。连接页绑定唯一 `api-profiles.ts`，不建立第二份密钥存储。

## 3. 生成与持久化边界

- 复用 ST 普通模式的最终请求与 StreamingProcessor。ST 生成 endpoint 转发到已捕获的 STE profile 完整 apiUrl。
- 真正的生成前失败通过请求/拦截器返回失败，不能依赖会吞异常的事件监听器。
- 回复写入既有 story 队列获得成功确认后，发出带故事/分支/消息/候选/修订的提交事件，供后续 Agent 记忆维护使用。
- 停止、请求失败、保存失败、切换库和分支都需要明确状态；不得把显示过的文字误报为已保存。

## 4. 验证与交付范围

先以真实 repository 契约测试正文层，再用真实上游文档浏览器测试 bootstrap、选择故事、编辑/swipe、生成、取消与重新打开。确定性本地 Provider fixture 用于流协议和请求检查；外部 Provider 的实测另行记录，不从 fixture 推断服务端缓存率。桌面与 Web/Android 支持分别记录。

此包完成只表示宿主与普通生成基础完成；自动工具 Agent、文件记忆及柏宝书兼容仍属于同一已授权 goal，必须继续实现并验证。
