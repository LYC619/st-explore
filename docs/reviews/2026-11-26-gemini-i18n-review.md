# Gemini 国际化与公开交付审查及修复收口记录

日期：2026-11-26；基线：`refactor/ux-and-polish` / `058308a5fd87`；状态：**去过度防御清理与 `F1–F7` 全部修复已由 Antigravity 完成并通过验证**。

---

## 一、已拍板决定与已完成的去过度防御清理（严禁回退！）

### 1. 用户已拍板决定
1. **核心术语统一**：
   - 「世界书」在应用界面、公开介绍站与英文文档中统一使用 **`Lorebook`**（复数 `lorebooks`）。
   - 预设状态「备用」由易与数据备份混淆的 `Backup` 改为 **`Standby`**（含 `"备用": "Standby"`、`"状态/备用": "Status/Standby"`）。
   - 编辑器 `/beautify`「美化」（状态栏、悬浮窗与 MVU 变量）由与阅读器/列表「外观 (`Appearance`)」撞名的 `Appearance` 改为 **`Chat styling`**。
2. **`?lang=` 深链持久化**：
   - 从公开介绍页点击进入工作台（如 `/?lang=en` 或 `/?lang=zh-CN`）时，初始化阶段即将合法的 `lang` 写入 `localStorage`（`ste-language`），避免用户切路由、刷新页面或打开独立酒馆子窗口时跳回旧语言。

### 2. 已由 Gemini 直接完成的去过度防御清理（Codex 修复期间禁止改回！）
以下文件已完成去过度防御与免责套话瘦身，并通过 23/23 宿主脚本测试、`tsc`、`eslint` 与 `version:check`，**请直接基于当前工作区继续，不得恢复被删掉的冗余限制或免责声明**：
- `compose.yaml` & `Dockerfile`：`STE_SITE_URL` 改为可选（`${STE_SITE_URL:-}`），支持 `docker compose up --build -d` 零环境变量直起。
- `scripts/deploy/prepare.mjs` & `scripts/site/build.mjs` & `scripts/site/build.test.mjs`：`--site-url` 改为可选（未传时输出 `noindex` 本地/内网包，不强迫填写假 URL）；放行局域网/Tailscale HTTP 地址（如 `http://192.168.x.x:8080/`）；删除对自身生成目录 `dist/`、`site-dist/` 的符号链接偏执检查、重复参数校验、`published: false`、公开 `deployment.json` 中的本地 `dirtyFiles` / `inputPaths` 列表及 `"Nothing has been built or uploaded"` 等免责套话；修正页脚双重标点。
- `scripts/verify.mjs`：撤除 `vitest` 上误加的 `--maxWorkers=1` 限速（沿用 `vitest.config.ts` 的 `maxWorkers: 2`；Windows 下 `node --test` 保留 `--test-concurrency=1` 以规避 Node IPC 反序列化缺陷）。
- `scripts/build-info.mjs`：从 `BUILD_INPUT_PATHS` 移除不影响前端 bundle 与桌面 `.exe` 的 `Dockerfile`、`nginx.conf`、`compose.yaml`、`scripts/site`、`scripts/deploy`。
- `src/components/AppErrorBoundary.tsx`：移除 `<details>` 内多余的免责说教句 `为保护资料，不显示可能包含正文的原始错误消息。`（修复 `en.json` 时同步删掉该孤儿键）。
- `scripts/site/content.mjs`、`README.md`、`README.zh-CN.md`、`docs/USAGE*.md`、`docs/DEPLOYMENT*.md`、`docs/I18N*.md`、`CONTRIBUTING.md`、`SUPPORT.md`、`SECURITY.md`、`.github/ISSUE_TEMPLATE/bug_report.yml`：已清除“本次国际化没有经过 Android 真机验证”“不承诺响应时限”“不能证明……”等防御性套话，并已将英文文档统一为 `Lorebook` 与真实英文界面路径（`Interface language`、`Characters`、`AI settings`、`Continue chatting`、`Data & backups`、`About & guides`）。

### 3. Codex 执行红线（反过度防御）
- **禁止**在源码、CLI 输出、README、公开页面、`CURRENT.md` 或 `.user/` 中新增“不能替代真实测试”“仅在核实范围内”“不承诺……”“未执行上传”等防御性免责套话。
- **禁止**对应用自身刚创建的临时路径/常量路径做多余的二次 `path.resolve` 相等性断言或符号链接拦截，保持代码直白精炼。

---

