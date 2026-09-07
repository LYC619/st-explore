# 导航与阅读器交互修复 Implementation Plan

**执行更新（2026-09-08）：** R1-R4 及 R5 自动化/浏览器检查已完成；Android 系统返回、分享与旋转验收仍未完成。
完整证据：[维护修复验证记录](../../reviews/2026-09-05-maintenance-fix-verification.md)。以下设计片段保留为原方案，最终实现以源码和验证报告为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 修复 F07-F11：资产编辑器对 query 身份变化真正加载、小说分页重排不丢失逻辑位置、显式跳转同步正文、Android 返回层级稳定、分享摘录与阅读页点击互不干扰。

**Architecture:** 保留现有路由和编辑器状态模型，不用 pathname/query 的整页 key 强制重挂。将 query 分成资产身份（assetId、characterId）与普通视图参数；身份变化由每个编辑器的脏状态守卫和递增请求序列处理。NovelView 以逻辑内容锚点而不是页码保存位置，显式跳转走单向命令通道，滚动反馈只更新指示器。阅读层 shell 锁定与 Android 返回处理拆成两个独立层。

**Tech Stack:** React 18、React Router search params、TypeScript、Vitest/Testing Library、TanStack Virtual、ResizeObserver、现有 back-button registry。

---

## 0. 共享约束

1. `assetId` 与 `characterId` 组成编辑对象身份；普通 `view`、筛选、折叠状态变化不得改变组件 key，也不得重置草稿。
2. A→B→C 的异步加载只允许最后一次身份请求提交状态。旧请求即使晚到，也不能覆盖当前编辑对象。
3. 脏草稿取消切换时，恢复上一个身份 URL，使用 `replace: true`，保留所有非身份 query 参数；拒绝保存时不得把 B 的数据写到 A 或 C。
4. 小说的持久进度仍以已有字段为准；本计划新增的 `NovelLocation` 只在本次运行内帮助分页重排，不做档案 schema 迁移。
5. 真实设备没有布局引擎时，jsdom 测试只验证命令、状态和事件顺序；必须把 Android/宽屏返回和真实滚动列为设备验收项。

## Task R1：编辑器 query 身份导航与脏状态守卫（F07）

