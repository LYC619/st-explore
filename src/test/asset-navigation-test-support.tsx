import { act, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate, useNavigationType, type NavigateFunction } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ENTRY, type WorldBookItem } from '@/types/worldbook';
import type { PresetItem } from '@/types/preset';
import type { RegexCollectionItem } from '@/types/regex';
import type { RegexRule } from '@/types/chat';
import { setPendingToolFile, takePendingToolFile } from '@/lib/tool-handoff';

const db = vi.hoisted(() => ({
  worldbook: { get: vi.fn(), all: vi.fn(), save: vi.fn(), remove: vi.fn() },
  preset: { get: vi.fn(), all: vi.fn(), save: vi.fn(), remove: vi.fn() },
  regex: { get: vi.fn(), all: vi.fn(), save: vi.fn(), remove: vi.fn() },
  character: vi.fn(), reference: vi.fn(), toast: vi.fn(),
}));
export { db };

// Keep the editors, draft hooks, save/COW logic and Radix dialogs real.
vi.mock('@/components/AppLayout', () => ({
  AppLayout: ({ children, actions }: { children?: ReactNode; actions?: ReactNode }) => <div>{actions}{children}</div>,
}));
vi.mock('@/components/GuidedTour', () => ({ GuidedTour: () => null }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: db.toast }) }));
vi.mock('@/lib/worldbook-db', () => ({
  getWorldBook: db.worldbook.get, getAllWorldBooks: db.worldbook.all, saveWorldBook: db.worldbook.save,
  deleteWorldBook: db.worldbook.remove, pruneAutoSavedWorldBooks: vi.fn(),
}));
vi.mock('@/lib/preset-db', () => ({
  getPreset: db.preset.get, getAllPresets: db.preset.all, savePreset: db.preset.save,
  deletePreset: db.preset.remove, pruneAutoSavedPresets: vi.fn(),
  // Persistence conflicts are covered with the real repository in preset-catalog-persistence.
  saveEditedPreset: async (id: string, title: string, preset: PresetItem['preset']) => {
    const base = await db.preset.get(id);
    if (!base) throw new Error('预设已不存在');
    await db.preset.save({ ...base, title, preset, autoSaved: false, updatedAt: Date.now() });
  },
  createPresetDiy: vi.fn(),
}));
vi.mock('@/lib/regex-db', () => ({
  getRegexCollection: db.regex.get, getAllRegexCollections: db.regex.all, saveRegexCollection: db.regex.save,
  deleteRegexCollection: db.regex.remove, generateRegexCollectionId: () => 'copy-regex',
  buildRegexCollection: (title: string, rules: RegexRule[]) => ({ id: 'new-regex', title, rules, createdAt: 1, updatedAt: 1 }),
}));
vi.mock('@/lib/archive-db', () => ({ getCharacter: db.character, getAllArchiveStories: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/character-asset-ref', () => ({ updateCharacterAssetReference: db.reference }));

import WorldBook from '@/pages/WorldBook';
import Preset from '@/pages/Preset';
import RegexTool from '@/pages/RegexTool';

export type EditorKind = 'worldbook' | 'preset' | 'regex';
type Item = WorldBookItem | PresetItem | RegexCollectionItem;
const pages = { worldbook: WorldBook, preset: Preset, regex: RegexTool };
export const kinds: EditorKind[] = ['worldbook', 'preset', 'regex'];

export function fixture(kind: EditorKind, id: string): Item {
  const rule: RegexRule = { id: 'rule', name: `Rule ${id}`, findRegex: id, replaceString: '', placement: ['all'], disabled: false };
  const base = { id, title: `Asset ${id}`, createdAt: 1, updatedAt: 2 };
  if (kind === 'worldbook') return { ...base, worldbook: { entries: { '1': { ...DEFAULT_ENTRY, uid: 1, comment: `Entry ${id}`, content: `Content ${id}` } } } } as WorldBookItem;
  if (kind === 'preset') return { ...base, preset: {
    prompts: [{ identifier: 'prompt', name: `Prompt ${id}`, role: 'system', content: `Content ${id}` }],
    promptOrder: [{ character_id: 7, order: [{ identifier: 'prompt', enabled: true }] }],
    regexRules: [rule], hasRegexExtension: true, originalData: { impersonation_prompt: `Field ${id}` },
  } };
  return { ...base, rules: [rule] };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let container: HTMLDivElement;
let root: Root;
let navigate: NavigateFunction;
function Probe() {
  navigate = useNavigate();
  const location = useLocation();
  const action = useNavigationType();
  return <output data-location={location.search} data-action={action} />;
}

export function setupNavigation() {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear();
    localStorage.clear();
    vi.clearAllMocks();
    for (const kind of kinds) {
      takePendingToolFile(kind);
      const items = ['A', 'B', 'C'].map((id) => fixture(kind, id));
      db[kind].get.mockReset().mockImplementation(async (id: string) => items.find((item) => item.id === id) ?? null);
      db[kind].all.mockReset().mockResolvedValue(items);
      db[kind].save.mockReset().mockResolvedValue(undefined);
      db[kind].remove.mockReset().mockResolvedValue(undefined);
    }
    db.character.mockReset().mockImplementation(async (id: string) => ({ id, name: id }));
    db.reference.mockReset().mockResolvedValue({ id: 'saved-character' });
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    Element.prototype.scrollIntoView = () => {};
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
}

export async function mount(kind: EditorKind, query = '?assetId=A&view=list', strict = false) {
  const Page = pages[kind];
  const page = (
    <MemoryRouter initialEntries={[`/${kind}${query}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Probe /><Page />
    </MemoryRouter>
  );
  await act(async () => root.render(strict ? <StrictMode>{page}</StrictMode> : page));
}
export async function go(query: string) { await act(async () => navigate(query)); }
export function query() { return new URLSearchParams(document.querySelector('[data-location]')!.getAttribute('data-location')!); }
export function dialog() { return document.querySelector('[role="alertdialog"]'); }
export async function click(element: Element | null | undefined) {
  expect(element, 'expected an interactive control').toBeTruthy();
  await act(async () => (element as HTMLElement).click());
}
export function button(text: string, scope: ParentNode = document) {
  return Array.from(scope.querySelectorAll('button')).find((element) => element.textContent?.trim() === text);
}
export async function tab(text: string) {
  const target = button(text)!;
  expect(target).toBeTruthy();
  await act(async () => target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
}
export async function editInput(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  expect(input).toBeTruthy();
  await act(async () => {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export async function contentInput(kind: EditorKind) {
  if (kind === 'worldbook') {
    await click(document.querySelector('[data-entry-key="1"]'));
    return document.querySelector<HTMLTextAreaElement>('textarea')!;
  }
  if (kind === 'preset') {
    await tab('提示词');
    if (!document.querySelector('textarea[placeholder="提示词内容"]')) await click(document.querySelector('[aria-label="展开"]'));
    return document.querySelector<HTMLTextAreaElement>('textarea[placeholder="提示词内容"]')!;
  }
  if (!document.querySelector('textarea[placeholder="/pattern/flags 或纯 pattern"]')) await click(document.querySelector('[aria-label="展开编辑"]'));
  return document.querySelector<HTMLTextAreaElement>('textarea[placeholder="/pattern/flags 或纯 pattern"]')!;
}
export async function expectContent(kind: EditorKind, id: string) {
  expect((await contentInput(kind)).value).toBe(kind === 'regex' ? id : `Content ${id}`);
}
export async function dirty(kind: EditorKind) {
  const input = await contentInput(kind);
  await editInput(input, 'unsaved A');
  expect(input.value).toBe('unsaved A');
  return input;
}
export async function save(kind: EditorKind) { await click(button(kind === 'regex' ? '存入资产库' : kind === 'preset' ? '覆盖保存' : '保存') ?? button('保存')); }
export function savedContent(kind: EditorKind, item: Item) {
  if (kind === 'worldbook') return (item as WorldBookItem).worldbook.entries['1'].content;
  if (kind === 'preset') return (item as PresetItem).preset.prompts[0].content;
  return (item as RegexCollectionItem).rules[0].findRegex;
}

export function navigationTests(kind: EditorKind) {
  setupNavigation();
  describe(`${kind} identity navigation`, () => {
    beforeEach(() => {
      // These tests exercise immediate navigation before the 600ms debounce.
      // Autosave timing/draining is covered separately; CPU load must not advance this clock.
      if (kind === 'worldbook') vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });
    afterEach(() => { if (kind === 'worldbook') vi.useRealTimers(); });
    it('loads B without remounting and saves only B', async () => {
      await mount(kind);
      await expectContent(kind, 'A');
      await go('?assetId=B&view=list');
      await expectContent(kind, 'B');
      expect(db[kind].get.mock.calls.map(([id]) => id)).toEqual(['A', 'B']);
      await save(kind);
      expect(db[kind].save).toHaveBeenCalledTimes(1);
      expect(db[kind].save.mock.calls[0][0]).toMatchObject({ id: 'B', title: 'Asset B' });
    });

    it('cancels dirty navigation with replace and preserves every non-identity query parameter', async () => {
      await mount(kind, '?assetId=A&characterId=owner-a');
      const input = await dirty(kind);
      await go('?assetId=B&characterId=owner-b&view=grid&filter=one&filter=two');
      expect(dialog()).not.toBeNull();
      await click(button('取消', dialog()!));
      expect(input.value).toBe('unsaved A');
      expect(query().get('assetId')).toBe('A');
      expect(query().get('characterId')).toBe('owner-a');
      expect(query().get('view')).toBe('grid');
      expect(query().getAll('filter')).toEqual(['one', 'two']);
      expect(document.querySelector('[data-action]')).toHaveAttribute('data-action', 'REPLACE');
      await go('?assetId=C');
      expect(dialog()).not.toBeNull();
    });

    it('ignores a slow B response after C is accepted', async () => {
      await mount(kind);
      const slow = deferred<Item>();
      db[kind].get.mockImplementation((id: string) => id === 'B' ? slow.promise : Promise.resolve(fixture(kind, id)));
      await go('?assetId=B');
      await go('?assetId=C');
      await expectContent(kind, 'C');
      await act(async () => slow.resolve(fixture(kind, 'B')));
      await expectContent(kind, 'C');
      await save(kind);
      expect(db[kind].save.mock.calls.at(-1)![0].id).toBe('C');
    });

    it('keeps the selected editor, draft and dirty guard when only view changes', async () => {
      await mount(kind);
      const input = await dirty(kind);
      await go('?assetId=A&view=grid');
      expect(input.isConnected).toBe(true);
      expect(input.value).toBe('unsaved A');
      expect(db[kind].get).toHaveBeenCalledTimes(1);
      await go('?assetId=B&view=grid');
      expect(dialog()).not.toBeNull();
    });

    it('keeps the accepted COW owner while B is still loading', async () => {
      await mount(kind, '?assetId=A&characterId=owner-a');
      await dirty(kind);
      const slow = deferred<Item>();
      db[kind].get.mockImplementation((id: string) => id === 'B' ? slow.promise : Promise.resolve(fixture(kind, id)));
      await go('?assetId=B&characterId=owner-b');
      await save(kind);
      expect(db[kind].save.mock.calls.at(-1)![0]).toMatchObject({ derived: { derivedFrom: 'A', characterId: 'owner-a' } });
      expect(db.reference.mock.calls.at(-1)![0]).toBe('owner-a');
      await act(async () => slow.resolve(fixture(kind, 'B')));
      await expectContent(kind, 'B');
    });

    it('confirms a new owner and asset without Radix closing rolling the URL back', async () => {
      await mount(kind, '?assetId=A&characterId=owner-a');
      await dirty(kind);
      await go('?assetId=B&characterId=owner-b&view=grid');
      expect(dialog()).not.toBeNull();
      await click(button('确认加载', dialog()!));
      expect(dialog()).toBeNull();
      expect(query().get('assetId')).toBe('B');
      await expectContent(kind, 'B');
      await save(kind);
      expect(db[kind].save.mock.calls.at(-1)![0]).toMatchObject({ derived: { derivedFrom: 'B', characterId: 'owner-b' } });
      await go('?assetId=C');
      expect(dialog()).toBeNull();
      await expectContent(kind, 'C');
    });

    it('guards character-only identity changes', async () => {
      await mount(kind, '?assetId=A&characterId=owner-a');
      await dirty(kind);
      await go('?assetId=A&characterId=owner-b');
      expect(dialog()).not.toBeNull();
      await click(button('取消', dialog()!));
      await save(kind);
      expect(db.reference.mock.calls.at(-1)![0]).toBe('owner-a');
    });

    it('does not attach a late save result or clean baseline to B', async () => {
      await mount(kind, '?assetId=A&characterId=owner-a');
      const slow = deferred<void>();
      db[kind].save.mockReturnValueOnce(slow.promise);
      await save(kind);
      await go('?assetId=B');
      await expectContent(kind, 'B');
      const input = await dirty(kind);
      await act(async () => slow.resolve());
      expect(input.value).toBe('unsaved A');
      await save(kind);
      const saved = db[kind].save.mock.calls.at(-1)![0];
      expect(saved).toMatchObject({ id: 'B', title: 'Asset B' });
      expect(savedContent(kind, saved)).toBe('unsaved A');
    });

    it('restores A on missing asset and on failed loads', async () => {
      await mount(kind);
      db[kind].get.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('read failed'));
      await go('?assetId=missing&view=grid');
      expect(query().get('assetId')).toBe('A');
      await expectContent(kind, 'A');
      await go('?assetId=B&view=grid');
      expect(query().get('assetId')).toBe('A');
      expect(query().get('view')).toBe('grid');
      expect(db.toast.mock.calls.filter(([message]) => message.variant === 'destructive')).toHaveLength(2);
    });

    it('can cancel or accept clearing the identity without reviving the session', async () => {
      await mount(kind);
      const input = await dirty(kind);
      await go('?view=grid');
      expect(dialog()).not.toBeNull();
      await click(button('取消', dialog()!));
      expect(query().get('assetId')).toBe('A');
      expect(input.value).toBe('unsaved A');
      await go('?view=grid');
      await click(button('确认加载', dialog()!));
      expect(query().get('assetId')).toBeNull();
      expect(dialog()).toBeNull();
      if (kind === 'regex') expect(document.querySelector('[aria-label="展开编辑"]')).toBeNull();
      else expect(button('保存')).toBeUndefined();
      await go('?assetId=C');
      expect(dialog()).toBeNull();
      await expectContent(kind, 'C');
    });

    it('checks dirty state when the load finishes, including edits made during the read', async () => {
      await mount(kind);
      const slow = deferred<Item>();
      db[kind].get.mockReturnValue(slow.promise);
      await go('?assetId=B');
      const input = await dirty(kind);
      await act(async () => slow.resolve(fixture(kind, 'B')));
      expect(dialog()).not.toBeNull();
      expect(input.value).toBe('unsaved A');
    });

    it('invalidates a pending confirmation and a late response when returning to A', async () => {
      await mount(kind);
      const input = await dirty(kind);
      await go('?assetId=B');
      expect(dialog()).not.toBeNull();
      const slow = deferred<Item>();
      db[kind].get.mockReturnValue(slow.promise);
      await go('?assetId=C');
      expect(dialog()).toBeNull();
      await go('?assetId=A&view=grid');
      await act(async () => slow.resolve(fixture(kind, 'C')));
      expect(dialog()).toBeNull();
      expect(input.value).toBe('unsaved A');
      expect(db[kind].get.mock.calls.map(([id]) => id)).toEqual(['A', 'B', 'C']);
    });

    it('a save started during B loading cannot update B after B is accepted', async () => {
      await mount(kind, '?assetId=A&characterId=owner-a');
      const load = deferred<Item>();
      const write = deferred<void>();
      db[kind].get.mockReturnValueOnce(load.promise);
      db[kind].save.mockReturnValueOnce(write.promise);
      await go('?assetId=B');
      await save(kind);
      await act(async () => load.resolve(fixture(kind, 'B')));
      await expectContent(kind, 'B');
      await act(async () => write.resolve());
      await save(kind);
      expect(db[kind].save.mock.calls.at(-1)![0]).toMatchObject({ id: 'B', title: 'Asset B' });
    });

    it('keeps edits made during a save dirty', async () => {
      await mount(kind);
      const write = deferred<void>();
      db[kind].save.mockReturnValueOnce(write.promise);
      await save(kind);
      await dirty(kind);
      await act(async () => write.resolve());
      await go('?assetId=B');
      if (kind === 'worldbook') {
        // Autosave drains edits made during an in-flight write before navigation.
        expect(db[kind].save).toHaveBeenCalledTimes(2);
        expect(savedContent(kind, db[kind].save.mock.calls.at(-1)![0])).toBe('unsaved A');
        await expectContent(kind, 'B');
      } else expect(dialog()).not.toBeNull();
    });

    it('a rejected save preserves the draft and its dirty baseline', async () => {
      await mount(kind);
      const input = await dirty(kind);
      db[kind].save.mockRejectedValueOnce(new Error('write refused'));
      await save(kind);
      expect(input.value).toBe('unsaved A');
      await go('?assetId=B');
      expect(dialog()).not.toBeNull();
      await click(button('取消', dialog()!));
      expect(query().get('assetId')).toBe('A');
      expect(db[kind].save.mock.calls[0][0].id).toBe('A');
    });

    it('ordinary query changes during confirmation preserve the target and rollback parameters', async () => {
      await mount(kind);
      await dirty(kind);
      await go('?assetId=B&view=list');
      expect(dialog()).not.toBeNull();
      await go('?assetId=B&view=grid&custom=keep');
      expect(db[kind].get.mock.calls.map(([id]) => id)).toEqual(['A', 'B']);
      await click(button('取消', dialog()!));
      expect(query().get('assetId')).toBe('A');
      expect(query().get('view')).toBe('grid');
      expect(query().get('custom')).toBe('keep');
    });

    it('retains first-mount session recovery without identity query', async () => {
      const item = fixture(kind, 'A');
      if (kind === 'worldbook') sessionStorage.setItem('wb-active-session', JSON.stringify({ worldbook: (item as WorldBookItem).worldbook, filename: item.title, currentItemId: item.id }));
      else if (kind === 'preset') sessionStorage.setItem('preset-active-session', JSON.stringify({ itemId: item.id }));
      else localStorage.setItem('st-beautifier-custom-regex', JSON.stringify((item as RegexCollectionItem).rules));
      await mount(kind, '', true);
      if (kind === 'regex') expect(document.body.textContent).toContain('Rule A');
      else await expectContent(kind, 'A');
      await go('?assetId=B');
      expect(dialog()).toBeNull();
      await expectContent(kind, 'B');
    });

    it('a slow initial handoff cannot replace a later URL asset in StrictMode', async () => {
      const read = deferred<string>();
      const file = new File([], 'handoff.json', { lastModified: 1 });
      Object.defineProperty(file, 'text', { value: () => read.promise });
      setPendingToolFile(kind, file);
      await mount(kind, '', true);
      await go('?assetId=B');
      await expectContent(kind, 'B');
      const item = fixture(kind, 'A');
      const data = kind === 'worldbook' ? (item as WorldBookItem).worldbook
        : kind === 'preset' ? { prompts: (item as PresetItem).preset.prompts }
        : [{ id: 'imported', scriptName: 'Rule A', findRegex: 'A', replaceString: '', placement: [1, 2] }];
      await act(async () => read.resolve(JSON.stringify(data)));
      await expectContent(kind, 'B');
      expect(db[kind].save).not.toHaveBeenCalled();
      expect(dialog()).toBeNull();
    });

    it('a stale failed load neither reports an error nor rolls C back', async () => {
      await mount(kind);
      const load = deferred<Item>();
      db[kind].get.mockReturnValueOnce(load.promise);
      await go('?assetId=B');
      await go('?assetId=C');
      db.toast.mockClear();
      await act(async () => load.reject(new Error('old read failed')));
      expect(query().get('assetId')).toBe('C');
      await expectContent(kind, 'C');
      expect(db.toast).not.toHaveBeenCalled();
    });

    it('finishing a library deletion for A cannot detach the accepted B from its save ID', async () => {
      await mount(kind);
      if (kind === 'worldbook') {
        await click(Array.from(document.querySelectorAll('button')).find((element) => element.textContent?.includes('最近打开')));
        const row = Array.from(document.querySelectorAll('button')).find((element) => element.textContent?.includes('Asset A'))!;
        await click(row.parentElement!.querySelector('button[aria-label="从资产库删除"]'));
      } else if (kind === 'preset') {
        await click(button('已存预设'));
        const row = document.querySelector('button[title="Asset A"]')!;
        await click(button('删除', row.parentElement!));
      } else {
        const row = document.querySelector('span[title="Asset A"]')!;
        await click(row.parentElement!.querySelector('button[title="删除"]'));
      }
      const removal = deferred<void>();
      db[kind].remove.mockReturnValueOnce(removal.promise);
      await click(button('确认删除', dialog()!));
      expect(db[kind].remove).toHaveBeenCalledWith('A', { deleteFiles: false });
      await go('?assetId=B');
      await act(async () => removal.resolve());
      await save(kind);
      expect(db[kind].save.mock.calls.at(-1)![0].id).toBe('B');
    });
  });
}
