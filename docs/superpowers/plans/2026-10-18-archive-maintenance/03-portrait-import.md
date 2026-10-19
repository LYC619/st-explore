# C：立绘自动导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `executing-plans`。按本计划实现用户已给出的立绘方向，保留现有后台任务和文件保存逻辑。

**Goal:** 普通用户通过“粘贴 → 检查预览 → 导入”完成世界书图片列表导入，格式异常时可逐行修改或用本地示例标注，无需学习正则。

**Architecture:** 纯自动解析器与高级解析器共用预览数据结构；worker 负责有界解析；UI 负责逐行修正和分行选择；原后台任务负责下载/持久保存/取消/重试，并持久记录图片来源用于去重。

**Tech Stack:** TypeScript/React、Web Worker、现有 fetch/Tauri HTTP、PortraitCloudTaskStore、角色写入队列、Vitest/Playwright。

## 执行状态（2026-10-19）

C1–C5 实现及自动化已完成；专项 12 文件 / 128 项通过，真实浏览器 5 条流程通过（包含在 B/C 11 条批次内）。图片来自本地夹具，不是用户四份完整文本。混合验收项的 Tauri HTTP/文件重启、真实图床与 Android 真机未覆盖，保持未勾选并记录缺口。详见 [验证记录](../../../verification/2026-10-18-archive-maintenance.md)。

## C0. 约束与输入样本

- 本对话只有用户贴出的若干示例行，不含其提到的四份完整原始资料。将可见样例做夹具；不能声称四份真实文本均已验证。后续拿到新格式时再添加回归，现有样例足以推进。
- 原有高级规则（含 `$1/$2/{name}`、命名捕获和旧模板 fragment）继续兼容；默认自动模式不再用 `#` 传名称。
- 自动识别完整 HTTP(S) URL 必须先于冒号提取名称。保留 path/query 的实际请求语义，去掉 fragment；不能把 `https:` 当人名或对完整 URL 再 encodeURIComponent。
- 裸编码默认 Catbox 是产品默认，不代表能凭编码证明图床归属；预览显示使用的图床，用户可到高级设置更换。
- 图片格式解析与下载、持久化、预览能力一致。计划包含 AVIF；若目标 WebView 无法解码，显示具体预览限制，保存有效原始文件而非伪装 PNG。

## C1. 自动解析与逐行结果

**新增：** `src/lib/portrait-list-parser.ts`、`src/test/portrait-list-parser.test.ts`、`src/test/fixtures/portrait-lists.ts`。
**修改：** `src/lib/portrait-cloud.ts`、`src/lib/portrait-cloud.worker.ts`；保留 `buildPortraitLinks` 作为高级规则适配。

建议导出的实际数据契约（新代码按此创建，旧 PortraitLink 作为下载最小子集）：

```ts
export interface ParsedPortraitItem {
  line: number;
  raw: string;
  name: string;
  file: string;
  url: string;
  nameSource: 'explicit' | 'prefix' | 'filename';
}
export interface PortraitLineIssue {
  line: number;
  text: string;
  reason: string;
}
export interface PortraitParseResult {
  items: ParsedPortraitItem[];
  failed: PortraitLineIssue[];
  skipped: number[];
}
export function parsePortraitList(source: string, host?: string): PortraitParseResult;
```

- [x] 编写下表的表驱动失败用例，先运行确认新增功能尚未存在。
- [x] 每行 trim，保留原行号；空行和纯开闭标签行跳过。整行 URL 用 URL 解析最后 path 段并验证图片扩展，名称暂用文件 stem 且标 nameSource=filename，可直接修改。
- [x] 支持 `名称: 完整URL` 和 `名称：完整URL`；分隔冒号必须位于 URL 协议前。完整 URL 不再套图床模板。
- [x] 其他行从行尾识别至少 4 位 ASCII 字母/数字文件码与图片扩展；有冒号优先取冒号前名字，无冒号取文件码前内容并清尾部分隔符。裸文件用码暂名；AVIF 扩展大小写可识别。
- [x] URL 的编码只针对新拼装的单一路径段；完整 URL 已转义部分保留，不把 `%20` 编成 `%2520`。默认图片名称与 URL 独立存储。
- [x] 同名不同链接采用确定性全局占名算法：遇到已有 `名字_2` 时继续找空编号，不只按原名计数。同 URL 多行在预览归并并提示重复行，不覆盖第一个手动名字。
- [x] 部分行失败时返回成功项与详细失败列表；非法 URL、未知扩展、缺文件码分别给原因。纯普通描述不当图片条目。
- [x] 保留 512 KB 输入/1000 项限制、worker 超时和过期结果丢弃；默认模式也必须有界，输入变化后旧 worker 结果不能覆盖新内容。