**Files:**
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/AppLayout.tsx`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/pages/WorldBook.tsx`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/pages/Preset.tsx`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/pages/RegexTool.tsx`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/app-layout-navigation.test.tsx`
- Create: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/codex-review-query-repro.test.tsx`
- Create: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/worldbook-navigation.test.tsx`
- Create: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/preset-navigation.test.tsx`
- Create: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/regex-navigation.test.tsx`

- [x] **Step 1: 先覆盖 query 不重挂与身份确实重载两个断言。**

先写路由回归用例，再改实现。在 `AppLayout.tsx` 保留路由 pathname 变化时的正常卸载，但移除 `location.search` 参与 page key 的逻辑；`key` 只能由 `location.pathname`（以及现有明确需要重置的 route 参数）构成。测试渲染同一 pathname 下 `?assetId=A&view=list` 与 `?assetId=A&view=grid`，断言草稿输入值不丢失；再渲染 A→B，断言编辑器收到一次新的身份加载而不是沿用 A。

运行：

~~~powershell
npm test -- src/test/app-layout-navigation.test.tsx src/test/codex-review-query-repro.test.tsx --reporter=dot
~~~

Expected：当前控制组能通过，真实 A→B 复现测试先失败，说明不能靠旧的整页重挂修复身份切换。

- [x] **Step 2: 固定身份解析函数和 URL 回退规则。**

在每个编辑器文件顶部使用相同的纯函数形状，不能把普通 query 当成身份：

~~~ts
interface AssetIdentity {
  assetId: string | null;
  characterId: string | null;
}

function readAssetIdentity(params: URLSearchParams): AssetIdentity {
  return {
    assetId: params.get('assetId'),
    characterId: params.get('characterId'),
  };
}

function sameAssetIdentity(a: AssetIdentity, b: AssetIdentity): boolean {
  return a.assetId === b.assetId && a.characterId === b.characterId;
}
~~~

使用 `useRef` 保存已接受身份；使用 `useRef<number>(0)` 保存请求序列。取消或加载失败时，通过 `setSearchParams` 复制当前参数、只恢复 `assetId` 和 `characterId` 两个键，并以 `{ replace: true }` 写回，保留 `view` 和其他未知 query。新身份未被守卫确认前，保存回调仍绑定旧身份；确认后才替换 `selectedId` 和对应草稿。

- [x] **Step 3: 对接 WorldBook 现有草稿与状态式确认框。**

`useWorldBookDraftState` 的真实出口是 `worldbook/setWorldbook/hydrateWorldbook/markWorldbookClean/isDirty`；`setWorldbook` 只用于编辑，接受载入须使用 `hydrateWorldbook` 同时更新基线。现有 `doLoadStaged(item: WorldBookItem)` 是提交 UI 的同步 callback，不是 async 读取函数；数据读取使用 `getWorldBook(id)`。`confirmLoadItem` 是 `WorldBookItem | null` state，不能 await 调用。

把 searchParams 的 characterId 读取改名为请求身份；用于 COW 保存的 `cowCharacterId` 改为已接受身份 state，只在确认载入后更新。增加以下完整状态和目标提交函数；原已有 confirmLoadItem/setConfirmLoadItem 继续用于最近打开列表，不能把 URL 切换和列表切换的取消流程混为一谈：

~~~ts
interface PendingWorldbookTarget {
  sequence: number;
  identity: AssetIdentity;
  item: WorldBookItem | null;
  characterName: string;
}

const requestSeq = useRef(0);
const acceptedIdentity = useRef<AssetIdentity | null>(null);
const [pendingWorldbookTarget, setPendingWorldbookTarget] =
  useState<PendingWorldbookTarget | null>(null);
const [cowCharacterId, setCowCharacterId] = useState<string | undefined>();
const dirtyRef = useRef(isDirty);
dirtyRef.current = isDirty;

function acceptWorldbookTarget(target: PendingWorldbookTarget): void {
  if (target.sequence !== requestSeq.current) return;
  hydrateWorldbook(target.item?.worldbook ?? null);
  setFilename(target.item?.title ?? 'worldbook');
  setCurrentItemId(target.item?.id ?? null);
  setSelectedUid(null);
  setCowCharacterId(target.identity.characterId ?? undefined);
  setCowCharacterName(target.characterName);
  acceptedIdentity.current = target.identity;
  setPendingWorldbookTarget(null);
  setConfirmLoadItem(null);
  setStagedDialogOpen(false);
}

function restoreAcceptedIdentityQuery(): void {
  const accepted = acceptedIdentity.current;
  if (!accepted) return;
  setSearchParams(previous => {
    const next = new URLSearchParams(previous);
    for (const key of ['assetId', 'characterId'] as const) {
      const value = accepted[key];
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    return next;
  }, { replace: true });
}
~~~

身份 effect 仅以 `searchParams.get('assetId')`、`searchParams.get('characterId')` 两个原始值驱动，不以整个 searchParams 或 isDirty 驱动。每次身份改变立即 `++requestSeq.current`、清除旧 pending；取当前 seq 后并发调用 getWorldBook 与 getCharacter（无对应 id 则为 null），只在 seq 仍最新且未卸载时产生 PendingWorldbookTarget。取不到请求的 assetId 视为载入失败，不当成空稿。取数期间不改 accepted identity、草稿或 COW owner。读取完成时检查 dirtyRef.current：dirty 则 setPendingWorldbookTarget，clean 则 acceptWorldbookTarget；失败只在最新 seq 下反馈并恢复旧 query。

将现有 AlertDialog 的 open 条件扩展为 `!!confirmLoadItem || !!pendingWorldbookTarget`，URL 目标即使 item=null（清除身份）也能确认；确认按钮先判断 pendingWorldbookTarget，核对 sequence 后调用 acceptWorldbookTarget，否则沿用 doLoadStaged(confirmLoadItem)。取消/关闭 URL 确认时递增 sequence、清 pending 并 restoreAcceptedIdentityQuery；普通列表取消只清 confirmLoadItem。确认期间 B→C、慢请求、取消后晚到响应都必须失效。onOpenChange(false) 在确认按钮之后触发时，不得再次运行取消回退；用当前 pending ref 或已完成标记区分确认关闭。

首次无 assetId 的挂载保留现有会话/交接文件恢复；只有从已接受身份切到无 assetId 才 hydrateWorldbook(null)。将现有初始读取分支纳入同一 seq，禁止保留第二个无守卫的异步恢复。普通 query 不使 effect 清理/重启；请求依赖的 callback 用稳定 ref 或 useCallback，不靠禁用 exhaustive-deps 消除竞态。保存开始时捕获 accepted owner 和 seq；成功后的 UI setter 也检查 seq，不把旧保存响应贴到新对象。

- [x] **Step 4: 给 Preset 和 RegexTool 使用同一请求协议，但分别定义保存基线。**

Preset 实际读取 `getPreset(id)`，接受时调用 `setPreset(item.preset)`、`setOriginalPreset(item.preset)`、`setFileName(item.title)`、`setCurrentItemId(item.id)`，并沿用 handleLoadItem 的 prompt_order 首个 character_id / DEFAULT_CHARACTER_ID 选择。新增 title 基线，与完整 NormalizedPreset（包括 regexRules/originalData）一起比较；不只比较规则数组或引用。清除身份时 preset/originalPreset=null、fileName='preset'、currentItemId=null，并恢复 DEFAULT_CHARACTER_ID。

RegexTool 实际读取 `getRegexCollection(id)`；接受时深拷贝 item.rules 后调用 `setRules`、`setCollectionName(item.title)`、`setActiveCollectionId(item.id)`。以 `JSON.stringify({ title: collectionName, rules })` 记录保存基线；rules 是当前 session rules 的实际来源，不虚构独立 sessionRules state。清除身份时 setRules([])、setCollectionName('')、setActiveCollectionId(null)，不能用旧 getInitialRegexRules 再复活上一对象。

两个页面增加与 WorldBook 相同的 pending target + 状态式确认框；只有确认后才同时提交内容、基线与 COW characterId，取消/失败保持旧状态。首次无 query 仍保留现有 session 恢复。所有载入/保存后的 setter 都检查 sequence；新对象 characterId 不能在确认前改变保存上下文。

每个组件加入以下四个断言测试：A→B 后显示 B 的内容且保存只写 B；A 有未保存修改时切 B，取消后仍显示 A 的草稿且 URL 回到 A；A→B→C 时 B 的慢响应不能覆盖 C；A→A 但只改变 `view` 时草稿、选择项和脏状态保持。

- [x] **Step 5: 运行 R1 门禁。**

~~~powershell
npm test -- src/test/app-layout-navigation.test.tsx src/test/codex-review-query-repro.test.tsx src/test/worldbook-navigation.test.tsx src/test/preset-navigation.test.tsx src/test/regex-navigation.test.tsx --reporter=dot
npx tsc -p tsconfig.app.json --noEmit
~~~

Expected：A→B、取消、慢响应和普通 query 测试通过；不存在通过整页 remount 伪造成功的测试。

## Task R2：NovelView 的测量节点和逻辑阅读锚点（F08）

**Files:**
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/reader/NovelView.tsx`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/novel-view.ts`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/novel-view.test.ts`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/novel-view-interaction.test.tsx`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/novel-view-bookmark.test.tsx`

