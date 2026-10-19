/**
 * 立绘按需加载。
 *
 * 以前打开立绘 tab 就把整个立绘库读成 data URL 一次性载入——50 张立绘的角色
 * 页面一打开就是 50 次读盘 + 50 张全分辨率解码。现在视图只带路径，
 * 缩略图滚进可视区才取字节。
 *
 * 所以断言的是**读了几次盘**，不是渲染出什么：字段对不对不能证明省下了 IO。
 */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB } from '@/lib/idb';
import { PortraitSection } from '@/components/character/PortraitSection';
import { createMemFs, type VaultFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { getCharacter, saveCharacter, updateCharacter } from '@/lib/archive-db';
import { commitCharacterPatch } from '@/lib/character-write';
import { addPortraitFiles, createPortraitRow, loadPortraitViews, loadPortraitImage } from '@/lib/portrait-store';
import type { ArchiveCharacter } from '@/types/archive';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------- 可控的 IntersectionObserver（jsdom 没有）----------

/** 元素 → 触发一次「进入可视区」；由测试自己决定什么时候滚到 */
const observed = new Map<Element, () => void>();

class IntersectionObserverStub {
  private mine: Element[] = [];
  constructor(private cb: (entries: { isIntersecting: boolean; target: Element }[]) => void) {}
  observe(el: Element) {
    this.mine.push(el);
    observed.set(el, () => this.cb([{ isIntersecting: true, target: el }]));
  }
  unobserve(el: Element) { observed.delete(el); }
  disconnect() {
    for (const el of this.mine) observed.delete(el);
    this.mine = [];
  }
  takeRecords() { return []; }
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);

// ---------- 库与角色 ----------

/** 最小合法 PNG 的字节其实无所谓：这里只走读写，不解码 */
const pngFile = (name: string) => new File([Uint8Array.from([1, 2, 3])], name, { type: 'image/png' });

/** 包一层数读盘次数——省下的 IO 只有计数能证明 */
function countingFs(): { fs: VaultFs; reads: string[] } {
  const fs = createMemFs();
  const reads: string[] = [];
  const inner = fs.readBinary.bind(fs);
  fs.readBinary = async (path: string) => {
    reads.push(path);
    return inner(path);
  };
  return { fs, reads };
}

/** 建一个「日常」行里有 3 张立绘的角色，返回读盘计数（已归零） */
async function setupCharacter(): Promise<{ character: ArchiveCharacter; reads: string[]; fs: VaultFs }> {
  const { fs, reads } = countingFs();
  setActiveVault(createVault(fs));
  const base: ArchiveCharacter = {
    id: 'c1', name: '奏枝', card: { name: '奏枝' } as ArchiveCharacter['card'],
    tags: [], status: '未开始', createdAt: 1, updatedAt: 1,
  };
  await saveCharacter(base);
  const rowPatch = await createPortraitRow(base, '日常');
  const withRow = { ...base, ...rowPatch } as ArchiveCharacter;
  const added = await addPortraitFiles(withRow, withRow.portraitRows![0].id, [
    pngFile('a.png'), pngFile('b.png'), pngFile('c.png'),
  ]);
  expect(added.ok).toBe(3);
  reads.length = 0;
  return { character: { ...withRow, ...added.patch } as ArchiveCharacter, reads, fs };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  closeDB();
  globalThis.indexedDB = new IDBFactory();
  observed.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setActiveVault(null);
  closeDB();
});

async function renderSection(character: ArchiveCharacter) {
  await act(async () => {
    root.render(
      <PortraitSection
        character={character}
        onPatch={async () => character}
        onOpenImport={() => {}}
      />,
    );
  });
}

const thumbs = () => Array.from(container.querySelectorAll<HTMLElement>('[data-portrait-thumb]'));

