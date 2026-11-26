# ST Explorer · 拾忆

[English](README.md) · [简体中文](README.zh-CN.md)

**把角色与故事收进自己的私人藏书馆。** 收藏 SillyTavern 角色卡，回味聊天，整理世界书和预设，再接着续写下一场戏。

这是面向酒馆玩家的独立社区项目。

## 能做什么

- 用卡面画廊、标签、评分、立绘与关联故事整理角色收藏。
- 阅读和编辑聊天，查看支线、标记章节、收录名场面。
- 管理世界书、预设、正则和相关资产。
- 通过内嵌固定版本酒馆继续聊天，直接连接你自己配置的 AI 提供商。
- 在简体中文与英文界面之间切换，角色、聊天、自定义标签、已保存名称和写作提示词保留原文。

山海世界沙盘与 GAL 剧场目前处于实验阶段。

## 选择版本

| 版本 | 存储方式与适用场景 |
| --- | --- |
| Windows 桌面端（Tauri） | 完整本地文件夹体验，自选文件库目录，可直接用资源管理器查看与备份。 |
| 自托管网页版 | 按站点地址和浏览器配置独立存储在浏览器本地，需部署在站点根路径（`/`）。 |
| Android（Capacitor） | 源码内置实验性移动端工程。 |
| GitHub Pages | 独立双语产品介绍与上手指南静态站。 |

## 本地运行

需要 Node.js 22 与 npm，首次启动会自动准备内嵌酒馆前端资源。

```sh
npm ci
npm run dev
```

打开终端显示的本地网址即可体验；日常导入、阅读、续聊与备份流程见[使用指南](docs/USAGE.zh-CN.md)。桌面端开发需先配置 [Tauri 环境](https://v2.tauri.app/start/prerequisites/) 再运行 `npm run tauri:dev`（编写原生自动化测试请遵循[独立测试规则](docs/guides/native-test-isolation.md)）。

## 构建与部署

```sh
# 完整网页版与 /about/ 介绍页（本地或内网部署可省略 --site-url）
npm run deploy:prepare -- --target app --site-url https://library.example.org/

# 独立双语介绍与指南站（支持仓库子路径）
npm run deploy:prepare -- --target pages --site-url https://your-name.github.io/st-explore/
```

产物输出到 `dist/` 或 `site-dist/`，并附带 `deployment.json` 与 `SHA256SUMS`。Docker Compose、Nginx 反向代理、GitHub Pages 与升级步骤见[部署说明](docs/DEPLOYMENT.zh-CN.md)。

## 隐私与备份

桌面资料存放在你选定的本地文件夹，网页资料存放在当前浏览器本地，没有内置云端账号或自动同步。扫描和导入 SillyTavern 目录保持只读，工作副本、导出副本与显式写回彼此独立；AI 功能仅将所选上下文发往你配置的模型服务。

升级或大批量导入前可在「设置 → 数据与备份」导出备份，桌面文件库建议另留一份目录拷贝。

## 开发与社区

```sh
npm run i18n:check
npm run verify:web
npx playwright test --config=playwright.production.config.ts
```

- [贡献说明](CONTRIBUTING.md) · [翻译说明](docs/I18N.zh-CN.md)
- [使用反馈](SUPPORT.md) · [安全反馈](SECURITY.md)
- [架构与开发指南](docs/guides/) · [第三方声明](THIRD_PARTY_NOTICES.md)

采用 [AGPL-3.0-only](LICENSE) 开源许可。