## 二、待执行修复清单（`F1–F7`）

### F1 · P1：修复持久化数据污染与标签管理失灵

1. **`src/components/library/review/ReviewStoryList.tsx`（第 31–32 行）**：
   - 现状缺陷：`<option key={value}>{value}</option>` 未传固定中文 `value`，且用 `e.target.value as StoryStatus` 绕过类型检查，导致英文界面下已有故事状态全部错显为 `"Not started"`，点保存会把英文 `"Completed"` / `"In progress"` 直接写进文件库 `故事.json` 或 IndexedDB；第 31 行 `{savedStatus}` 也未翻译。
   - 修复要求：改用 `STORY_STATUSES`（来自 `@/lib/archive-db`）渲染 `<option key={raw} value={raw}>{tr(raw)}</option>`，并将第 31 行改为 `{tr(savedStatus)}`。
   - 验证：新增真实组件单测，在英文界面下打开 `'进行中'` 故事、切换为 `"Completed"` 并点击保存，断言 `updateArchiveStory` 写入值为 `'已完结'`。

2. **`src/pages/Library.tsx`（第 615–619、643、841 行）与 `src/components/library/TagManagerDialog.tsx`（第 593、596–597 行）**：
   - 现状缺陷：
     - `Library.tsx:643` 传了 `setTagManagerCategory(tr("人物"))`，`:841` 传了 `setTagManagerCategory(tr("类型"))`，英文下传入 `"Character"` / `"Type"` 导致 `TagManagerDialog:128` 校验失败并跳错分类，批量栏 **Type** 按钮失灵；
     - `TagManagerDialog:596` 用 `checked={chatVisible.has(tr("类型/{{v0}}", { v0: type }))}`（即 `"Type/人物"`）查询存有 `'类型/人物'` 的集合，导致英文下 5 个角色类型的「在聊天中显示」开关永远显示未开启且无法关闭；
     - `Library.tsx:617` 筛选栏 `label: type` 与 `TagManagerDialog:593` `<span className="font-medium">{type}</span>` 未翻译，与右侧网格按类型分组的英文标题割裂。
   - 修复要求：
     - `Library.tsx:643` 改为 `setTagManagerCategory('人物')`，`:841` 改为 `setTagManagerCategory('类型')`；
     - `TagManagerDialog.tsx:596` 改为 `checked={chatVisible.has(\`类型/${type}\`)}`（同时把 `aria-label` 中的 `type` 显示名合理本地化）；
     - `Library.tsx:617` 改为 `label: tr(type)`，`TagManagerDialog.tsx:593` 与 `:637` 显示处改为 `tr(type)` / `tr(assignmentType)`。
   - 验证：补充英文模式组件单测，验证点批量栏 `Type` 能定位到类型页，且类型的「Show in chat」开关能正常显示开启态并切换为关闭。

---

### F2 · P2：修复预设导出路径受语言污染及编辑器假脏态

1. **`src/lib/preset-package.ts`（第 17–19、249–250、277、286–287、325 行及抛错文案）**：
   - 现状缺陷：`PACKAGE_KIND_LABELS` 改为 `tr(...)` 后，`buildPresetExportFiles` 用它拼接取用包内文件路径 `附带/${PACKAGE_KIND_LABELS[file.kind]}/${name}` 并参与 `sha256` 目录摘要计算，导致英文界面导出产生 `附带/Regex/...` 混杂目录且在 `导出/预设/` 下重复建文件夹；此外导出返回提示与多处 `throw new Error(...)` 仍为裸中文。
   - 修复要求：包内归档相对路径固定使用与界面语言无关的稳定目录名，`PACKAGE_KIND_LABELS` 仅用于界面展示；将导出结果提示与用户可见错误接入 `tr()`。补充中英文导出 `buildPresetExportFiles` 结果一致的单测。

2. **`src/pages/Preset.tsx`（第 106–107 行）**：
   - 现状缺陷：`isDirty` 左侧使用 `tr("未命名预设")`，右侧使用 `'未命名预设'`，英文下空标题时未修改即误判 `isDirty = true`。
   - 修复要求：两侧统一使用固定内部回退值 `'未命名预设'` 比较脏状态。

---

### F3 · P2：修复语言持久化、模块顶层提前求值、`React.memo` 漏订与异步缓存固化

