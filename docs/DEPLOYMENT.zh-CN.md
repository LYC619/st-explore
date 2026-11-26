# 部署 ST Explorer

[English](DEPLOYMENT.md) · [使用指南](USAGE.zh-CN.md)

使用 Node.js 22 并执行 `npm ci`。请勿将模型密钥或个人文件库放入源码目录或 Docker 构建上下文。

## 完整网页版

```sh
# 公开 HTTPS 站点（本机或内网自托管可省略 --site-url）
npm run deploy:prepare -- --target app --site-url https://library.example.org/
```

完整网页版的应用路由、内嵌酒馆资源、安装清单与离线缓存均基于站点根路径（`/`），需部署在域名根目录下。

将生成的 `dist/` 整目录作为一个版本原子发布：
- `/` 为工作台（标记 `noindex, nofollow`）；
- `/about/en/`、`/about/zh-CN/` 及其 `guide/` 子目录为双语静态介绍与上手指南；传入 `--site-url` 时自动生成 `canonical`、`hreflang` 与 `sitemap.xml`；
- `deployment.json` 与 `SHA256SUMS` 记录构建版本与全文件校验值（可执行 `sha256sum -c SHA256SUMS` 校验）。

建议直接使用仓库提供的 `nginx.conf`：工作台路由回退至 `/index.html`，缺失静态资源与不存在的 `/about/` 页面返回 `404`；带哈希的 `/assets/` 产物长期缓存，HTML、Service Worker 与酒馆非哈希资源每次重新校验。若在公网自托管，请在反向代理层配置访问鉴权与 HTTPS。

## Docker Compose

```sh
docker compose up --build -d
```

默认监听本机 `127.0.0.1:8080`（可通过 `STE_PORT` 调整端口），无需配置环境变量即可直接启动。若挂在公开域名反向代理后，构建时可传入 `STE_SITE_URL=https://library.example.org/`。`/healthz` 提供健康检查；网页版资料保存在访问者浏览器本地，容器无需挂载数据卷。

## GitHub Pages（独立介绍与指南站）

1. 在仓库 **Settings → Pages** 将构建来源设为 **GitHub Actions**；
2. 手动运行 **Public documentation (manual)** 工作流，自动读取 Pages 地址并构建发布 `site-dist/`。

本地生成同款静态站（支持仓库子路径）：

```sh
npm run deploy:prepare -- --target pages --site-url https://your-name.github.io/st-explore/
```

仅在本地预览排版时可直接运行 `npm run site:build`。

## 升级与回退

1. 升级前先在「设置 → 数据与备份」导出备份，并保留上一版部署目录；
2. 重新构建并核对 `SHA256SUMS` 后原子切换站点目录，避免新旧资源混用；
3. 保存当前编辑后再点击页面内的版本更新刷新提示；若新版本异常，直接将服务器目录切回上一版即可。
