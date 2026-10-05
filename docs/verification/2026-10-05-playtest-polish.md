# 2026-10-05 实测反馈验收

## 改动
- 阅读：时间含年份、书签删除、备注与记录 Markdown、回顾内滚动及阅读空间、正则侧栏高度。
- 正则：最近 N 楼/最近 N 楼以外/自定义深度，预览、处理、导出共用原始楼层深度。
- 导出：角色 JSON、故事主线/分支 JSON 和 JSONL；详情与阅读器直接续聊。
- 世界书：UID 编辑与数值排序；撤销删除时 UID/内部键冲突自动分配空闲身份；最大安全整数边界避免新增覆盖。
- 聊天：分支切换与独立生成保存、脚本运行状态、原生聊天工具菜单入口。
- 美化：按故事分支保存状态栏和悬浮栏、预览、助手脚本导入、JSONPatch add/replace/remove 更新楼层 stat_data。

## 验证
- Vitest：215 文件，1905 测试通过。
- TypeScript：tsconfig.app.json 与 tsconfig.node.json 均通过。
- ESLint：0 错误，1 条已有 asset-navigation-test-support.tsx Fast Refresh 警告。
- Tavern 源码与 overlay 检查：48 测试通过，未修改 vendor 原件。
- Playwright 分支：主线→分支→主线→分支，两次本地模拟生成，用户及助手消息各自保存，脚本状态及聊天工具可见。
- 浏览器综合：角色 JSON、故事 JSON 下载内容、UID 冲突与排序、美化预览/保存/重载、390px 布局、实际 MVU 更新、悬浮栏折叠均通过，pageerror=[]。
- 阅读浏览器前序验收：Markdown 子卡独立滚动、标题滚出、550px/450px 阅读位置恢复及手机详情通过。
- 新增 UID 回归先失败（撤销导出丢一条、最大 UID 后新增被覆盖），修复后 27 项定向测试通过。

## 边界
MVU 为 JSON Patch 子集，并非对所有第三方 MVU 脚本的完整兼容承诺。浏览器使用隔离合成数据和本地模拟模型，没有调用用户付费模型。截图阻断外部 Google 字体请求，使用本地回退字体。

## 交付
生产构建、Windows 包与哈希记录在 release 对应日期目录的 build-manifest.json。
