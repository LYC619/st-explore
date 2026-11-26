import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@/lib/i18n';
import type { StoryIndexEntry } from '@/lib/archive-index';
import type { ArchiveCharacter } from '@/types/archive';
import { normalizeLibraryTagPreferences, type LibraryTagPreferences } from '@/lib/library-tag-preferences';
import { buildPresetExportFiles } from '@/lib/preset-package';
import { blockDisplayName, type PresetItem } from '@/types/preset';
import * as archiveDb from '@/lib/archive-db';
import { ReviewStoryList } from './review/ReviewStoryList';
import { TagManagerDialog } from './TagManagerDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Library & preset i18n regressions', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setLocale('en');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    setLocale('zh-CN');
  });

  it('ReviewStoryList renders existing Chinese status in English and persists canonical Chinese StoryStatus', async () => {
    const updateSpy = vi.spyOn(archiveDb, 'updateArchiveStory').mockImplementation(async (id, updater) => {
      const current = { id, status: '进行中', updatedAt: 1 } as never;
      const patch = await updater(current);
      return { ...(current as object), ...(patch as object) } as never;
    });
    const onStoriesChange = vi.fn().mockResolvedValue(undefined);
    const story: StoryIndexEntry = {
      id: 'story-1',
      characterId: 'char-1',
      title: 'Starlight Route',
      markers: [],
      floorCount: 12,
      status: '进行中',
      createdAt: 1,
      updatedAt: 1,
      meta: { modelsUsed: [], playTimeMs: null },
    };

    await act(async () => {
      root.render(
        <ReviewStoryList
          stories={[story]}
          onRead={vi.fn()}
          onStoriesChange={onStoriesChange}
        />,
      );
    });

    const select = host.querySelector<HTMLSelectElement>('select')!;
    expect(select).toBeTruthy();
    expect(select.value).toBe('进行中');
    expect(select.selectedOptions[0]?.textContent).toBe('In progress');
    expect(host.textContent).toContain('In progress');
    expect(host.textContent).not.toContain('12 · Not started');

    const completedOption = [...select.options].find((opt) => opt.textContent === 'Completed')!;
    expect(completedOption).toBeTruthy();
    expect(completedOption.value).toBe('已完结');

    await act(async () => {
      select.value = completedOption.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const saveBtn = [...host.querySelectorAll('button')].find((btn) => btn.textContent?.trim() === 'Save status')!;
    expect(saveBtn).toBeTruthy();
    await act(async () => {
      saveBtn.click();
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const persistedPatch = await updateSpy.mock.calls[0][1]({ id: 'story-1', status: '进行中' } as never);
    expect(persistedPatch).toMatchObject({ status: '已完结' });
    expect((persistedPatch as { status?: string }).status).not.toBe('Completed');
  });

  it('TagManagerDialog keeps Type tab active in English and toggles canonical 类型/人物 chat visibility', async () => {
    const characters: ArchiveCharacter[] = [
      {
        id: 'c1',
        name: 'Lyra',
        card: { name: 'Lyra', description: '' },
        tags: [],
        type: '人物',
        status: '未开始',
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    let currentPrefs: LibraryTagPreferences = {
      ...normalizeLibraryTagPreferences(undefined),
      chatVisible: ['类型/人物'],
    };
    const onPreferencesChange = vi.fn(async (next: LibraryTagPreferences) => {
      currentPrefs = next;
    });

    await act(async () => {
      root.render(
        <TagManagerDialog
          open
          initialCategory="类型"
          onOpenChange={vi.fn()}
          characters={characters}
          selectedCharacters={characters}
          preferences={currentPrefs}
          onPreferencesChange={onPreferencesChange}
          onChanged={vi.fn()}
        />,
      );
    });

    const typeGrid = document.body.querySelector('[data-managed-type-grid]');
    expect(typeGrid).not.toBeNull();
    expect(typeGrid?.textContent).toContain('Character');

    const characterSwitch = document.body.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Show type Character in chats"]',
    )!;
    expect(characterSwitch).toBeTruthy();
    expect(characterSwitch.getAttribute('aria-checked')).toBe('true');

    await act(async () => {
      characterSwitch.click();
    });

    expect(onPreferencesChange).toHaveBeenCalledTimes(1);
    expect(currentPrefs.chatVisible).not.toContain('类型/人物');
    expect(currentPrefs.chatVisible).not.toContain('Type/Character');
  });

  it('buildPresetExportFiles keeps archive paths locale-invariant and blockDisplayName avoids Scenario · Scenario', () => {
    const preset: PresetItem = {
      id: 'preset-1',
      title: 'Aurora',
      createdAt: 1,
      updatedAt: 1,
      preset: {
        prompts: [],
        promptOrder: [],
        regexRules: [],
        hasRegexExtension: false,
        originalData: { temperature: 0.8 },
      },
      packageFiles: [
        { id: 'f1', name: 'clean.json', kind: 'regex', text: '{"findRegex":"a","replaceString":"b"}' },
        { id: 'f2', name: 'helper.js', kind: 'script', text: '// script' },
        { id: 'f3', name: 'readme.md', kind: 'notes', text: '# Notes' },
        { id: 'f4', name: 'extra.json', kind: 'other', text: '{}' },
      ],
    };

    setLocale('zh-CN');
    const zhFiles = buildPresetExportFiles(preset);
    expect(blockDisplayName({ identifier: 'scenario', name: 'Scenario', marker: true })).toBe('场景 · Scenario');

    setLocale('en');
    const enFiles = buildPresetExportFiles(preset);
    expect(Object.keys(enFiles).sort()).toEqual(Object.keys(zhFiles).sort());
    expect(enFiles).toEqual(zhFiles);
    expect(Object.keys(enFiles)).toContain('附带/正则/clean.json');
    expect(Object.keys(enFiles)).toContain('附带/脚本/helper.js');
    expect(Object.keys(enFiles)).toContain('附带/说明/readme.md');
    expect(Object.keys(enFiles)).toContain('附带/其他文件/extra.json');
    expect(blockDisplayName({ identifier: 'scenario', name: 'Scenario', marker: true })).toBe('Scenario');
  });
});