describe('portrait deletion confirmation', () => {
  const alert = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
  const button = (label: string) => Array.from(alert()!.querySelectorAll('button')).find(entry => entry.textContent?.trim() === label)!;
  const checkbox = () => alert()?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  async function openDelete() {
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="删除立绘"]')!.click(); });
  }

  it('defaults source deletion off and keeps failures visible for retry', async () => {
    const { character } = await setupCharacter();
    const onPatch = vi.fn(async () => { throw new Error('保存失败，请重试'); });
    await act(async () => root.render(<PortraitSection character={character} onOpenImport={() => {}} onPatch={onPatch} />));
    await openDelete();
    expect(checkbox()).not.toBeNull();
    expect(checkbox()!.checked).toBe(false);
    expect(alert()!.textContent).toContain('同时删除 STE 库内文件');
    await act(async () => { button('确认删除').click(); });
    expect(alert()).not.toBeNull();
    expect(alert()!.querySelector('[role="alert"]')?.textContent).toContain('保存失败，请重试');
    expect(button('确认删除').disabled).toBe(false);
  });

  it('holds the dialog open and prevents repeated submissions while saving', async () => {
    const { character } = await setupCharacter();
    let release!: (value: ArchiveCharacter) => void;
    const onPatch = vi.fn(() => new Promise<ArchiveCharacter>(resolve => { release = resolve; }));
    await act(async () => root.render(<PortraitSection character={character} onOpenImport={() => {}} onPatch={onPatch} />));
    await openDelete();
    await act(async () => { button('确认删除').click(); });
    expect(button('删除中…').disabled).toBe(true);
    expect(button('取消').disabled).toBe(true);
    expect(checkbox()!.disabled).toBe(true);
    expect(onPatch).toHaveBeenCalledOnce();
    await act(async () => { release(character); });
    expect(alert()).toBeNull();
  });

  it('does not present a filesystem option for inline storage', async () => {
    const { character } = await setupCharacter();
    setActiveVault(null);
    character.portraitRows![0].items.forEach(item => { item.dataBase64 = 'AQID'; item.fileName = undefined; });
    await renderSection(character);
    await openDelete();
    expect(checkbox()).toBeNull();
    expect(alert()!.textContent).not.toContain('回收站');
  });
});

/** 把某张缩略图滚进可视区 */
async function scrollTo(name: string) {
  const el = thumbs().find((t) => t.dataset.portraitThumb === name);
  if (!el) throw new Error(`页面上没有缩略图 ${name}`);
  const fire = observed.get(el);
  if (!fire) throw new Error(`缩略图 ${name} 没有被 IntersectionObserver 观察`);
  await act(async () => { fire(); });
}

describe('立绘视图不读图片字节', () => {
  it('loadPortraitViews 只给路径，一次 readBinary 都不发', async () => {
    const { character, reads } = await setupCharacter();
    const views = await loadPortraitViews(character);

    expect(views[0].items).toHaveLength(3);
    expect(views[0].items.map((i) => i.fsPath)).toEqual([
      '角色/奏枝/立绘/日常/a.png', '角色/奏枝/立绘/日常/b.png', '角色/奏枝/立绘/日常/c.png',
    ]);
    expect(views[0].items.every((i) => i.url === undefined)).toBe(true);
    expect(reads).toEqual([]);
  });

  it('loadPortraitImage 按需读出 data URL；文件不在了返回 null 而不是抛', async () => {
    const { character, reads } = await setupCharacter();
    const [first] = (await loadPortraitViews(character))[0].items;

    expect(await loadPortraitImage(first)).toMatch(/^data:image\/png;base64,/);
    expect(reads).toEqual(['角色/奏枝/立绘/日常/a.png']);
    expect(await loadPortraitImage({ ...first, fsPath: '角色/奏枝/立绘/日常/没了.png' })).toBeNull();
  });

  it('记录条目的文件被用户挪走后不再展示，也不额外发 IO 去探', async () => {
    const { character, reads, fs } = await setupCharacter();
    // b.png 被用户在文件管理器里挪走，条目仍留在 档案.json
    await fs.removeFile('角色/奏枝/立绘/日常/b.png');

    const views = await loadPortraitViews(character);
    expect(views[0].items.map((i) => i.name)).toEqual(['a.png', 'c.png']);
    expect(reads).toEqual([]);
  });
});

describe('缩略图滚进可视区才加载', () => {
  it('渲染完成时三张都还没读盘，滚到第一张只读第一张', async () => {
    const { character, reads } = await setupCharacter();
    await renderSection(character);

    expect(thumbs()).toHaveLength(3);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(reads).toEqual([]);

    await scrollTo('a.png');
    expect(reads).toEqual(['角色/奏枝/立绘/日常/a.png']);
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toMatch(/^data:image\/png;base64,/);

    // 其余两张还在等自己被滚到
    await scrollTo('c.png');
    expect(reads).toEqual(['角色/奏枝/立绘/日常/a.png', '角色/奏枝/立绘/日常/c.png']);
    expect(container.querySelectorAll('img')).toHaveLength(2);
  });

  it('同一张滚过一次就不再重复读', async () => {
    const { character, reads } = await setupCharacter();
    await renderSection(character);

    await scrollTo('a.png');
    expect(reads).toHaveLength(1);
    // 观察已解除，再滚也不该触发第二次读
    expect(observed.has(thumbs().find((t) => t.dataset.portraitThumb === 'a.png')!)).toBe(false);
  });

  it('读不到图片时说出来，而不是留个点不动的空框', async () => {
    const { character, fs } = await setupCharacter();
    await renderSection(character);
    await fs.removeFile('角色/奏枝/立绘/日常/a.png'); // 视图建好之后才被挪走

    await scrollTo('a.png');
    const thumb = thumbs().find((t) => t.dataset.portraitThumb === 'a.png')!;
    expect(thumb.textContent).toContain('读不到图片');
  });
});

