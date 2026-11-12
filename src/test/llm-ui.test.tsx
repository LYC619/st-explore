import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IntroSection } from '@/components/character/IntroSection';
import { RatingPanel } from '@/components/character/RatingPanel';
import { RecordWorkbench } from '@/components/organize/RecordWorkbench';
import { SummaryWorkspace } from '@/components/organize/SummaryWorkspace';
import NovelView from '@/components/reader/NovelView';
import { AIFillDialog } from '@/components/story-tree/AIFillDialog';
import { AIUpdateDialog } from '@/components/worldbook/AIUpdateDialog';
import { AIRewriteContent } from '@/components/worldbook/AIRewriteContent';
import { BatchProcessor } from '@/components/summary/BatchProcessor';
import { APIConfigCard } from '@/components/ai-tools/APIConfigCard';
import { QuickModelSwitcher } from '@/components/ai-tools/QuickModelSwitcher';
import { Toaster } from '@/components/ui/toaster';
import { clearToastsForModal } from '@/hooks/use-toast';
import { persistProfiles, getActiveProfile } from '@/components/ai-tools/api-profiles';
import { createVault } from '@/lib/vault/vault-backend';
import { createMemFs } from '@/lib/vault/fs';
import { setActiveVault } from '@/lib/vault/active';
import { buildCharacterFromCard, buildStoryFromSession } from '@/lib/archive-db';
import { normalizeCharacterCard } from '@/lib/png-parser';
import { saveSessionPointer } from '@/lib/session-storage';
import { COMPLETION_WARNING, LLM_MESSAGES } from '@/lib/llm';
import type { ChatSession } from '@/types/chat';
import type { SummaryItem } from '@/types/summary';
(globalThis as {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;
const session: ChatSession = { id: 'synthetic-chat', title: '合成测试故事', createdAt: 1, character: { name: '合成角色' }, user: { name: '合成用户' }, messages: Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, role: 'assistant', content: `合成楼层 ${i}`, rawData: {} })) };
const character = buildCharacterFromCard({ name: '合成角色', description: '合成说明' });
const norm = normalizeCharacterCard(character.card);
const story = buildStoryFromSession(session, character.id);
const profile = { id: 'synthetic', name: '合成服务', apiUrl: 'https://synthetic.invalid/v1/chat/completions', model: 'synthetic', apiKey: '' };
let root: Root | undefined;
let vault: ReturnType<typeof createVault>;
const json = (content: string, finish = 'stop') => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }] }), { headers: { 'Content-Type': 'application/json' } });
beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    clearToastsForModal();
    vault = createVault(createMemFs());
    setActiveVault(vault);
    await vault.repo('characters').put(character);
    await vault.repo('archiveStories').put(story);
    saveSessionPointer({ currentBookId: story.id, markers: [] });
    persistProfiles([profile], profile.id);
    vi.stubGlobal('ResizeObserver', class {
        observe() { }
        unobserve() { }
        disconnect() { }
    });
    Element.prototype.scrollIntoView = () => { };
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => { };
    Element.prototype.releasePointerCapture = () => { };
    vi.stubGlobal('fetch', vi.fn(async () => new Response('synthetic-private-error', { status: 401 })));
});
afterEach(async () => { if (root)
    await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; setActiveVault(null); clearToastsForModal(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render(node: ReactNode) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root!.render(<MemoryRouter>{node}<Toaster /></MemoryRouter>)); }
function button(label: string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(el => el.getAttribute('aria-label') === label || el.textContent?.trim() === label); }
async function click(el: HTMLElement | null | undefined) { expect(el).toBeTruthy(); expect(el).not.toBeDisabled(); await act(async () => el!.click()); }
async function input(el: HTMLInputElement | HTMLTextAreaElement | null, value: string) { expect(el).toBeTruthy(); await act(async () => { const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el!.dispatchEvent(new Event('input', { bubbles: true })); }); }
function expectPermission() { expect(document.body.textContent).toContain(LLM_MESSAGES.permission); expect(document.body.textContent).toContain('HTTP 401'); expect(document.body.textContent).not.toContain('synthetic-private-error'); expect(fetch).toHaveBeenCalledOnce(); }
async function expandBatch() { await click([...document.querySelectorAll<HTMLElement>('[aria-expanded]')].find(el => el.textContent?.includes('批量分段生成'))); }
it('settings probes and model-list failures show classification with a keyless saved service', async () => {
    await render(<APIConfigCard />);
    await click(button('测试连通'));
    expectPermission();
    vi.mocked(fetch).mockClear();
    await click(button('获取模型'));
    expectPermission();
});
it('a keyless connection can be saved and selected for generation', async () => {
    await render(<><APIConfigCard /><QuickModelSwitcher /></>);
    await input(document.querySelector<HTMLInputElement>('[aria-label="提供商名称"]'), '无需密钥服务');
    await click(button('保存配置'));
    await click(document.querySelector<HTMLButtonElement>('button[aria-label^="切换模型"]'));
    await click(button('使用 无需密钥服务 的 synthetic'));
    expect(getActiveProfile()).toMatchObject({ apiKey: '', name: '无需密钥服务' });
    expect(fetch).not.toHaveBeenCalled();
});
it('intro generation shows the classified failure from the real transport', async () => {
    await render(<IntroSection character={character} norm={norm} onPatch={async () => character}/>);
    await click(button('生成 AI 简介'));
    await click(button('开始生成'));
    expectPermission();
});
it('rating generation shows the classified failure in its actual AI tab', async () => {
    await render(<RatingPanel character={character} norm={norm} stories={[story]} onPatch={async () => character}/>);
    await click(button('未评分'));
    await act(async () => button('AI 评分')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
    await click(button('生成 AI 建议'));
    expectPermission();
});
it('record generation keeps failed empty output out of the synthetic library', async () => {
    const saved = vi.fn();
    await render(<RecordWorkbench story={story} kind="volume" record={null} defaultBranchId={null} onSaved={saved}/>);
    await click(button('生成第 1 卷（60 楼）'));
    expectPermission();
    expect(saved).not.toHaveBeenCalled();
    expect(await vault.repo('summaries').list()).toEqual([]);
});
it('chapter suggestions display the classified failure', async () => {
    await render(<NovelView session={session} markers={[]} regexRules={[]} onClose={() => { }} onMarkersChange={() => { }} embedded/>);
    await click(button('AI 章节'));
    await click(button('生成章节建议'));
    expectPermission();
});
it('chapter polish displays the classified failure without autosaving', async () => {
    await render(<NovelView session={session} markers={[]} regexRules={[]} onClose={() => { }} polish={{ story, branchId: null }} embedded/>);
    await click(button('AI 润色本章'));
    await click(button('生成'));
    expectPermission();
    expect(await vault.repo('summaries').list()).toEqual([]);
});
it('tree fill displays the classified failure with real context assembly', async () => {
    await render(<AIFillDialog open onOpenChange={() => { }} session={session} nodes={[]} onApply={() => { }}/>);
    await click(button('生成'));
    expectPermission();
});
it('worldbook extraction displays the classified failure after loading the synthetic active story', async () => {
    await render(<AIUpdateDialog open onOpenChange={() => { }} existingEntries={[]} onAppend={() => { }}/>);
    await click(button('生成新条目（60 楼）'));
    expectPermission();
});
it('rewrite displays the classified failure and does not apply failed output', async () => {
    const apply = vi.fn();
    await render(<AIRewriteContent content="合成原文" onResult={apply}/>);
    await click(button('AI 改写'));
    await input(document.querySelector('textarea'), '合成要求');
    await click(button('生成改写'));
    expectPermission();
    expect(apply).not.toHaveBeenCalled();
});
it('batch failures display classification and cannot be merged as content', async () => {
    await render(<BatchProcessor session={{ ...session, messages: session.messages.slice(0, 1) }} floorStart={0} floorEnd={0} systemPrompt="合成提示"/>);
    await expandBatch();
    await click(button('开始批量生成'));
    expectPermission();
    expect(button('合并成功结果')).toBeUndefined();
});
it('truncated records show a separate marker while saved content stays unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json('合成总结正文', 'length')));
    const saved = vi.fn();
    await render(<RecordWorkbench story={story} kind="volume" record={null} defaultBranchId={null} onSaved={saved}/>);
    await click(button('生成第 1 卷（60 楼）'));
    expect(document.body.textContent).toContain(COMPLETION_WARNING);
    const items = await vault.repo<SummaryItem>('summaries').list();
    expect(items).toHaveLength(1);
    expect(items[0].content).toBe('合成总结正文');
});
it('empty replies are classified and never autosaved', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json('')));
    const saved = vi.fn();
    await render(<RecordWorkbench story={story} kind="volume" record={null} defaultBranchId={null} onSaved={saved}/>);
    await click(button('生成第 1 卷（60 楼）'));
    expect(document.body.textContent).toContain(LLM_MESSAGES.empty);
    expect(saved).not.toHaveBeenCalled();
    expect(await vault.repo('summaries').list()).toEqual([]);
});
it('the real summary workspace keeps the truncation marker after autosave remounts the editor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json('合成总结正文', 'length')));
    await render(<SummaryWorkspace story={story} kind="volume" currentBranchId={null} onKindChange={() => { }}/>);
    await click(button('生成第 1 卷（60 楼）'));
    expect(document.body.textContent).toContain(COMPLETION_WARNING);
    expect(await vault.repo<SummaryItem>('summaries').list()).toHaveLength(1);
});
it('batch stops taking work after three service failures in completion order and retains in-flight successes', async () => {
    const replies: Array<(value: Response) => void> = [];
    const network = vi.fn<typeof fetch>(() => new Promise(resolve => replies.push(resolve)));
    vi.stubGlobal('fetch', network);
    const longSession = { ...session, messages: Array.from({ length: 90 }, (_, i) => ({ ...session.messages[0], id: `m${i}` })) };
    const merged = vi.fn();
    await render(<BatchProcessor session={longSession} floorStart={0} floorEnd={89} systemPrompt="合成提示" onMergeToEditor={merged}/>);
    await expandBatch();
    await click(button('开始批量生成'));
    expect(network).toHaveBeenCalledTimes(3);
    await act(async () => replies[0](json('成功一')));
    expect(network).toHaveBeenCalledTimes(4);
    for (const index of [1, 2, 3])
        await act(async () => replies[index](new Response('', { status: 429, headers: { 'Retry-After': '601' } })));
    expect(network).toHaveBeenCalledTimes(6);
    expect(document.body.textContent).toContain('连续 3 段遇到限流或服务故障');
    // Both requests already in flight are allowed to complete, but their successes cannot reopen the queue.
    await act(async () => { replies[4](json('成功五', 'length')); replies[5](json('成功六')); });
    expect(network).toHaveBeenCalledTimes(6);
    expect(document.body.textContent).toContain('未处理');
    expect(document.body.textContent).toContain(COMPLETION_WARNING);
    await click(button('合并成功结果'));
    await click(button('送入结果编辑器'));
    expect(merged).toHaveBeenCalledWith('成功一\n\n---\n\n成功五\n\n---\n\n成功六');
});
it('batch cancellation aborts all in-flight requests and leaves queued segments unsent', async () => {
    const network = vi.fn<typeof fetch>(() => new Promise(() => { }));
    vi.stubGlobal('fetch', network);
    await render(<BatchProcessor session={session} floorStart={0} floorEnd={59} systemPrompt="合成提示"/>);
    await expandBatch();
    await click(button('开始批量生成'));
    expect(network).toHaveBeenCalledTimes(3);
    await click(button('取消'));
    expect(network.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true);
    expect(network).toHaveBeenCalledTimes(3);
    expect(document.body.textContent).toContain('已取消，已完成的结果保留');
    expect(button('开始批量生成')).toBeEnabled();
});
it('rewrite preserves partial output in the comparison dialog with its interruption warning', async () => {
    const body = 'data: {"choices":[{"delta":{"content":"合成部分正文"}}]}\n\n';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })));
    const apply = vi.fn();
    await render(<AIRewriteContent content="合成原文" onResult={apply}/>);
    await click(button('AI 改写'));
    await input(document.querySelector('textarea'), '合成要求');
    await click(button('生成改写'));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain(LLM_MESSAGES.interrupted);
    expect(dialog?.textContent).toContain('合成部分正文');
    expect(apply).not.toHaveBeenCalled();
    await click(button('应用替换'));
    expect(apply).toHaveBeenCalledWith('合成部分正文');
});
it.each(['intro', 'rating', 'tree', 'worldbook', 'rewrite', 'chapters', 'polish'] as const)('%s exposes a persistent truncation marker next to its result', async (surface) => {
    vi.stubGlobal('fetch', vi.fn(async () => json('合成截断正文', 'length')));
    if (surface === 'intro') {
        await render(<IntroSection character={character} norm={norm} onPatch={async () => character}/>);
        await click(button('生成 AI 简介'));
        await click(button('开始生成'));
    }
    if (surface === 'rating') {
        await render(<RatingPanel character={character} norm={norm} stories={[story]} onPatch={async () => character}/>);
        await click(button('未评分'));
        await act(async () => button('AI 评分')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
        await click(button('生成 AI 建议'));
    }
    if (surface === 'tree') {
        await render(<AIFillDialog open onOpenChange={() => { }} session={session} nodes={[]} onApply={() => { }}/>);
        await click(button('生成'));
    }
    if (surface === 'worldbook') {
        await render(<AIUpdateDialog open onOpenChange={() => { }} existingEntries={[]} onAppend={() => { }}/>);
        await click(button('生成新条目（60 楼）'));
    }
    if (surface === 'rewrite') {
        await render(<AIRewriteContent content="合成原文" onResult={() => { }}/>);
        await click(button('AI 改写'));
        await input(document.querySelector('textarea'), '合成要求');
        await click(button('生成改写'));
    }
    if (surface === 'chapters') {
        await render(<NovelView session={session} markers={[]} regexRules={[]} onClose={() => { }} onMarkersChange={() => { }} embedded/>);
        await click(button('AI 章节'));
        await click(button('生成章节建议'));
    }
    if (surface === 'polish') {
        await render(<NovelView session={session} markers={[]} regexRules={[]} onClose={() => { }} polish={{ story, branchId: null }} embedded/>);
        await click(button('AI 润色本章'));
        await click(button('生成'));
    }
    expect([...document.querySelectorAll('[role="status"]')].some(el => el.textContent === COMPLETION_WARNING)).toBe(true);
});
