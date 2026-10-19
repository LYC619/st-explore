import { describe, expect, it } from 'vitest';
import type { ArchiveCharacter } from '@/types/archive';
import { filterCharacters, toggleTagFilter, type LibraryFilterState } from '@/lib/library-query';
import {
  buildLibraryFilterSections,
  buildManagedTagOptions,
  normalizeLibraryTagPreferences,
  scopeLibraryTagOptions,
} from '@/lib/library-tag-preferences';

function character(id: string, extra: Partial<ArchiveCharacter> = {}): ArchiveCharacter {
  return { id, name: id, card: {}, tags: [], createdAt: 1, updatedAt: 1, ...extra } as ArchiveCharacter;
}

const preferences = normalizeLibraryTagPreferences({
  version: 1,
  customCategories: ['作者'],
  customTags: ['作者/未使用'],
  categoryOrder: ['剧情', '评价', '作者'],
  order: ['剧情/悬疑', '作者/某人', '评价/精品'],
  hidden: ['人物/少女'],
});

function plotLibrary() {
  const characters = [
    ...Array.from({ length: 18 }, (_, index) => character(`plot-${index}`, {
      name: index < 3 ? `Sun ${index}` : `Moon ${index}`,
      type: '剧情',
      rating: index < 6 ? 8 : 6.5,
      tags: ['剧情/悬疑', '作者/某人'],
    })),
    ...Array.from({ length: 6 }, (_, index) => character(`other-${index}`, {
      name: `Sun other ${index}`,
      type: '人物',
      rating: 8,
      tags: ['剧情/悬疑', '其他类型专属'],
    })),
    character('unclassified', { rating: 9, tags: ['无类型专属'] }),
  ];
  const options = buildManagedTagOptions(characters.flatMap(item => item.tags), preferences, characters);
  return { characters, options };
}

describe('library scoped facet counts', () => {
  it('counts six premium cards among eighteen plot cards without narrowing by selected tags', () => {
    const { characters, options } = plotLibrary();
    const filters: LibraryFilterState = { search: '', type: '剧情', tags: { 评价: ['评价/精品'] } };
    const scoped = scopeLibraryTagOptions(options, characters, filters);

    expect(scoped.find(item => item.raw === '评价/精品')?.count).toBe(6);
    expect(scoped.find(item => item.raw === '剧情/悬疑')?.count).toBe(18);
    expect(scoped.find(item => item.raw === '其他类型专属')?.count).toBe(0);
    expect(filterCharacters(characters, filters)).toHaveLength(6);
    const otherSelection: LibraryFilterState = { ...filters, tags: { 评价: ['评价/神作'] } };
    expect(scopeLibraryTagOptions(options, characters, otherSelection))
      .toEqual(scoped);
    expect(options.find(item => item.raw === '评价/精品')?.count).toBe(12);
  });

  it('combines the current type with the same search rules used by the card list', () => {
    const { characters, options } = plotLibrary();
    const scoped = scopeLibraryTagOptions(options, characters, { search: '  sUn  ', type: '剧情' });

    expect(scoped.find(item => item.raw === '评价/精品')?.count).toBe(3);
    expect(scoped.find(item => item.raw === '剧情/悬疑')?.count).toBe(3);
    expect(scoped.find(item => item.raw === '其他类型专属')?.count).toBe(0);
    const byTag = scopeLibraryTagOptions(options, characters, { search: '作者/某人', type: 'all' });
    expect(byTag.find(item => item.raw === '剧情/悬疑')?.count).toBe(18);
  });

  it('supports the unclassified type and restores global counts for all types', () => {
    const { characters, options } = plotLibrary();
    const none = scopeLibraryTagOptions(options, characters, { search: '', type: 'none' });
    expect(none.find(item => item.raw === '无类型专属')?.count).toBe(1);
    expect(none.find(item => item.raw === '评价/神作')?.count).toBe(1);
    expect(none.find(item => item.raw === '剧情/悬疑')?.count).toBe(0);
    expect(scopeLibraryTagOptions(options, characters, { search: '', type: 'all' })).toEqual(options);
  });

  it('preserves definitions, custom categories, ordering and visibility when a search has no matches', () => {
    const { characters, options } = plotLibrary();
    const original = structuredClone(options);
    const scoped = scopeLibraryTagOptions(options, characters, { search: 'missing', type: '剧情' });

    expect(scoped).toEqual(options.map(item => ({ ...item, count: 0 })));
    expect(scoped.find(item => item.raw === '作者/未使用')).toMatchObject({ category: '作者', count: 0 });
    expect(scoped.find(item => item.raw === '人物/少女')?.visible).toBe(false);
    expect(options).toEqual(original);
  });

  it('counts each character once per normalized label and derives rating tiers from actual ratings', () => {
    const characters = [
      character('low', { rating: 0, tags: ['评价/低创', '评价/6分以下', '剧情/悬疑', '剧情/悬疑', ' 剧情/悬疑 ', '作者/某人', '作者/某人'] }),
      character('premium', { rating: 8, tags: ['评价/低创', '评价/精品', '评价/精品', '剧情/悬疑'] }),
      character('unrated', { tags: ['评价/低创', '评价/6分以下', '评价/未评分', '旧标签', '旧标签'] }),
    ];
    const options = buildManagedTagOptions(characters.flatMap(item => item.tags), preferences, characters);
    const scoped = scopeLibraryTagOptions(options, characters, { search: '', type: 'all' });

    expect(scoped.find(item => item.raw === '剧情/悬疑')?.count).toBe(2);
    expect(scoped.find(item => item.raw === '作者/某人')?.count).toBe(1);
    expect(scoped.find(item => item.raw === '旧标签')?.count).toBe(1);
    expect(scoped.find(item => item.raw === '评价/6分以下')?.count).toBe(1);
    expect(scoped.find(item => item.raw === '评价/精品')?.count).toBe(1);
    expect(scoped.find(item => item.raw === '评价/未评分')?.count).toBe(1);
    expect(scoped.some(item => item.raw === '评价/低创')).toBe(false);
  });
});

