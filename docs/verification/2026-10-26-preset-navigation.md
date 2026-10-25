# 2026-10-26 独立预设库导航整合

执行：Codex 子 Agent `global_consistency`，接续主 Agent 已添加的 `/presets` 页面、一级入口和首页入口。预设库正文、详情及同页未保存保护由主 Agent 维护；此记录说明相关导航的一致性与验证边界。

## 原问题与完成内容

预设库从附属库独立后，旧容器和旧选择页仍可进入，搜索直接落到编辑器；`/presets` 还会被 `startsWith('/preset')` 误判为编辑器，出现不相关的窄工具栏。现在：

- 桌面与移动端共用六个一级区域：首页、聊天、角色库、预设库、编辑区、附属库。预设库在角色库之后。
- `/assets?tab=preset&presetId=...` 转到 `/presets?presetId=...`；`/tools?focus=preset` 转到 `/presets?mode=select`。旧链接的 `assetId` 兼容转换成 `presetId`，其他上下文参数保留；使用替换历史的跳转，返回不会困在旧容器。
- 旧入口在挂载旧页面内容前跳转，不再重复加载附属资产或显示“附属库／打开预设工具”上级区域。附属库删除预设子类别、计数、读取订阅、删除分支和内嵌 Catalog，保留世界书、正则及其他资产。
- 首页编辑入口、全局编辑区子项和编辑窄栏的预设入口均去 `/presets?mode=select`；首页预设库与一级主导航均去 `/presets`。
- 搜索命中预设时打开 `/presets?presetId=...` 的资料详情，ID 经 URL 编码。连续搜索不同预设也同步切换详情（主 Agent 配套修复同路由参数监听及未保存保护）。
- `/presets` 属于预设库，只高亮自己的主导航，不显示编辑窄栏。真正 `/preset` 编辑器继续归编辑区；角色关联资产的“处理”保留 `assetId` 和 `characterId`，未改变其角色上下文写时复制路径。
- 路由前缀统一按完整路径段匹配；桌面主区域、子项和编辑窄栏不再分别猜测区域。移动底栏继续从 `NAV_AREAS` 渲染，无第二份菜单列表。
- `docs/ui-conventions.md`、移动导航注释及路由 smoke 清单同步新结构；旧入口留在 smoke 清单中验证兼容。

## 检查与证据

自动化定向测试：

- 9 文件、81 项通过：`mobile-nav`、`ux-maintenance-models`、`app-layout-navigation`、`editor-asset-picker`、`asset-library-rail`、`home-editor-entries`、`global-search`、`asset-index-performance`、`worldbook-library-import`。
- 补查 4 文件、25 项通过：`editor-mode-restoration`、`loading-and-failure-visibility`、`story-selector-performance`、`smoke-fixture`。
- 覆盖旧链接跳转和选中参数、桌面唯一高亮、移动主入口、首页／侧栏落点一致、附属库剩余类别切换与导入、资产列表不克隆预设正文、故事选择器加载／失败及原有性能约束。
- 导航修改文件定向 ESLint 通过，`git diff --check` 通过。测试日志仅有项目现存的工具升级／React Router future flag 提示，测试未失败。

真实浏览器：`node scripts/smoke/preset-navigation.mjs`，Edge headless，真实 App、独立 MemFs 合成库（两份预设、一张角色卡、一篇故事），禁止外部 HTTPS 请求，不读写用户真实预设或文件库。

1. 旧附属库深链跳转新库并显示指定预设；只高亮预设库，无编辑窄栏与旧上级按钮。
2. 旧 Tools 入口跳转选择模式并显示指定预设。
3. 实际角色详情 → 关联资产 → 处理，进入带角色上下文的预设编辑器；编辑窄栏返回新库选择模式。
4. 同一个 `/presets` 页面通过全局搜索先后选择两份预设，URL 与详情均同步。
5. 390 × 844 视口从角色库底栏切回预设库，六个主入口可点击，只有预设库高亮；截图已目检，无横向溢出到主导航之外。

以上全部通过，`pageerror` 为 0。初次脚本把“关联资产”标签当成普通按钮，查看真实页面及 TabsTrigger 角色后改为 `getByRole('tab')`，未为适配测试改产品交互。

本地证据：`.local/verification/2026-10-26-global-ui/` 内 `navigation-tests.log`、`navigation-extra-tests.log`、`navigation-lint.log`、`navigation-browser.log`；`.cache/preset-navigation/results.json` 与 `mobile.png`。

## 范围与后续验收

本子任务没有运行全量测试、完整构建、Tauri 便携包或 Android 安装包，也未提交或推送。手机验证是 Edge 的 390px 视口，不能等同 Android 原生安装验证。完整批次测试、打包、提交和档案汇总由主任务统一处理。

用户视角检查：收藏管理、选择编辑与角色已选资产处理现在有清晰、可返回的落点；从旧链接、搜索、首页或不同屏幕进入时不再出现旧附属库容器。手机六项底栏在 390px 下文字和图标可辨识。仍需把实际便携包操作作为最终用户验收，尤其是资源导入和文件管理器定位，这两项不属于纯导航 smoke。

## 关联补查：搜索管理资料

后续审计发现，搜索落点虽然已进入新库，匹配仍只读预设标题，按作者或模型找不到列表中已有的预设资料。现已让 `BuildInput.presets` 接受列表的 `catalog` 和 `presetIdentity` 轻量摘要，复用 `getPresetPresentation`，可匹配作者、有效模型、确认或推断系列、版本、用途、变体、标签、代表角色及有界备注摘要；已确认的模型覆盖推断值，不把失效的模型推断混回结果。结果补充作者／版本／模型，副信息限制宽度，避免长元数据挤掉标题。

没有新增完整预设读取：GlobalSearch 继续使用 `listAssetIndex`，搜索模型只接受摘要，不读取提示词、脚本和正则正文。保留现有后端行为：文件库写入会失效缓存，重建索引后搜索复用投影；IDB 的既有 `listLight` 实现边界没有在本子任务中扩改。

补修后 2 文件、17 项测试通过（`global-search`、`asset-index-performance`），其中真实 GlobalSearch + MemFs 测试覆盖按管理资料检索、`幻_境 v2.0` 推断为 `幻 境` 的系列检索、确认模型覆盖推断模型、Enter 打开选中预设；暖索引状态下额外正文读取与正文克隆均为 0。定向 lint 通过。导航浏览器 smoke 全量重跑通过，并新增作者／模型检索，两种查询均找到正确的两份预设，0 `pageerror`。对应日志为 `search-metadata-tests.log`、`search-metadata-lint.log`，浏览器 `results.json` 更新为六条通过。
