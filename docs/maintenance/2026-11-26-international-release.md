# 国际化与公开产品交付

日期：2026-11-26；执行：Codex；并发：1。

## 目标与边界

用户授权完成 i18n、SEO、使用文档及部署脚本，使项目具备 GitHub / 海外社区交付条件。默认支持简体中文、英文；不改变现有产品入口与导航。当前基线 `refactor/ux-and-polish` / `058308a`，开始时工作区干净。沿用当前仓库，不创建代理、不推送、不发布、不接触真实资料库。运行验证仅使用合成数据。

## 执行顺序与验收

1. 盘点显示文案、设置入口、服务工作线程、静态部署及现有发布脚本。
2. 建立本地语言资源、语言选择及回退、插值与日期格式支持；迁移产品显示文案，避免改动用户内容、来源格式、模型提示词与持久化标识。验证切换/刷新/导航、弹窗和空状态。
3. 提供独立中英文静态产品介绍与帮助页，包含标题、描述、分享元信息、语言互链、canonical、站点地图。私人工作区 noindex；默认应用入口保持不变。公开地址由构建参数提供。
4. 整理中英文 README、入门/部署/贡献/翻译说明、社区问题模板；提供可校验的 Web 部署产物、Docker 配置与手动触发 Pages 工作流。
5. 运行目录完整性、类型/lint、相关单测、完整 Web 验证与浏览器中英文流程；如无原生代码改动则不启动正式原生程序。
6. 更新 CURRENT、执行证据及共享用户阅读档案。区分实现、验证、打包、用户验收与线上发布。

## 进度

- 已核对仓库、HEAD、干净工作区及现行隐私/原生隔离约定。
- 国际化、公开页面、文档及部署实现已完成，最终 Web 验证通过，共享阅读档案同步。应用仍为 0.9.9；未提交、推送、生成原生安装包或上线。

## 本批实现

- `src/lib/i18n/`：简体中文原文键与英文目录，语言识别/回退、单次插值、偏好保存、跨窗口同步、日期数字格式。设置显示页及桌面首次选库/修复页提供语言选择；更新 `<html lang>`、标题与中英文 PWA 安装说明。不会重挂编辑器。缓存的显示计算订阅语言，资料计算保持原依赖。
- 页面、组件及共享显示标签接入翻译。目录检查覆盖 4,468 条英文消息和 5,771 个翻译调用，验证固定键、占位符与直接 JSX 文案。AI 分类错误、SW 更新提示、构建信息已接入。中文稳定枚举、标签路径、用户内容、内置提示词、示例/世界叙事保留；内嵌酒馆仍使用其自己的语言设置。自动检查不等于所有动态诊断百分之百译完。
- `scripts/site/`：中英文介绍和指南，静态 HTML、语言互链、canonical、分享信息、结构化数据、站点地图。独立站支持子路径；完整 app 的公开页面在 `/about/`，工作台 `noindex`。未指定真实网址的预览不虚构 canonical、不允许索引。
- `scripts/deploy/prepare.mjs`：先验证网址/目标，再构建；输出部署清单和 SHA256。完整 app 只接受站点根路径，Pages 仅发布介绍/文档。Docker/Compose 与 nginx 缓存/路由配置更新，新增手动 Pages 工作流。无上传或云端执行。
- 中英文 README、USAGE、DEPLOYMENT、I18N；新增贡献、支持、安全反馈、第三方说明及双语问题模板；关于页增加文档入口。公开介绍没有使用真实库截图。

## 验证过程与问题定位

- 初期类型检查发现插值可选值及两处故事状态被用于显示翻译：修正类型并恢复原始状态值；补查角色类型标签删除判断，恢复保存路径。图床行名称校验也保留固定状态值。
- 补充缓存显示订阅时发现一处 helper 导入被一并移除、一处重复导入，已修正。缓存计算限于显示依赖，模板和资料解析不因切换语言刷新。
- 第一轮全量前端：339 文件中 337 通过，2 文件/9 用例失败，2,721 用例通过、1 跳过。失败均为现存源码形状断言仍匹配裸中文字符串；按实际 `tr()`/getter 写法更新，保留原断言目的。实际语言切换另由生产浏览器覆盖。
- 第一轮生产 Web 原有 7 条通过；公开站点桌面/390px 关闭 JavaScript 的 2 条通过。新 i18n 用例因误认为设置默认页是显示而失败，按实际默认 AI 页改成显式进入显示。跨窗口未保存草稿、合成角色卡导出不变已复验通过；移动用例同样补正入口。测试静态服务清理补上主动关闭连接。
- 中间部署演练生成 1,229 个 app 文件，记录源码 `058308a5fd87`、dirty:true、本机预览地址；最终产物及最终检查以本节后续结果为准。

## 最终验收与交付

完整 Web 检查 10/10 通过：版本一致性、23 宿主/部署脚本测试、i18n 检查、lint（0 错误、2 条原有 Fast Refresh 警告）、应用/工具类型、339 文件/2,730 前端用例（1 原有跳过）、64 酒馆来源测试、3 冒烟脚本测试、生产构建。证据：`.cache/verify/2026-11-25T17-54-35-813Z/results.json`。