- [x] **Step 1: 先加入纯逻辑锚点测试。**

在 `novel-view.ts` 保留已有 NovelPage 的 chapterIndex、可选 title/chapterTitle、startFloor/endFloor/blocks，不重定义或收紧它们。新增兼容扩展与纯 helper：

~~~ts
export interface NovelLocation {
  blockIndex: number;
  offset: number;
}

export interface LocatedNovelPage extends NovelPage {
  startLocation: NovelLocation;
  endLocation: NovelLocation;
}

function compareNovelLocations(a: NovelLocation, b: NovelLocation): number {
  return a.blockIndex - b.blockIndex || a.offset - b.offset;
}

export function clampNovelLocation(
  location: NovelLocation, blockLengths: readonly number[],
): NovelLocation {
  if (blockLengths.length === 0) return { blockIndex: 0, offset: 0 };
  const index = Number.isFinite(location.blockIndex) ? Math.trunc(location.blockIndex) : 0;
  const blockIndex = Math.max(0, Math.min(index, blockLengths.length - 1));
  const rawOffset = Number.isFinite(location.offset) ? Math.trunc(location.offset) : 0;
  const offset = Math.max(0, Math.min(rawOffset, blockLengths[blockIndex]));
  return { blockIndex, offset };
}

export function findPageForNovelLocation(
  pages: readonly LocatedNovelPage[], location: NovelLocation,
): number {
  if (pages.length === 0) return 0;
  for (let index = pages.length - 1; index >= 0; index--) {
    if (compareNovelLocations(pages[index].startLocation, location) <= 0) return index;
  }
  return 0;
}
~~~