describe('网页版内嵌立绘', () => {
  it('dataBase64 已在记录里，不用等滚动就能显示', async () => {
    setActiveVault(null); // 网页版：无 vault
    const character: ArchiveCharacter = {
      id: 'c1', name: '奏枝', card: { name: '奏枝' } as ArchiveCharacter['card'],
      tags: [], status: '未开始', createdAt: 1, updatedAt: 1,
      portraitRows: [{
        id: 'r1', title: '日常',
        items: [{ id: 'p1', source: 'manual', name: 'a.png', mime: 'image/png', dataBase64: 'AQID', addedAt: 1 }],
      }],
    };
    await renderSection(character);

    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe('data:image/png;base64,AQID');
  });
});

describe('persisted replacement in an open lightbox', () => {
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
  const dialogImage = () => dialog()?.querySelector('img');
  const dialogButton = (label: string) => Array.from(dialog()!.querySelectorAll('button'))
    .find(button => button.textContent?.trim() === label)!;

  async function editingSection(inline = false) {
    const fixture = await setupCharacter();
    const character = structuredClone(fixture.character);
    if (inline) {
      for (const item of character.portraitRows![0].items) {
        item.dataBase64 = 'AQID';
        item.fileName = undefined;
      }
      setActiveVault(null);
    }
    await saveCharacter(character);
    let pending: Promise<ArchiveCharacter> | undefined;
    function Harness() {
      const [current, setCurrent] = useState(character);
      return <PortraitSection character={current} onOpenImport={() => {}} onPatch={patch => {
        pending = commitCharacterPatch(current.id, patch, updateCharacter, setCurrent);
        return pending;
      }} />;
    }
    await act(async () => root.render(<Harness />));
    if (!inline) await scrollTo('a.png');
    await act(async () => { thumbs().find(thumb => thumb.dataset.portraitThumb === 'a.png')!.click(); });
    expect(dialogImage()?.getAttribute('src')).toBe('data:image/png;base64,AQID');
    return { ...fixture, character, pending: () => pending! };
  }

  async function replaceOpenImage() {
    await act(async () => { dialogButton('替换').click(); });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['replacement'], 'new.png', { type: 'image/png' })], configurable: true });
    act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
  }

  it.each([false, true])('refreshes the open image, item name, and thumbnail after saving (inline=%s)', async inline => {
    const fixture = await editingSection(inline);
    await replaceOpenImage();
    await act(async () => { await fixture.pending(); });
    expect(dialogImage()?.getAttribute('src')).toBe(`data:image/png;base64,${btoa('replacement')}`);
    expect(dialogImage()?.alt).toBe('new.png');
    if (!inline) await scrollTo('new.png');
    const thumb = thumbs().find(item => item.dataset.portraitThumb === 'new.png')!;
    expect(thumb.querySelector('img')?.getAttribute('src')).toBe(`data:image/png;base64,${btoa('replacement')}`);
    expect((await getCharacter(fixture.character.id))?.portraitRows?.[0].items[0].name).toBe('new.png');
  });

  it('leaves the old lightbox and thumbnail intact when persistence fails', async () => {
    const fixture = await editingSection();
    const writeText = fixture.fs.writeText;
    fixture.fs.writeText = async (path, content) => {
      if (path.endsWith('/档案.json')) throw new Error('profile failure');
      return writeText(path, content);
    };
    await replaceOpenImage();
    await act(async () => { await expect(fixture.pending()).rejects.toThrow('profile failure'); });
    expect(dialogImage()?.getAttribute('src')).toBe('data:image/png;base64,AQID');
    expect(dialogImage()?.alt).toBe('a.png');
    expect(thumbs().map(item => item.dataset.portraitThumb)).toEqual(['a.png', 'b.png', 'c.png']);
  });

  it.each(['close', 'next'])('does not overwrite a later lightbox action while saving: %s', async action => {
    const fixture = await editingSection();
    const writeText = fixture.fs.writeText;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    fixture.fs.writeText = async (path, content) => {
      if (path.endsWith('/档案.json')) await barrier;
      return writeText(path, content);
    };
    await replaceOpenImage();
    await act(async () => {
      if (action === 'close') dialogButton('关闭').click();
      else dialog()!.querySelector<HTMLButtonElement>('[aria-label="下一张"]')!.click();
    });
    await act(async () => { release(); await fixture.pending(); });
    if (action === 'close') expect(dialog()).toBeNull();
    else expect(dialogImage()?.alt).toBe('b.png');
  });
});