1. **`src/lib/i18n/index.ts`（第 20–27、61–67 行）**：
   - 当 URL 查询参数 `?lang=` 解析出合法 `Locale` 时，在 `initialLocale()` 内同步写入 `localStorage.setItem(LOCALE_STORAGE_KEY, requested)`（`try/catch` 兜住无存储环境）；
   - 跨窗口 `storage` 事件回调触发 `setLocale(..., false)` 时，若当前窗口 URL 自身带有 `?lang=` 参数，同步 `history.replaceState` 更新该参数，避免刷新回退；补充单测覆盖。
2. **消除模块顶层提前读取 getter**：
   - `src/pages/Home.tsx:105–111`（`EDIT_TOOLS`）与 `src/pages/Tools.tsx:48–67`（`FOCUS_COPY`）：将所有 `description: EDITOR_TOOL_COPY.xxx` 改为 `get description() { return EDITOR_TOOL_COPY.xxx; }`。
3. **补齐组件语言订阅**：
   - `src/components/chat/ChatPreview.tsx:60`（`React.memo` 组件）与 `src/components/preset/PresetRoleBadge.tsx:7`（`RoleBadge`）补调 `useI18n()`。
4. **消除异步 state 固化旧语言字符串**：
   - `src/components/GlobalSettings.tsx:81–142`（存储明细随语言重算或改为存数值在渲染层 `tr()`）；
   - `src/pages/Tools.tsx:103–118`（`AssetPickerItem` 存原始 `entryCount`，渲染层译出）；
   - `src/components/GlobalSearch.tsx:34–57` 与 `src/lib/global-search.ts:57`（`'未绑定'` 接入 `tr()`，切语言后显示更新）；
   - `src/lib/home-layout.ts:63–65`（`'未知角色'`、`'未绑定角色'` 接入 `tr()`）。

---

### F4 · P2：消除短词键碰撞、逐段拆译病句与术语不一致

将拆碎拼接的半截 `tr()` 统一收拢为完整句子插值 `tr('... {{v0}} ...', { v0 })`，并修正以下全部碰撞与粘连：

1. **消除 `"为 "` 错译污染**：重写 `src/components/worldbook/BatchOperations.tsx:162, 200, 244` 三处弹窗说明为完整插值句。
2. **拆分动作按钮与状态词**：
   - 将动作按钮上的 `"移除"`（`AssetPreviewSheet.tsx:197`、`PresetCatalogDetails.tsx:145`、`RuntimeSettingsPanel.tsx:347` 及 `CharacterHeader.tsx:364`）修正为动词 `"Remove"`，仅在 `VariableInspector.tsx:30` 差异状态处保留 `"Removed"`（可用明确短语或按上下文区分）；
   - 将阅读睡眠定时器与开关状态中的关闭档（`MobileReaderSettings.tsx:185`、`NovelTopBar.tsx:295`、`PresetContentInspector.tsx:133`、`PresetEmbeddedResources.tsx:87`）修正为 `"Off"` / 完整句，与关闭弹窗按钮 `"Close"` 解耦。
3. **拆分序号与量词碰撞**：
   - 世界沙盘步数（`WorldPlay.tsx:182, 191, 212, 213, 235`、`WorldIntelligencePanel.tsx:31`、`WorldMemoryConsole.tsx:38`）改为整句 `Step {{v0}}`（消除 `"Page 5 steps"` / `"#5 steps"`）；
   - 世界书分页（`EntryFilterBar.tsx:180`）改为整句 `Page {{v0}} / {{v1}}`；
   - 角色卡计数与批量导出（`Home.tsx:393`、`LibraryPager.tsx:25, 29`、`Library.tsx:781`、`LibraryImportDialog.tsx:107`、`TagManagerDialog.tsx:594`、`LibraryWebExportConfirmDialog.tsx:32, 38`）改为整句 `cards`（消除把角色卡叫作 `"images"`）；
   - 楼层跳转与范围（`StoryTreePreview.tsx:87`、`ChapterMarkerDialog.tsx:75`、`ReviewRecords.tsx:76`、`FloorRangePicker.tsx:83`、`MiniSummaryPanel.tsx:94, 99`、`PriorVolumesPanel.tsx:53`）改为整句（消除 `"Marker at message #12 messages"` / `"#5message"` / `"#1volume"`）。