`paginateNovelDocument` 的返回改为 LocatedNovelPage[]，更新函数内所有 pages.push/页构造；其他只读消费者仍可按 NovelPage 结构使用，不要求旧 fixture 凭空具有必填定位字段。锚点 helper 测试使用完整 LocatedNovelPage fixture。每页区间采用 `[startLocation,endLocation)`，最后一个末尾可归最后页；恰在新页开始的锚点必须选新页，不能因为 <= 前页 end 又退回上一页。

用分页前、跨章节展平的源 blocks 索引编号；文本片段携带源偏移，分割/trim 时也保留原文偏移映射，不能按已分页片段重新编号。同一 floor 的长消息拆成多页时偏移单调增长。纯布局变化复用源编号；故事/分支或源内容改变时作新初始化边界，不把旧 source 索引用于不同正文。测试覆盖空内容、单 floor 跨多页、页中/边界偏移、clamp 与页数减少。

- [x] **Step 2: 把测量节点固定在不会因 spread key 卸载的元素上。**

在 `NovelView.tsx` 把 `pageBoxRef` 从会随 spread `key` 变化而卸载的 `article` 转移到稳定的阅读容器；ResizeObserver 回调先检查：

~~~ts
if (!node.isConnected) return;
const rect = node.getBoundingClientRect();
if (rect.width <= 0 || rect.height <= 0) return;
~~~

测量结果提交前再次确认该 node 仍是当前 `pageBoxRef.current`。清理旧 observer 后再观察新容器，禁止 detached node 的 0×0 尺寸进入 `setPageBox`。RED 测试模拟旧 article 被移除并触发 0×0 resize，断言当前页、逻辑锚点和测量配置均不被重置。

- [x] **Step 3: 将恢复初始进度限制在真正的初始化边界。**

把 `initialFloor` 的恢复 effect 拆成两条：首次故事/分支身份改变时读取 `readStoredFloor` 并跳转；普通 `pages`、字体、纸张宽度变化时只捕获当前 `NovelLocation`，重新分页后调用 `findPageForNovelLocation`。不要在 `[initialFloor, normalizePage, pages, readStoredFloor]` 每次变化时无条件 `setCurrentPage(initialPage)`。切换故事或分支时清空旧锚点，先以新身份的存储楼层初始化，再建立新锚点。

- [x] **Step 4: 运行 R2 门禁。**

~~~powershell
npm test -- src/test/novel-view.test.ts src/test/novel-view-interaction.test.tsx src/test/novel-view-bookmark.test.tsx --reporter=dot
~~~

Expected：detached 0×0 resize 不改变页码；字体/窗口重排后仍在同一消息偏移附近；故事/分支切换仍按已存楼层初始化。

## Task R3：显式跳转与滚动反馈解耦（F09）

