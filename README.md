<p align="center">
  <img src="public/icon-192.png" alt="ST-Explore" width="128" height="128">
</p>

# ST-Explore

> SillyTavern 角色卡、聊天记录与资产的本地**存档 · 回味 · 续聊**工作台。

[![version](https://img.shields.io/badge/version-v0.9.9-orange)](https://github.com/LYC619/st-explore/releases)
[![platform](https://img.shields.io/badge/platform-Web%20%7C%20Windows%20%7C%20Android%20(Capacitor)-blue)](https://github.com/LYC619/st-explore)
[![stack](https://img.shields.io/badge/stack-React%2018%20%2B%20Tauri%202%20%2B%20Capacitor%207-4FC08D)](https://github.com/LYC619/st-explore)
[![license](https://img.shields.io/badge/license-AGPL--3.0-green)](./LICENSE)

> 让更多人体会到 AIRP 的乐趣。

---

## 📖 目录

- [项目简介](#-项目简介)
- [核心模块一览](#-核心模块一览)
- [功能详解](#-功能详解)
- [多模型与隐私边界](#-多模型与隐私边界)
- [Android（Capacitor）工程现状](#-androidcapacitor工程现状)
- [快速开始与部署](#-快速开始与部署)
- [质量验证与自动发版](#-质量验证与自动发版)
- [技术栈与架构](#-技术栈与架构)
- [路线图与许可](#-路线图与许可)

---

## 🌟 项目简介

ST-Explore（拾忆）分成**存档与回味**、**继续游玩**两部分：

- **存档与回味**：把 SillyTavern 的角色卡、聊天、世界书、预设、正则与扩展资产收进自己掌控的**明文文件库（Vault Format 3）**，支持阅读、整理、AI 总结、角色日记、故事树与前端美化。数据主权参考 Obsidian：文件在你手里，ST 来源目录始终只读，写回前强制自动备份。
- **内嵌酒馆续聊**：无需来回切换客户端，可直接从角色页或故事页打开内嵌酒馆（基于固定版本 TauriTavern 桥接）接着已有故事或分支继续游玩，支持后台常驻生成、过程追踪、草稿恢复与酒馆助手生态。
- **原生游玩引擎（实验中）**：提供独立地图规则沙盘（原生世界玩法 v3）与全屏 GAL 剧场。实验功能可能大改或撤回，不代表最终定型。

---

## 🧭 核心模块一览

对照 `src/pages/` 与应用路由：

| 模块 | 路由 | 对应页面 | 说明 |
| --- | --- | --- | --- |
| 首页仪表盘 | `/` | `Home.tsx` | 最近查看角色、最近故事、编辑处理快捷入口与共享资产统计 |
| 角色库 & 详情 | `/library`, `/character/:id` | `Library.tsx`, `CharacterPage.tsx` | 封面网格/列表、多级标签、回顾视图、立绘分行、开场白与就地阅读 |
| 预设库 & DIY | `/presets`, `/presets/:id`, `/preset` | `PresetLibrary.tsx`, `PresetDetail.tsx`, `Preset.tsx` | 按系列/版本管理预设、作者说明、内嵌正则/脚本、取用包与 DIY 编辑 |
| 编辑工作台 | `/chat`, `/story/:id`, `/tools`, `/worldbook`, `/card-viewer`, `/regex` | `Index.tsx`, `StoryWorkspace.tsx`, `Tools.tsx`, `WorldBook.tsx`, `CardViewer.tsx`, `RegexTool.tsx` | 聊天整理、AI 总结/日记/小总结、故事树、世界书、独立角色卡与正则 |
| 成品工作台 | `/beautify` | `Beautify.tsx` | 前端 HTML/正则/脚本编辑、变量树、差异对照、多尺寸预览与分支应用 |
| 附属库 | `/assets` | `AssetLibrary.tsx` | 世界书、预设、全局正则及其他归档资产（扩展/快速回复/人设/主题等） |
| 内嵌酒馆续聊 | `/play`, `/play/:id` | `ChatHub.tsx`, `Roleplay.tsx` | 续聊中心与常驻内嵌酒馆宿主（含 Agent 记忆维护、分支、草稿与助手） |
| 原生游玩引擎 | `/worlds`, `/worlds/:id`, `/gal/:id` | `WorldPlay.tsx`, `GalPlay.tsx` | 实验性规则沙盘（世界玩法 v3）、主神空间与全屏 GAL 剧场 |
| 设置中心 | `/settings` | `SettingsPage.tsx` | 显示与 NSFW、多模型 AI 配置与内置提示词、目录连接、数据备份、关于与诊断日志 |

---

## 📚 功能详解

### 1. 全局体验与设置

- 🎨 四套 token 驱动主题（深咖啡 / 墨黑 / 深夜蓝 / 米色典雅）
- 🔍 全局搜索（`Ctrl + F`），键盘导航与视觉分组一致
- 🛡️ 页面级错误边界与分包加载失败恢复提示，保留导航不白屏
- 📋 关于页显示构建号、提交 SHA 与构建时间；桌面版支持打开受限诊断日志目录

![显示设置](docs/readme/readme-25.png)
![目录与连接](docs/readme/readme-26.png)

### 2. 首页与 SillyTavern 接入

![首页仪表盘](docs/readme/readme-27.png)

- **桌面直连 ST 目录**：指定 `data/default-user` 后按分类勾选导入角色、聊天、世界书、预设、正则与其他资产，来源始终只读；支持检查更新与先备份后写回。
- **云酒馆备份 ZIP 导入**：支持直接导入 ST 备份包，自动跳过 `secrets.json`，校验路径穿越、符号链接与解压体积上限，导入后自动清理临时工作区（并在启动时回收过期孤儿目录）。

![接入 SillyTavern](docs/readme/readme-28.png)
![云酒馆导出 - 帐户面板](docs/readme/readme-29.png)
![云酒馆导出 - 下载备份](docs/readme/readme-30.png)

### 3. 角色库与角色详情

![角色库](docs/readme/readme-31.png)

- **筛选与视图**：类型单选 + 其余标签组多选，支持自定义一级/二级标签拖拽排序、网格/列表视图、按类型/评分/更新/标签分组、未评分筛选、Shift 范围批量管理与 NSFW 自动模糊。
- **角色详情与回顾视图**：集中查看总览、备注、故事、总结、日记、关联资产、立绘分行（含图床并发下载）与开场白；连续切卡保留页签与阅读位置。
- **库内回收站**：普通删除按目标文件直接处理，角色连同故事/记录/附件整组回收，文件库默认保留 30 天并支持恢复。

![标签管理](docs/readme/readme-32.png)
![列表视图](docs/readme/readme-34.png)
![角色详情页](docs/readme/readme-35.png)
![立绘分行管理](docs/readme/readme-36.png)

### 4. 预设库与编辑工作台

- **预设库（`/presets`）**：按作者/系列聚合多版本，默认展示作者说明，支持查看提示词、内嵌正则/脚本与配套附件、导出单 JSON / 取用文件夹 / ZIP，以及“复制后 DIY”进入独立编辑器。
- **聊天处理（`/chat`, `/story/:id`）**：JSONL / JSON / TXT 导入、全文搜索、楼层跳转、隐藏楼层开关、正则预览与应用到原文、精简导出（ST JSONL / JSON / TXT / Obsidian Markdown）。
- **总结 / 日记 / 小总结 / 故事树**：支持分卷跨卷总结、翻页式角色日记本、DIY 提示词、纯正则小总结提取，以及树形/SVG 导图/卡片/时间轴四视图故事树；内置 8 模块 53 项提示词均可自定义并单项恢复。
- **世界书编辑器（`/worldbook`）**：悬停预览、卡片/列表切换、批量操作、快速创建、token 估算与 AI 字符级 diff 改写。

![聊天工作台](docs/readme/readme-37.png)
![外观设置](docs/readme/readme-38.png)
![快速生成正则](docs/readme/readme-39.png)
![总结工作台](docs/readme/readme-40.png)
![故事树](docs/readme/readme-41.png)
![世界书编辑器](docs/readme/readme-42.png)
![批量操作](docs/readme/readme-43.png)
![快速添加](docs/readme/readme-44.png)
![预设编辑器](docs/readme/readme-45.png)
![附属库](docs/readme/readme-46.png)

### 5. 成品工作台（前端美化 `/beautify`）

面向带前端状态栏 / HTML 界面 / MVU 变量脚本的角色卡与故事分支：

- 支持 HTML、正则与脚本的集中编辑、草稿暂存与按分支应用，不破坏原卡数据。
- 内置**变量树、搜索、变更差异对照与多尺寸视口预览**。
- 复用原版酒馆助手与 MVU（支持 JSON Patch 的 `add` / `replace` / `remove` 子集），并区分内置隔离助手与用户主动安装的原版酒馆助手。

### 6. 内嵌酒馆续聊（`/play`, `/play/:id`）

基于固定版本的上游 TauriTavern 前端与严格 TypeScript 桥接层（`src/tavern/`），在应用内直接续聊已有故事或新建分支：

- **常驻后台生成**：切换至角色库、世界书或总结页时，生成任务继续在后台运行并支持随时返回。
- **双模式游玩与记忆维护**：支持“无 Agent · 原酒馆流程”和“Agent · 自动查阅资料与 STE 文件记忆”，也支持用户手动安装固定版本柏宝书与原版酒馆助手 ZIP。
- **可靠性与可观测性**：按轮记录“过程”快照（最终请求对照与脱敏预览）、稀疏草稿自动捕获与冲突恢复、断电可恢复导出，以及世界书按分支生效的版本草稿。

### 7. 原生游玩引擎（实验中 · `/worlds`, `/gal/:id`）

> ⚠️ 本模块处于**实验阶段**，后续可能大改或撤回，请勿视为最终稳定承诺。

- **独立地图规则沙盘（世界玩法 v3）**：八片地域与十二位行旅按确定性规则推演，支持天气/补给/召集干预、历史回放与分支另存。
- **人物智能与双视图记忆**：支持角色独立规划与公共文学旁白，内置严格 **Token 预算与输入上限裁剪**、**导演 / 观察者 / 角色三视角记忆过滤**以及**角色私密知识隔离**（公共旁白与无关角色无法读取私密设定与私密事实）。
- **主神空间与探索遭遇**：支持跨作品召唤已有角色按日程共同生活，或接管单个角色进行探索与遭遇处理。
- **全屏 GAL 剧场（`/gal/:id`）**：提供 Scene / Beat / Choice 节奏推进、世界事件剧场、按需立绘/场景素材池、历史回看与支线保存。
- **世界备份与公开快照**：支持导出完整世界包（`.ste-world`，含私密记忆与素材），也可导出仅含公开规则与公开事实的分享快照，并内置坏档校验与有界历史索引。

---

## 🔒 多模型与隐私边界

### 多模型原生协议适配

统一 AI 传输层（`src/lib/llm/` + `src/lib/roleplay/provider.ts`）通过 `ProviderAdapter` 抽象支持三类协议（可自动按接口地址识别，也支持显式指定 `protocol`）：

- **OpenAI Chat Completions 兼容**（含中转站与 **Ollama 等本地空 Key 服务**）
- **Anthropic Messages 原生协议**（`x-api-key` + `anthropic-version`，支持 `system` 分离、原生 SSE 事件流、结构化输出与 `max_tokens` 截断识别）
- **Google Gemini 原生协议**（通过 `x-goog-api-key` 请求头鉴权，**绝不将 Key 拼入 URL 查询参数**，支持 `systemInstruction`、`:streamGenerateContent?alt=sse` 流式、结构化输出与安全策略拦截识别）

所有通道共享统一的超时（首字节 / 空闲 / 总时长）、有限退避重试（含 `Retry-After`）、空回复拒存、截断提示与分类错误映射。

### 隐私与数据安全红线

- **私密内容不外泄**：角色卡正文、聊天记录、私密设定与 API Key 仅在用户主动触发生成时发往用户配置的模型端点；本地诊断日志与报错只记录受限事件分类与哈希定位，不落盘正文、路径私密段、密钥或远端原始错误正文。
- **Vault Format 3 与多窗口保护**：角色档案与卡面 PNG 采用带校验清单的可恢复保存（中断自动回滚或补完清理）；双窗口争用配置写锁时有限等待并提示；高于当前版本的库会被拒绝打开，防止旧版误写损坏数据。

---

## 📱 Android（Capacitor）工程现状

项目已内置 Capacitor 7 Android 壳工程（`capacitor.config.ts`、`android/`，`applicationId: com.ste.explorer`，`compileSdk / targetSdk = 35`，`minSdk = 23`），与桌面端共享 `dist/` 前端产物：

- **已就绪**：
  - `npm run android:sync`（先 `vite build` 再 `cap sync android`）与 `npm run android:open`
  - GitHub Actions `CI` 每次推送自动校验 `npx cap sync android`
  - GitHub Actions `Release`（tag `v*`）支持自动构建 Android APK（配置签名 Secrets 时打签名 Release APK，未配置时自动降级构建 Debug APK 并附带说明文件）
  - 移动端适配（HTTPS `androidScheme` 保障 IndexedDB / localStorage 可用、独立游玩后台停止生命周期监听）
- **当前限制与待真机验证**：
  - 尚无独立原生文件库后端（移动端当前沿用 WebView IndexedDB 兜底）
  - 尚未在真实 Android 实体机上完成完整回归验收（后退键交互、系统文件选择器导入、大库内存与内嵌酒馆体验均待真机验证）

---

## 🚀 快速开始与部署

### 环境要求

- [Node.js](https://nodejs.org/) **22**（与 CI 和 Docker 对齐）
- 桌面客户端额外需要：[Rust](https://www.rust-lang.org/tools/install)（stable + clippy）、WebView2（Windows 11 已内置）
- Android 构建额外需要：JDK 21、Android SDK（API 35）

### Web 开发

```bash
git clone https://github.com/LYC619/st-explore.git
cd st-explore
npm ci
npm run dev
```

访问 `http://localhost:8080`。

### 桌面客户端（Tauri 2，推荐）

```bash
npm ci
npm run tauri:dev      # 开发模式
npm run tauri:build    # 打包 Windows NSIS 安装包与 STE.exe
```

安装包输出在 `src-tauri/target/release/bundle/nsis/`，免安装主程序位于 `src-tauri/target/release/STE.exe`。

### Android（Capacitor 7）

```bash
npm run android:sync   # 构建 dist 并同步至 android/
npm run android:open   # 使用 Android Studio 打开工程
```

### Docker 部署（Node 22 + Nginx）

```bash
docker build -t st-explore .
docker run -d -p 8080:80 st-explore
```

---

## 🧪 质量验证与自动发版

### 本地验证命令

```bash
npm run verify:web     # 版本一致性 + 脚本单测 + ESLint + 双 tsconfig 严格检查 + 全量 Vitest + 酒馆源/桥接测试 + smoke + 生产构建
npm run verify         # verify:web + Rust cargo test --lib + cargo clippy --lib -- -D warnings
npm run verify:e2e     # smoke + Playwright 角色扮演与生产 Web E2E
```

### CI / Release 工作流

- **`.github/workflows/ci.yml`**：PR 与 `main` 推送自动执行：
  1. `web`（Ubuntu + Node 22）：`npm run verify:web` + `npx cap sync android`
  2. `e2e`（Ubuntu + Node 22）：生产构建 + 无头 Chromium 运行 `playwright.production.config.ts`
  3. `rust`（Windows + Node 22 + Rust stable）：前端构建 + `cargo test --lib` + `cargo clippy --lib -- -D warnings`
- **`.github/workflows/release.yml`**：推送 `v*` 标签自动触发：
  1. 先执行 `verify:web` 门禁
  2. 并行构建 Windows NSIS 安装包 / 免安装 `STE.exe` 与 Android APK（支持 Release 签名 Secrets 或 Debug 占位）
  3. 合并校验 `SHA256SUMS.txt` 并创建 **Draft Release**（需人工审核后手动发布）

---

## 🛠 技术栈与架构

- **前端**：React 18 + TypeScript（`strict` + `noUnusedLocals` + `noUnusedParameters`）+ Vite 8 + Tailwind CSS 3 + shadcn/ui + Radix UI
- **内嵌酒馆桥接**：`src/tavern/` 全量严格 TypeScript + Discriminated Union 通信协议（编译为 `/tauri-main.js` 与 `/ste/*.js`）
- **状态与持久化**：Web/Android（IndexedDB）· Windows 桌面（Vault Format 3 明文文件库 + Rust 路径授权与原子写入）
- **客户端壳**：Tauri 2（Rust）· Capacitor 7（Android）
- **测试体系**：ESLint · `tsc --noEmit` · Vitest · Node test · Playwright · `cargo test` · `cargo clippy`

```
┌────────────────────────────────────────────────────────────────┐
│                  ST-Explore (React 18 + TS SPA)                │
│  Home / Library / Presets / Editor / Beautify / Play / Worlds  │
└────────────────────────────────────────────────────────────────┘
             │ createRepo()                       │ src/tavern/
      ┌──────┴──────────────┐                     ▼
      ▼                     ▼           ┌─────────────────────┐
┌──────────────┐   ┌────────────────┐   │ Embedded Tavern     │
│ Web/Android: │   │ Desktop: Vault │   │ (TauriTavern Bridge)│
│  IndexedDB   │   │ Format 3 (fs)  │   └─────────────────────┘
└──────────────┘   └────────────────┘
                            │ Tauri IPC (Authorized Roots)
                            ▼
                   ┌────────────────┐
                   │ Rust File Layer│ ──(只读扫描/备份写回)──▶ SillyTavern data/
                   └────────────────┘
```

---

## 🗺 路线图与许可

围绕两部分持续推进：存档与回味侧重用户完全掌控的明文文件库、阅读与多模型整理；游玩侧保留内嵌酒馆续聊，并继续探索原生沙盘与 GAL 剧场等实验玩法（按实测体验决定取舍）。

欢迎通过 [Issues](https://github.com/LYC619/st-explore/issues) 提出建议或提交 PR。

本项目基于 **[AGPL-3.0-only](./LICENSE)** 协议开源。SillyTavern 及相关角色卡 / 预设 / 世界书的版权归各自作者所有，本项目仅作为第三方本地管理与游玩工具存在。