4. **修复全部无空格粘连与双量词拼接**：
   - `PresetExport.tsx:83, 97, 115`（修复 `"selected groupenabled"`、全角括号及 `"ViewCompare changes"`）；
   - `StoryRecordsView.tsx:349` 与 `ReviewRecords.tsx:66`（修复 `"Generateon..."` / `"Add manuallyon..."`）；
   - `AssetPreviewSheet.tsx:120`（修复 `"itemsentries"`）；
   - `RegexTool.tsx:363`（修复 `"AsUsermessage preview"`）；
   - `AssetLibrary.tsx:466, 538`（修复 `"OpenLorebook editor"` 等按钮粘连）；
   - `Preset.tsx:619`（整理为通顺整句）；
   - 全仓排查所有形如 `{tr(...)}` 紧邻 `{tr(...)}` 或 `{expr}{tr(...)}` 在英文下缺少空格或语法不通的 JSX 片段并一并整句化。
5. **落实拍板术语与预设块展示去重**：
   - `src/lib/i18n/locales/en.json`：将预设整理状态 `"备用"` / `"状态/备用"` 改为 `"Standby"` / `"Status/Standby"`；将导航/编辑器中的 `"美化"`（`/beautify`）相关键改为 `"Chat styling"`；确认应用内「世界书」全部统一为 `Lorebook`；
   - `src/types/preset.ts:145–149`（`blockDisplayName`）：当翻译后的内置标记名与 `block.name || block.identifier` 忽略大小写一致（如英文下 `"Scenario"` 与 `"Scenario"`）时只显示单个名称，不再拼成 `"Scenario · Scenario"`。

---

### F5 · P2：补齐漏译模块、插值参数与全角标点，并升级 `scripts/i18n/check.mjs`

1. **补齐漏译的业务模块与 Hooks**：
   - `src/components/vault/VaultGate.tsx:91`：`{tr(NEWER_VAULT_MESSAGE)}` 并补入 `en.json`；
   - `src/lib/storage-utils.ts:44–63` 及全文件 `BackupError`：`STORE_SPECS` 展示标签改为 getter，`BackupError` 消息全部接入 `tr()`；
   - `src/components/character/useCharacterLoadoutBadges.ts:128–190`：内部调用 `useI18n()`，将全部装备微章 `title`、`value`、`hint` 接入 `tr()`；
   - `src/lib/other-asset-sections.ts` 与 `src/lib/vault/other-assets.ts`：翻译「其他资产」侧栏与 7 类归档标题/简介（注意 `summarizeOtherAssets` 展开对象时不要把 getter 固化成静态值，应在渲染时译出或保留 getter）；
   - `src/lib/vault/st-import-presentation.ts`：`IMPORT_POLICY_SUMMARY`、`buildImportResultStatus`、`buildImportManifestNotice` 全面接入 `tr()`；
   - `src/hooks/use-worldbook-entries.ts`、`src/hooks/use-worldbook-autosave.ts`、`src/hooks/use-batch-selection.ts`：所有 `toast` 与用户可见 `Error` 接入 `tr()`；
   - 补齐页面与组件内残留的 TS 中文提示与状态：含 `Home.tsx:500`、`Index.tsx:228, 343, 383, 408, 415`、`Roleplay.tsx:82, 355`、`AssetLibrary.tsx:281, 665–669`、`PresetCatalog.tsx:306`、`PresetDetail.tsx:69`、`Preset.tsx:179, 342`、`PromptEditor.tsx:179, 186`、`PresetContentInspector.tsx:133, 135, 143`、`PresetEmbeddedResources.tsx:87`、`CardViewer.tsx:238`、`WorldBookBatchBar.tsx:34, 53`、`RegexTool.tsx:181`、`GlobalSettings.tsx:152, 225`、`PresetVersionPicker.tsx:18`、`PresetCatalogDetails.tsx:212`、`PresetCollection.tsx:20`（注意 `PresetCatalog.tsx` 中做筛选键值的 `'未分类作者'` 保持原始值，仅在界面渲染处译出）、`AIFillDialog.tsx:205, 211, 224, 264`、`RecordWorkbench.tsx:333, 569`、`NovelPolishDialog.tsx:111`、`review-model.ts:38`、`PortraitCloudImport.tsx:84–92`、`tauri-fs.ts:160`、`vault-registry-runtime.ts:71, 91`、`reimport-merge.ts:63, 109–114`。