| 输入 | 预期名称 | 文件/请求 |
| --- | --- | --- |
| `不开心: 不开心_hv26xb.png` | 不开心 | hv26xb.png，Catbox |
| `克萝爱口交01:er1gp5.png` | 克萝爱口交01 | er1gp5.png，Catbox |
| `Andrea_happy_2ctstv.png` | Andrea_happy | 2ctstv.png，Catbox |
| `乔伊害羞_0asodg.png` | 乔伊害羞 | 0asodg.png，Catbox |
| `https://files.catbox.moe/hv26xb.png` | hv26xb（可改） | 原 URL |
| `笑： https://img.example/a%20b.webp?sig=abc#ignored` | 笑 | query 保留，fragment 删除 |
| `abcd.AVIF` | abcd（可改） | abcd.AVIF |
| 空行、`<portraits>`、`</portraits>` | 无 | skipped，原行号保留 |
| `这一行没有图片` | 无 | failed，指出本行未找到文件码 |
| 同名两个不同文件 + 本来就叫 `名称_2` | 全部唯一 | 不覆盖任一条 |

最小纯函数测试示例（与上述新接口一致）：

```ts
import { expect, it } from 'vitest';
import { parsePortraitList } from '@/lib/portrait-list-parser';

it('keeps valid rows when another line is malformed', () => {
  const result = parsePortraitList('不开心: 不开心_hv26xb.png\n坏行\nAndrea_happy_2ctstv.png');
  expect(result.items.map(({ name, file }) => ({ name, file }))).toEqual([
    { name: '不开心', file: 'hv26xb.png' },
    { name: 'Andrea_happy', file: '2ctstv.png' },
  ]);
  expect(result.failed.map(item => item.line)).toEqual([2]);
});

it('preserves signed complete URLs without treating the scheme as a name', () => {
  const result = parsePortraitList('https://img.example/face.png?sig=abc#note');
  expect(result.items[0]).toMatchObject({
    name: 'face', url: 'https://img.example/face.png?sig=abc', nameSource: 'filename',
  });
});
```

**命令：** `npx vitest run src/test/portrait-list-parser.test.ts src/test/portrait-cloud.test.ts --reporter=dot`。

## C2. 实时预览、行编辑与分行推荐

**修改：** `src/components/character/PortraitCloudImport.tsx`。
**新增：** `src/components/character/PortraitImportPreview.tsx`、`src/lib/portrait-import-preferences.ts`、`src/test/portrait-import-preview.test.tsx`。

- [x] 默认界面只保留原文粘贴区、预览、保存分行与导入操作；取消必须点击的“预览链接”。约 250ms 防抖解析，可见解析中/成功/失败数量。
- [x] 预览每行显示选择、懒加载缩略图、可编辑名称、文件码/链接、目标分行与状态；失败行显示原行号/原文/原因，可以直接补名称/码/URL 后重校验。失败项不阻止其余已选有效项导入。
- [x] 缩略图按视口懒加载，限制同时请求数量；复用受限下载与 Blob 缓存，避免预览一次、导入再次全量下载。离开/切源释放资源，不一次创建 1000 个高分辨率图片对象。
- [x] 解析结果以稳定行身份关联用户修改；重新解析保留未变源行的手工名称/分行，源行已变的编辑不得错误套到另一行。过期 worker/缩略图回调被丢弃。
- [x] 默认收起高级设置，包含图床、模板、正则、必要的组件编码选项。自动/高级模式可切换，旧规则可加载；普通路径不要求选编码。
- [x] 名称前缀与当前角色的现有立绘分行标题做规范化最长唯一匹配；仅唯一时推荐，不匹配或歧义则“未分行”。不自动创建新角色，也不跨角色保存。
- [x] 全局“保存到”可覆盖当前批次，逐行可覆盖；混合 Andrea/乔伊/克萝的列表允许各入不同既有分行。分行删除后导入报具体行错误，不回退到错误行。
- [x] 保存最近一次成功使用的图床/模式/本地规则，不保存用户整段世界书原文；自动模式优先尝试上次成功规则，未覆盖行继续自动解析，失败行仍可修改。记录设置版本以兼容旧值。

**验收：** 仅粘贴就出现四个示例结果；改一行姓名不改变 URL；有效两行+错误一行可导入两行；取消全选/逐项勾选正常；同批多分行；关闭重开偏好恢复；切角色不带错目标；连续快速粘贴不会闪回旧结果。

**命令：** `npx vitest run src/test/portrait-import-preview.test.tsx src/test/portrait-cloud-ui.test.tsx --reporter=dot`。现有 UI 用例需要从点击预览更新为等待实际解析结果，不 mock 掉预览关键逻辑。

## C3. 持久去重、单项重试与后台保存

**修改：** `src/lib/portrait-cloud-task.ts`、`src/components/character/PortraitCloudTasks.tsx`、`src/lib/portrait-store.ts`、`src/lib/portrait-journal.ts`、`src/types/archive.ts`。
**测试：** 扩展 `portrait-cloud-task.test.ts`、`portrait-mutation.test.ts`、`portrait-store.test.ts`；新增 `src/test/portrait-import-identity.test.ts`。