最终生产浏览器 13/13 通过（23.2s）：原有中文 7 条、新 i18n 4 条、无 JavaScript 双语公开站 2 条。覆盖 390px、键盘真实焦点等待、跨窗口未保存表单、合成角色卡原文和宏/标签导出不变。证据：`.cache/verify/production-delivery.log`，图片 `i18n-mobile.png`、`public-site-1280.png`、`public-site-390.png`。Windows 下 Playwright CLI 自动管理 Vite 预览进程的收尾没有正常退出；最终使用 `.cache/verify/run-production.mjs` 显式启动与关闭同一个 Vite production preview，保留原用例/单 worker，命令退出码 0。此前将清理问题归于静态测试服务器不足以解释全部现象，此处更正。

最终部署演练：`dist/` 1,229 文件、`site-dist/` 12 文件的 SHA256 全部一致，app 构建身份与部署清单匹配。证据：`.cache/verify/delivery-hashes.log`、`deploy-app-final.log`、`deploy-pages-final.log`。最后产物使用本机预览地址 `http://localhost:8080/` 与 `http://localhost:8081/`，不是已发布网址。Pages 仓库子路径亦经单测及浏览器验证；实际发布应传真实 URL 或由手动工作流读取。源码 HEAD `058308a5fd87`、dirty:true、版本 0.9.9。未打原生包。

Compose、Pages 和 issue 模板 YAML 解析通过；公开文档内部链接检查通过；`git diff --check` 通过。nginx 只做配置检查，未伪称通过真实容器测试。

共享阅读档案使用随项目生成器。当前 Python 不含 markdown/bs4，通过授权下载到 `.cache/verify/reading-python` 后生成，不修改系统 Python 或安装后台任务。

验证目录使用 UTC 时间戳；用户日期按 Asia/Shanghai 为 2026-11-26。

边界：本机没有 Docker，未运行容器；未运行正式原生程序、未访问实际文件库、未做 Android 真机或真实模型请求。没有 GitHub Pages 线上发布、远端 CI、推送、标签或用户验收。

## 技术依据

- Google Search Central：Localized versions（独立语言 URL 与双向 hreflang）。
- Vite：Deploying a static site（生产产物与基础路径）。
- GitHub Docs：Using custom workflows with GitHub Pages（官方 Pages artifact / deploy actions）。
- 对外介绍不引用个人库或既有真实截图。

## 独立审查补修与最终收口（Antigravity）

- 按用户拍板由 Antigravity 接手完成 [独立审查单](../reviews/2026-11-26-gemini-i18n-review.md) 中的去过度防御清理与 `F1–F7` 全部修复：
  - 统一 `Lorebook`、预设 `Standby`、`/beautify` `Chat styling`；
  - 修复回顾页英文状态保存污染、角色库类型弹窗/聊天可见开关失灵、预设包导出目录受语言影响、`Preset.tsx` 空标题假脏态、`?lang=` 深链持久化、模块顶层提前求值、`React.memo` 漏订、短词碎句拼接与漏译模块，英文目录整理为 4,984 条词条 / 6,016 处调用；
  - 升级 `scripts/i18n/check.mjs` 静态门禁（拦截英文目录残留中文、JSX 全角标点、`tr()` 裸中文参数与模块顶层求值），补齐 `nginx.conf` 各 `location` 安全响应头与酒馆静态后缀，支持零配置 `docker compose up` 与内网 HTTP 地址。
- 复验结果：
  - `npm run verify:web` **10/10** 通过（340 文件 / 2,734 Vitest 用例通过、1 原有跳过，日志 `.cache/verify/2026-11-26T14-48-16-124Z/results.json`），Rust `cargo test --lib` 66 通过（1 原有忽略）+ `cargo clippy --lib -- -D warnings` + `npx cap sync android` 全部通过；
  - 生产浏览器 Playwright **14/14** 通过（24.1s，含新增 `/?lang=en` 深链跨路由/刷新保持英文用例，日志 `.cache/verify/production-gemini-final.log`）；
  - 内嵌酒馆与分屏续聊 Playwright **62/62** 通过（1 项原有跳过；顺手补齐 `draft-recovery.ts` 打开故事加载恢复草稿期间快速输入的防冲掉保护、`NewChatPickerDialog.tsx` 中文按钮无空格键名及 `organizing-tags.spec.ts` `.popup-button-ok` 选择器）；
  - 无域名本地构建演练生成干净 `noindex` 产物：`dist/` 1,229 文件、`site-dist/` 12 文件，`git diff --check` 无空白或冲突异常。
- 提交、打包与合并交付：
  - 干净提交源码批次 `ba7b570b4e6fd062c58ae7b9e2a4c3310c54d02a`（`dirty: false`）；
  - 打出免安装便携包 [2026-11-26-i18n-and-delivery](../../release/2026-11-26-i18n-and-delivery/使用与体验更新.md)：`STE-0.9.9-2026-11-26-i18n-and-delivery-portable.exe`（`37948416` 字节，SHA256 `7e14632ad2ffeaa86d6f809163a940c99694daefe7bfffa201139fc43ff767ac`，`packaged-not-run`）；
  - 快进合并 `refactor/ux-and-polish` 回 `main` 并推送 `origin/main` 触发远端 CI。版本仍为 `0.9.9`，未打 `v*` 标签、未发布公开介绍站；无 Docker 守护进程与 Android 真机实测。