describe('selected zero-count facets', () => {
  it('keeps selected built-in and custom labels visible and cancellable when unused labels are hidden', () => {
    const { characters, options } = plotLibrary();
    const scoped = scopeLibraryTagOptions(options, characters, { search: 'missing', type: '剧情' });
    const active = { 评价: ['评价/精品'], 作者: ['作者/某人'], 未分类: ['其他类型专属'] };
    const sections = buildLibraryFilterSections(scoped, false, preferences, true, Object.values(active).flat());

    expect(sections.categories.flatMap(section => section.options).map(item => [item.raw, item.count]))
      .toEqual([['评价/精品', 0], ['作者/某人', 0]]);
    expect(sections.uncategorized.options.map(item => [item.raw, item.count])).toEqual([['其他类型专属', 0]]);
    expect(toggleTagFilter(active, '评价', '评价/精品')).toEqual({ 作者: ['作者/某人'], 未分类: ['其他类型专属'] });
    const cleared = buildLibraryFilterSections(scoped, false, preferences, true, []);
    expect(cleared.categories).toEqual([]);
    expect(cleared.uncategorized.total).toBe(0);
  });

  it('retains selected rating aliases without revealing explicitly hidden definitions', () => {
    const options = buildManagedTagOptions(['评价/低创'], preferences).map(item => ({ ...item, count: 0 }));
    const sections = buildLibraryFilterSections(options, false, preferences, true, ['评价/低创', '人物/少女']);
    expect(sections.categories.flatMap(section => section.options).map(item => item.raw)).toEqual(['评价/6分以下']);
  });

  it('keeps an active zero-count uncategorized label accessible beyond the collapsed first six', () => {
    const options = buildManagedTagOptions(['标签1', '标签2', '标签3', '标签4', '标签5', '标签6', '标签7', '标签8'], preferences)
      .map(item => item.raw === '标签8' ? { ...item, count: 0 } : item);
    const sections = buildLibraryFilterSections(options, false, preferences, true, ['标签8']);

    expect(sections.uncategorized.options.map(item => item.raw)).toEqual(['标签1', '标签2', '标签3', '标签4', '标签5', '标签6', '标签8']);
    expect(sections.uncategorized.total).toBe(8);
    expect(sections.uncategorized.hasMore).toBe(true);
  });
});
