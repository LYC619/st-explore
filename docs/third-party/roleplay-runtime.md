# 角色扮演功能的第三方来源

## 随仓库保留的原始前端

- 项目：[Darkatse/TauriTavern](https://github.com/Darkatse/TauriTavern)，上游 [SillyTavern](https://github.com/SillyTavern/SillyTavern)。
- 固定提交：`9693a4ec47cd4552f90878bccab453f176de0f18`；TauriTavern 2.2.0 / ST 1.18.0。
- 原件：`vendor/tauritavern/`，1,137 个文件，逐个记录在 `SOURCE-MANIFEST.json`，来源记录为 `UPSTREAM.json`。
- 保留原 AGPL v3 许可、原版权注释、依赖许可及包锁。STE 本身为 AGPL-3.0-only。
- 原始源码不直接编辑。STE 的桥接与有意改动在 `src/tavern/`、`src/lib/roleplay/` 和 `scripts/tavern/host-overlay.mjs`；覆盖前核验原文件哈希。

原版应用模块不重新打进 React。构建沿用固定的六个 Rspack 库/设置输出，其余文档与模块按原 URL 结构交付。根目录 `package-lock.json` 固定实际依赖；不使用 TauriTavern 的 Rust 后端、另一套聊天存储或原生启动脚本。

构建、交付与更新方法见 [`vendor/tauritavern/README.ste.md`](../../vendor/tauritavern/README.ste.md)。分发时需要保留适用的许可证、版权说明，并提供包含这些 STE 修改的对应源代码；本轮只创建本地分支与构建产物，未发布程序。

## 用户提供的柏宝书

[ST-BaiBai-Book](https://github.com/baibai-git/ST-BaiBai-Book)，固定 1.2.7 / `5c8a6b60d8c1185e169c46d43f63fce7d35d8583`。

STE 只随程序提供接口适配和版本校验，不分发柏宝书代码。用户选择原版 ZIP 安装。开发回归脚本会从固定原件读取或下载到忽略的 `.cache/tavern/fixtures/`，该目录不进入生产资源映射。

校验值：

- `dist/index.js` SHA-256：`44254f4049f19b43e3c548cd1329530d33142e3e65218cf7735bafcdafd8ac1f`
- `dist/index.css` SHA-256：`075d0810c8c60645fe2ec816bd8579da55e97bdb537654147256bb71982ed99f`

仓库中的授权不据此推定为允许重新分发。完整故事包会省略插件程序；完整用户备份保留其自行安装的内容。

## 用户安装的原版酒馆助手（2026-10-06）

新增 [N0VI028/JS-Slash-Runner](https://github.com/N0VI028/JS-Slash-Runner) 4.11.3 原版 ZIP 安装，固定提交 `87ca341a2a2279f4c18cd1918c5ae9dbd1dac492`。安装器检查主程序、样式、JSON 编辑器和 iframe Tailwind 依赖的 SHA-256，保存上游 LICENSE 与所需资源。上游此版本采用 PolyForm Noncommercial 1.0.0；STE 不将其源码或 ZIP 编入发行资源。

安装后的主程序只改写资源地址，以连接原版 ST 模块和包内资源；ChatSurface 使用已固定的 TauriTavern 原接口。原版插件运行时替代内置助手，避免双重执行。开发测试可运行 `npm run tavern:helper-fixture` 获取固定 ZIP，文件保存在忽略的 `.cache/` 下。

## 接口和设计参考（内置实现）

- [JS-Slash-Runner](https://gitlab.com/novi028/JS-Slash-Runner)，参考 4.9.5 / `cd9f523d08d147057043b9939397de8a61be91e4` 的接口和 JSON 形状；其源码未复制进 STE。原项目的 AFPL 文本不套用于 STE 自有实现。
- SP·数据库与小白X用于早期设计比较，没有成为此实现的代码依赖。
- Agent 是 STE 实现的有界工具循环，复用现有 Provider 配置、检索和存储能力，没有另引入全套 Agent 框架或向量数据库。

实际兼容范围见[扩展兼容说明](../principles/extension-compatibility.md)。