- [x] PortraitItem 新增可选导入来源结构（规范 URL/图床文件码/必要时内容摘要），旧数据缺省有效。来源随图片和角色更新持久保存，备份/移动/日志恢复不得丢字段。
- [x] 去重限定当前角色：Catbox 以规范图床主机+文件码判同源；其他站点以完整规范 URL（含 query）为准，不跨站只比 abc123.png。仅名字相同不判重复。
- [x] 旧图片没有来源时不凭文件名跳过；下载后可用内容摘要确认已存在。同 URL 内容可能变化的通用站点给“重新导入”明确入口，不能永远强制忽略。
- [x] 开始前显示已保存重复项并默认不选；保存时在角色写入队列内再次核对，防止同批重复/同时导入。只有文件和角色记录都持久成功才标 saved；失败不记入去重索引。
- [x] 扩展任务 item 捕获自己的目标 rowId/rowTitle 与来源；任务仍固定一个角色/资料库，保存逐项使用捕获目标，不读取当前页面选择。没有逐项目标时兼容旧 task.target.rowId。
- [x] 保留 4 并发，每项下载后先完成保存再释放内存。切页继续，切库停止待开始任务；已开始提交遵循原捕获库完成语义，不能写入新库。
- [x] 状态增加 skipped（已存在）；提供单项重试和批量重试失败项。已保存/跳过项不重复请求，重试只改对应失败项，后台任务仍只有一个活动执行者。
- [x] 进度显示“已保存/跳过/失败/待处理”，完成进度按已处理项算，避免全是重复项时进度永远 0%。记录实际下载字节与已知大小；未知大小明确标未知，不为总量估算强制预下载全部文件。
- [x] 验收关闭弹窗、切页、停止时正在保存、单项失败再重试、删除目标行/角色、两张同名图片、重复导入及重启后去重。

**命令：** `npx vitest run src/test/portrait-cloud-task.test.ts src/test/portrait-cloud-ui.test.tsx src/test/portrait-import-identity.test.ts src/test/portrait-mutation.test.ts src/test/portrait-store.test.ts --reporter=dot`。

## C4. 从示例标注规则（本地兜底）

**新增：** `src/components/character/PortraitExampleRuleEditor.tsx`、`src/lib/portrait-example-rule.ts`、`src/test/portrait-example-rule.test.ts`。

- [x] 在失败行区域提供“用一行示例帮助识别”。展示该行，用户分别选择名称片段和文件码/完整 URL 片段；名称允许空，文件片段必须可验证。
- [x] 从所选片段两侧的字面分隔符推导定位方式，分隔符按字面转义；目标变长时仍按分隔符定位，不能把固定字符下标直接套全文件。
- [x] 将规则表示为有版本的本地结构（字段左右分隔符、文件提取方式、图床），再编译为有界解析器；不 eval 任意脚本。
- [x] 立即把候选规则用于其他行预览，显示成功数、失败行和名字/链接；分隔符歧义不猜测，保留逐行编辑路径。只有用户选择使用并成功导入后记住规则。
- [x] 对“姓名长度不同、分隔符含正则字符、两处相同分隔符、缺名称、只一个有效样例、超长行”做回归。生成规则仍在 worker 限时运行。
- [x] 本批不加 AI 推断按钮或调用；若本地样例不足以泛化，明确哪些行失败，成功项仍可导入。

**命令：** `npx vitest run src/test/portrait-example-rule.test.ts src/test/portrait-list-parser.test.ts --reporter=dot`。

## C5. 图片格式、资源与整条路径验收

- [x] `downloadPortrait` 的实际文件头校验、`portrait-store` MIME 映射与嗅探、预览路径支持相同格式；加入 AVIF 时识别 ISO BMFF 的有效 ftyp/兼容品牌，不仅凭响应 Content-Type 或扩展名。
- [x] HTML 错页伪装 png、Content-Length 超限、流式超过 20MB、超时、取消、损坏图像给具体错误；旧 PNG/JPEG/GIF/WebP 行为回归。
- [x] AVIF 作为普通立绘保存/恢复；设为 PNG 角色卡仍使用既有解码/重编码路径，环境无法解码时说明具体限制，禁止把 AVIF 字节改扩展名当 PNG。
- [x] 新建 `tests/roleplay/portrait-import.spec.ts`：真实 worker + 真实预览/后台任务/仓储；本地 HTTP 图片夹具覆盖有效图片、404、HTML 错页、延迟/取消和 AVIF。断网失败不依赖真实 Catbox 可用性。
- [ ] 浏览器检查成功/部分成功/逐行修改/高级规则/示例标注/跨页任务/重复导入；Tauri 检查 HTTP 下载、文件落盘、重启与实际图片打开。
- [ ] 使用用户提供的可用世界书样例再做一轮真实图床检查；当前没有完整四份文本时记录缺口，不阻塞已明确功能实现，也不伪造真实样本覆盖。
- [x] 运行 `npx playwright test --config=playwright.roleplay.config.ts portrait-import.spec.ts`、类型检查、构建；补写验证报告。Android 未测明确列出。