**Files:**
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/reader/NovelView.tsx`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/reader/ReaderView.tsx`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/novel-view-interaction.test.tsx`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/novel-view-bookmark.test.tsx`

- [x] **Step 1: 写失败的正文跳转测试。**

用现有目录、书签、滑条入口触发目标页，mock `scrollToIndex`、`scrollIntoView` 与 120ms 同步锁；断言每次显式跳转同时发生：`currentPage` 更新、目标滚动命令发出、滚动容器最终在目标页。重复点击相同目标也必须发出新的请求。手动滚动只更新 `currentPage` 和持久化阅读进度，不能调用 `scrollToPage`。

- [x] **Step 2: 定义一次性跳转命令状态。**

在 `NovelView.tsx` 使用以下状态边界：

~~~ts
interface PendingJump {
  requestId: number;
  page: number;
}

const jumpRequestId = useRef(0);
const pendingJump = useRef<PendingJump | null>(null);
const jumpTimer = useRef<number | undefined>(undefined);

function jumpToPage(page: number) {
  if (pages.length === 0) return;
  const target = normalizePage(page, pages.length);
  const requestId = ++jumpRequestId.current;
  pendingJump.current = { requestId, page: target };
  goToPage(target); // 现有函数负责 state/ref、onFloorChange 与 saveProgress
  if (scrolling) scrollToPage(target);
  if (jumpTimer.current !== undefined) window.clearTimeout(jumpTimer.current);
  jumpTimer.current = window.setTimeout(() => {
    if (pendingJump.current?.requestId === requestId) {
      pendingJump.current = null;
      scrollSyncRef.current = false;
    }
  }, 120);
}
~~~

把当前 scrollToPage 内部未保存句柄的 120ms timer 移到唯一 jumpTimer；回调只有 requestId 仍最新时才同时清 pendingJump 和 scrollSyncRef。`scrollToPage` 只执行 virtualizer/DOM 滚动，不再次设置 page；`scrollHost`、virtualizer callback 和 `syncScrollProgress` 只报告滚动到的页并更新状态/ref，不调用 `jumpToPage`。组件卸载时清理 timer、raf 和 `scrollSync` lock。

- [x] **Step 3: 处理滚动回调晚到和 resize。**

浏览器 scroll 事件本身没有 requestId，不能伪造这个字段。只有本组件的 RAF/timer 捕获请求序列；执行前再次对比当前 pendingJump，旧任务退出。锁定期间的原生滚动反馈不回写进度，解锁后从 virtualizer 当前几何重新采样而非复用旧页；主动 wheel/touch 可取消当前 pending，交还手动阅读。Resize 后重新计算当前 `NovelLocation` 对应页，并在存在主动跳转时取消旧 timer 后重新发同一逻辑目标的滚动命令；不得用 `initialFloor` 恢复。

- [x] **Step 4: 运行 R3 门禁。**

~~~powershell
npm test -- src/test/novel-view-interaction.test.tsx src/test/novel-view-bookmark.test.tsx src/test/reader-view-keyboard.test.tsx --reporter=dot
~~~

Expected：三种显式入口都移动正文；手动滚动不循环；重复目标、快速连续目标和 resize 后跳转都有稳定结果。

## Task R4：返回层、分享摘录和阅读页工具事件（F10、F11）

**Files:**
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/reader/NovelView.tsx`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/reader/ReaderView.tsx`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/components/reader/ShareImage.tsx`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/immersive-mode.ts`
- Modify: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/lib/back-button.ts`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/back-button.test.ts`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/reader-view-keyboard.test.tsx`
- Test: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/inline-story-reader.test.tsx`
- Create: `D:/8.Project/0_0_维护/silly-tavern-explorer-main/src/test/reader-view-share.test.tsx`

- [x] **Step 1: 为 Android/宽屏返回补失败测试。**

将现有 `useImmersiveLock(isMobile && !embedded, exitReader)` 的 shell 条件与返回注册分开。测试 `isMobile=false`、`embedded=false` 时仍注册一个 reader back handler；`embedded=true` 不注册拥有路由返回权的 handler。按顺序触发：Radix layer handler、reader handler、未处理回调，断言 LIFO 和层级顺序不变。