2. **修复全部向 `tr(key, { vN })` 传入裸中文实参的调用（28+ 处）**：
   - 如 `Library.tsx:306`、`CharacterPage.tsx:429`、`StoryWorkspace.tsx:488`、`WorldBook.tsx:503`、`PortraitSection.tsx:262`、`StoryRecordsView.tsx:287`、`CaptureRecordDialog.tsx:62`、`TagManagerDialog.tsx:358`、`RegexSidebar.tsx:177`、`QuickModelSwitcher.tsx:75`、`LibraryFilterRail.tsx:238`、`ManagedTagRow.tsx:77`、`RecentStoryBar.tsx:38` 等，确保插值参数本身已本地化或拆分为独立整句键。
3. **清理全角中文标点残留与英文列表 `'、'` 顿号**：
   - 修复全部 60 处 JSX 半英半中标点（如 `APIConfigCard.tsx:209` `“...」？`、`GreetingsSection.tsx:374` `(3）`、`Preset.tsx:680` `（3）` 等），整句收进 `tr()`；
   - 修复 `src/lib/llm/errors.ts:32` 的 `（...；...）`，英文下使用 ` (${details.join('; ')})`；
   - 在 `src/lib/i18n/index.ts` 提供简洁的 `formatList(items: readonly string[]): string`（中文 `items.join('、')`，英文 `items.join(', ')`），替换 `GlobalSettings.tsx:199`、`AssetSection.tsx:336, 344, 398`、`PresetPackageImport.tsx:175`、`AIFillDialog.tsx:259`、`STImportResultDialog.tsx:139`、`WorldIntelligencePanel.tsx:31`、`WorldPlay.tsx:234` 等展示处的硬编码 `join('、')`。
4. **升级 `scripts/i18n/check.mjs` 静态门禁并补充 `check.test.mjs` 用例**：
   - 检测 `JsxText` 中残留的全角中文标点 `[，。！？、“”‘’「」『』【】（）]`；
   - 检测 `tr(key, { ... })` 参数对象字面量中未包裹 `tr()` 的中文字符串/模板字面量；
   - 检测动态 `tr( literalUnion / constArray )` 之外未登记的翻译键，并清理 `en.json` 中重构后不再被引用的孤儿键（保持目录干净）。

---

### F6 · P2：修复 `nginx.conf` 安全响应头丢失与静态后缀覆盖

- **定位**：`nginx.conf`、`scripts/site/build.test.mjs`
- **修复要求**：
  1. 因 Nginx 子 `location` 一旦声明 `add_header` 就会丢弃 `server` 级 `add_header`，需保证 `/`, `/index.html`, `/about/`, `/sw.js`, `/assets/`, 静态后缀块及 `/sitemap.xml`、`/robots.txt` 的实际响应都带有 `X-Content-Type-Options: nosniff` 与 `Referrer-Policy: strict-origin-when-cross-origin`；
  2. 为 `location = /sitemap.xml` 与 `location = /robots.txt` 单独设置 `try_files $uri =404` 与 `Cache-Control "no-cache"`，**不加** `X-Robots-Tag: noindex, nofollow`；
  3. 静态资源 `=404` 正则补齐内嵌酒馆实际产出的 `mjs|webmanifest|mp3|ttf|less`；
  4. 在 `scripts/site/build.test.mjs` 增加测试：校验每个含 `add_header` 的非健康检查 `location` 均保留安全头，且 `dist/`（若存在）或已知酒馆静态后缀不会落入 `/index.html` 回退。

---

### F7 · P3：界面对齐、配置清理与收尾验证

1. **`src/components/settings/LanguagePicker.tsx`**：`compact` 模式下容器改为 `justify-end`（或合理对齐），修复在 `VaultGate` 居中卡片内孤立贴左的问题。
2. **根目录 `vercel.json`**：调整重写规则避开 `/about/` 与静态资源（或按项目当前部署方案清理），避免误导静态托管。
3. **验证与档案同步**：
   - 跑通 `npm run verify:web`（全量门禁）与生产浏览器 Playwright 用例（新增至少 1 条英文界面覆盖：通过 `/?lang=en` 进入 → 切路由刷新仍保持英文 → 角色库回顾页状态显示与保存不污染库数据 / 角色页装备微章为英文）；
   - 重新运行不带假域名的 `npm run deploy:prepare -- --target app` 与 `--target pages`（或保持测试在临时目录验证，避免在 `dist/` 留下 `http://localhost:8080/` 的 `index,follow` canonical）；
   - 按实际结果精炼更新 `docs/maintenance/CURRENT.md`（保持 `<= 12,000` 字节）与 `.user/03-当前进度与下一步.md`（运行 `.user/_web/template/generate.py --config .user/project-web.json --refresh`，严守 `.user/协作约定.md` 反防御红线）。
