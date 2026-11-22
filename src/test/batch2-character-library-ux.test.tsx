import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterHeader } from '@/components/character/CharacterHeader';
import { CharacterCardEditSection } from '@/components/character/CharacterCardEditSection';
import { NotesBrowser } from '@/components/character/NotesBrowser';
import { LibraryFilterRail } from '@/components/library/LibraryFilterRail';
import { editsFromNormalized } from '@/lib/card-export';
import { normalizeCharacterCard } from '@/lib/adapters/st';
import { buildLibraryFilterSections, buildManagedTagOptions, normalizeLibraryTagPreferences } from '@/lib/library-tag-preferences';
import { createMemFs } from '@/lib/vault/fs';
import { createVault, type VaultBackend } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import type { ArchiveCharacter } from '@/types/archive';
import type { WorldBookItem } from '@/types/worldbook';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Batch 2 character detail & library slimdown', () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;
  let vault: VaultBackend;

  beforeEach(() => {
    localStorage.clear();
    vault = createVault(createMemFs());
    setActiveVault(vault);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    host?.remove();
    host = null;
    setActiveVault(null);
  });

  it('CharacterHeader shows inline equipment badges only when actually equipped and routes to assets tab', async () => {
    const bareChar: ArchiveCharacter = {
      id: 'char-bare',
      name: '七濑胡桃',
      card: { name: '七濑胡桃', creator: 'mirrorange', description: '日常陪伴' },
      tags: [],
      status: '未开始',
      createdAt: 1,
      updatedAt: 1,
    };
    const bareNorm = normalizeCharacterCard(bareChar.card);

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <CharacterHeader character={bareChar} norm={bareNorm} onPatch={vi.fn()} />
        </MemoryRouter>,
      );
    });
    await act(async () => { await Promise.resolve(); });

    expect(host!.querySelector('[data-header-loadout]')).toBeNull();
    expect(host!.textContent).not.toContain('未挂世界书');
    expect(host!.textContent).not.toContain('默认预设');
    expect(host!.textContent).not.toContain('当前装备');

    await vault.repo<WorldBookItem>('worldbooks').put({
      id: 'wb-daily',
      title: '日常系统',
      worldbook: { entries: {} },
      createdAt: 1,
      updatedAt: 1,
    });
    const equippedChar: ArchiveCharacter = {
      ...bareChar,
      id: 'char-equipped',
      assets: [{ kind: 'worldbook', assetId: 'wb-daily', relations: ['primary'] }],
    };
    const onSelectTab = vi.fn();

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <CharacterHeader character={equippedChar} norm={bareNorm} onPatch={vi.fn()} onSelectTab={onSelectTab} />
        </MemoryRouter>,
      );
    });
    await act(async () => { await Promise.resolve(); });

    const loadout = host!.querySelector('[data-header-loadout]');
    expect(loadout).not.toBeNull();
    expect(loadout!.textContent).toContain('日常系统');
    const wbBadge = loadout!.querySelector('button');
    await act(async () => { wbBadge!.click(); });
    expect(onSelectTab).toHaveBeenCalledWith('assets');
  });

  it('CharacterCardEditSection defaults to comfortable read mode and supports preview return & discard', async () => {
    const norm = normalizeCharacterCard({
      name: '艾莉娅',
      description: '北方雪原的守林少女。',
      scenario: '暴风雪初晴的木屋。',
    });
    const edits = editsFromNormalized(norm);
    const onSave = vi.fn().mockResolvedValue(true);
    const onDiscard = vi.fn();

    await act(async () => {
      root!.render(
        <CharacterCardEditSection
          edits={edits}
          displayName=""
          dirty={false}
          onEditChange={vi.fn()}
          onDisplayNameChange={vi.fn()}
          onSave={onSave}
          onDiscard={onDiscard}
          saving={false}
        />,
      );
    });

    expect(host!.querySelectorAll('textarea')).toHaveLength(0);
    expect(host!.textContent).toContain('北方雪原的守林少女。');

    const editBtn = Array.from(host!.querySelectorAll('button')).find((b) => b.textContent?.includes('编辑设定'));
    expect(editBtn).toBeTruthy();
    await act(async () => { editBtn!.click(); });

    expect(host!.querySelectorAll('textarea').length).toBeGreaterThan(0);
    expect(host!.textContent).toContain('返回预览');

    await act(async () => {
      root!.render(
        <CharacterCardEditSection
          edits={{ ...edits, description: '误改草稿' }}
          displayName=""
          dirty
          onEditChange={vi.fn()}
          onDisplayNameChange={vi.fn()}
          onSave={onSave}
          onDiscard={onDiscard}
          saving={false}
        />,
      );
    });

    const discardBtn = Array.from(host!.querySelectorAll('button')).find((b) => b.textContent?.includes('放弃修改'));
    expect(discardBtn).toBeTruthy();
    await act(async () => { discardBtn!.click(); });
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(host!.querySelectorAll('textarea')).toHaveLength(0);

    const reopenBtn = Array.from(host!.querySelectorAll('button')).find((b) => b.textContent?.includes('编辑设定'));
    await act(async () => { reopenBtn!.click(); });
    const saveBtn = Array.from(host!.querySelectorAll('button')).find((b) => b.textContent?.includes('保存修改'));
    await act(async () => { saveBtn!.click(); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(host!.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('NotesBrowser hides redundant navigation rail when there is a single note without headings', async () => {
    await act(async () => {
      root!.render(
        <NotesBrowser
          characterId="c1"
          notes={[{ id: 'n1', at: 1000, body: '一句简短的玩卡心得。' }]}
          onCreate={vi.fn()}
          onEdit={vi.fn()}
        />,
      );
    });
    expect(host!.querySelector('aside[aria-label="备注导航"]')).toBeNull();
    expect(host!.textContent).toContain('一句简短的玩卡心得');
  });

  it('LibraryFilterRail defaults to 248px and exposes sticky active filter strip with one-click clear', async () => {
    const onClearAll = vi.fn();
    const sections = buildLibraryFilterSections(
      buildManagedTagOptions(['人物/少女'], normalizeLibraryTagPreferences(undefined)),
      false,
    );

    await act(async () => {
      root!.render(
        <LibraryFilterRail
          typeOptions={[{ value: '人物', label: '人物', count: 3 }]}
          unclassifiedCount={0}
          activeType="人物"
          sections={sections}
          activeTags={{ 人物: ['人物/少女'] }}
          uncategorizedExpanded={false}
          onTypeChange={vi.fn()}
          onTagToggle={vi.fn()}
          onUncategorizedExpandedChange={vi.fn()}
          onClearAll={onClearAll}
        />,
      );
    });

    const rail = host!.querySelector<HTMLElement>('[data-library-filter-rail]')!;
    expect(rail.style.width).toBe('248px');
    const activeStrip = host!.querySelector('[data-library-active-filters]');
    expect(activeStrip).not.toBeNull();
    expect(activeStrip!.textContent).toContain('少女');
    const clearBtn = Array.from(activeStrip!.querySelectorAll('button')).find((b) => b.textContent?.includes('一键清空'));
    await act(async () => { clearBtn!.click(); });
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});