- [x] **Step 2: 固定稳定的 reader 返回 handler。**

在 `immersive-mode.ts` 保留 shell 深度锁函数；新增或导出明确的 `useReaderBack(enabled: boolean, onBack: () => void)`，内部用 ref 保存最新 callback，只在 `enabled` 变化时注册/注销一次：

~~~ts
export function useReaderBack(enabled: boolean, onBack: () => void): void {
  const callbackRef = useRef(onBack);
  callbackRef.current = onBack;
  useEffect(() => {
    if (!enabled) return;
    return registerBackHandler(() => {
      callbackRef.current();
      return true;
    });
  }, [enabled]);
}
~~~

`NovelView` / `ReaderView` 的实际路由持有层使用 `useReaderBack(!embedded, exitReader)`；互相嵌套时只能由顶层注册，不能两层同时持有。工具弹层仍由 Radix 层先消费返回。已核对 registerBackHandler 返回 `() => void`，直接用作 effect cleanup，不修改其类型或运行时 LIFO。shell 锁只接收 `isMobile && !embedded`，不再附带 back 注册。

- [x] **Step 3: 冻结 ShareImage 开启瞬间的摘录。**

在 `ShareImage.tsx` 定义完整快照：

~~~ts
interface ShareSnapshot {
  storyTitle: string;
  characterName?: string;
  floor: number;
  text: string;
}
~~~

`changeOpen(true)` 从 false→true 时一次性读取 props 构造 snapshot；标题/角色/楼层只来自 snapshot；用 snapshot.text 初始化现有可编辑 text state，用户 Textarea 编辑照常更新 text，不再用 [open,currentText] effect 重置它；关闭时清空 snapshot。触发按钮、portal content 和内部可交互区域均标记 `data-reader-tool`，在 `onClick`、`onPointerDown`、`onTouchStart` 中 `stopPropagation()`，不调用 `preventDefault()`，避免破坏 Radix 默认行为。`NovelView` 与 `ReaderView` 各自的页点击处理先检查目标是 Element 再调用 `event.target.closest('[data-reader-tool]')`，命中则返回。

- [x] **Step 4: 运行 R4 门禁。**

~~~powershell
npm test -- src/test/back-button.test.ts src/test/reader-view-keyboard.test.tsx src/test/inline-story-reader.test.tsx src/test/reader-view-share.test.tsx --reporter=dot
npx tsc -p tsconfig.app.json --noEmit
~~~

Expected：宽屏全屏返回关闭 reader；嵌入 reader 不抢路由返回；打开分享后父层文本变化不改摘录，点击分享工具不翻页。

## Task R5：阅读器交付检查

R5 是 R1—R4 的组合验收，不新增业务任务；F07—F11 分别写入总计划 S2.4 的证据记录。

- [x] **Step 1:** 检索 `NovelView.tsx`，确认任何 `syncScrollProgress`、ResizeObserver 或滚动反馈路径都不调用 `jumpToPage`；显式入口为目录、书签、滑条、翻页动作和初始化/身份切换；重排只恢复当前逻辑锚点，不使用初始楼层，也不从被动进度函数反向发 jump。
- [x] **Step 2:** 检索三个编辑器，确认普通 query 没有进入 React `key`，身份切换都具备 request sequence、取消回退和 fresh save owner。
- [x] **Step 3:** 运行：

~~~powershell
npm test -- novel-view reader-view back-button inline-story-reader app-layout-navigation worldbook-navigation preset-navigation regex-navigation --reporter=dot
npm run lint -- --quiet
~~~

Expected：R1-R4 自动化通过；没有通过扩大 mock 范围或屏蔽 layout assertion 使测试失真。

- [ ] **Step 4:** 设备验收记录至少包括：Android 软返回（窄屏和宽屏）、连续目录跳转、旋转/字体改变后的阅读锚点、分享摘录冻结；无法提供设备时明确记为未验收，不以浏览器窗口测试替代。
