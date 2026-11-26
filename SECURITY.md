# Security reporting / 安全反馈

Please do not post exploit details, private content, or credentials in public issues. Use **Report a vulnerability** under this repository's **Security** tab when available; if private vulnerability reporting is not enabled on the fork/mirror, open a brief issue asking for a private contact channel without sharing sensitive details.

Include the version/build from **Settings → About & guides**, platform, impact, and a synthetic reproduction. If an API key was accidentally exposed, revoke it immediately with your model provider.

ST Explorer can render user-imported cards, HTML snippets, regex scripts, and tavern extensions—only enable scripts and extensions from sources you trust. When self-hosting the web app on a network, terminate HTTPS and configure access control at your reverse proxy.

中文：请勿在公开 issue 中披露漏洞利用细节、私人资料或密钥。优先使用仓库 Security 页的私密报告入口；报告时请附上构建号、平台与合成复现步骤。若不慎泄露 API 密钥，请立即前往对应服务商后台吊销。仅启用可信来源的角色卡脚本与扩展；公网自托管请在反向代理层配置 HTTPS 与访问鉴权。
