import {
  BUILTIN_TAGS,
  TAG_CATEGORIES,
  makeTag,
  parseTag,
  characterFilterTags,
  normalizeRatingTag,
  type ParsedTag,
  type TagCategory,
} from '@/lib/tag-taxonomy';
import type { BuiltinTagCategory } from '@/lib/tag-taxonomy';
import type { ArchiveCharacter } from '@/types/archive';
import { filterCharacters, type LibraryFilterState } from '@/lib/library-query';

export interface LibraryTagPreferences {
  version: 1;
  customCategories: string[];
  customTags: string[];
  categoryOrder: string[];
  order: string[];
  hidden: string[];
  deleted?: string[];
  deletedCategories?: string[];
  /** Library-owned selection shared by the chat list and Tavern character picker. */
  chatVisible?: string[];
}

export interface ManagedTagOption extends ParsedTag {
  builtIn: boolean;
  count: number;
  visible: boolean;
}

export interface LibraryTagSection {
  category: TagCategory;
  options: ManagedTagOption[];
}

export interface LibraryFilterSections {
  categories: LibraryTagSection[];
  uncategorized: {
    options: ManagedTagOption[];
    total: number;
    hasMore: boolean;
  };
}

const BUILTIN_RAWS = new Set(
  [...TAG_CATEGORIES.flatMap((category) => BUILTIN_TAGS[category].map((label) => makeTag(category, label))), '评价/6分以下', '评价/低创'],
);

const DEFAULT_HIDDEN = [
  ...BUILTIN_TAGS['卡面'].map((label) => makeTag('卡面', label)),
  ...BUILTIN_TAGS['评价'].map((label) => makeTag('评价', label)),
  '评价/6分以下',
];

// Compatibility seed for libraries created before chat visibility was configurable.
// Once saved, even an empty library selection takes precedence over these defaults.
const DEFAULT_CHAT_VISIBLE = ['类型/人物', '类型/剧情', '类型/玩法', '类型/综合', '类型/同人', '评价/神作', '评价/精品', '评价/及格'];

export const DEFAULT_LIBRARY_TAG_PREFERENCES: LibraryTagPreferences = {
  version: 1,
  customCategories: [],
  customTags: [],
  categoryOrder: [],
  order: [],
  hidden: DEFAULT_HIDDEN,
  chatVisible: DEFAULT_CHAT_VISIBLE,
};

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const raw = item.trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    result.push(raw);
  }
  return result;
}

export function normalizeLibraryTagPreferences(value: unknown): LibraryTagPreferences {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) {
    return {
      version: 1,
      customCategories: [],
      customTags: [],
      categoryOrder: [],
      order: [],
      hidden: [...DEFAULT_HIDDEN],
      chatVisible: [...DEFAULT_CHAT_VISIBLE],
    };
  }
  const source = value as Partial<LibraryTagPreferences>;
  const customCategories = uniqueStrings(source.customCategories)
    .filter((category) => category !== '未分类' && category !== '类型'
      && !TAG_CATEGORIES.includes(category as BuiltinTagCategory) && !category.includes('/'));
  const categoryOrder = uniqueStrings(source.categoryOrder).filter((category) => (
    category !== '未分类'
    && ((TAG_CATEGORIES as readonly string[]).includes(category) || customCategories.includes(category))
  ));
  return {
    version: 1,
    customCategories,
    customTags: uniqueStrings(source.customTags).filter((raw) => !BUILTIN_RAWS.has(raw) && !raw.startsWith('类型/')),
    categoryOrder,
    order: uniqueStrings(source.order),
    hidden: uniqueStrings(source.hidden),
    chatVisible: source.chatVisible === undefined ? [...DEFAULT_CHAT_VISIBLE]
      : uniqueStrings(uniqueStrings(source.chatVisible).map(normalizeRatingTag)),
    ...(source.deleted ? { deleted: uniqueStrings(uniqueStrings(source.deleted).map(normalizeRatingTag)) } : {}),
    ...(source.deletedCategories ? { deletedCategories: uniqueStrings(source.deletedCategories) } : {}),
  };
}

export function getChatTagOptions(preferences: LibraryTagPreferences): ParsedTag[] {
  const raws = uniqueStrings((preferences.chatVisible ?? DEFAULT_CHAT_VISIBLE).map(normalizeRatingTag));
  const knownCategories = ['类型', ...preferences.customCategories, ...(preferences.deletedCategories ?? [])];
  const order = new Map(preferences.order.map((raw, index) => [normalizeRatingTag(raw), index]));
  const options = raws.map(raw => parseTag(raw, knownCategories)).filter(option =>
    !preferences.deleted?.some(raw => normalizeRatingTag(raw) === option.raw)
    && !preferences.deletedCategories?.includes(option.category));
  options.sort((a, b) => (order.get(a.raw) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.raw) ?? Number.MAX_SAFE_INTEGER));
  // Two groups may use the same label; keep them distinguishable in both chat views.
  const counts = new Map<string, number>();
  for (const option of options) counts.set(option.label, (counts.get(option.label) ?? 0) + 1);
  return options.map(option => ({ ...option, label: counts.get(option.label)! > 1 ? option.raw : option.label }));
}

export function setTagChatVisibility(preferences: LibraryTagPreferences, raw: string, visible: boolean): LibraryTagPreferences {
  const normalized = normalizeRatingTag(raw.trim());
  const selected = new Set(preferences.chatVisible ?? DEFAULT_CHAT_VISIBLE);
  if (visible && normalized) selected.add(normalized); else selected.delete(normalized);
  return { ...preferences, chatVisible: [...selected] };
}

export function characterChatTags(character: { tags: string[]; rating?: number; type?: string }): string[] {
  return [...characterFilterTags(character), ...(character.type ? [`类型/${character.type}`] : [])].map(normalizeRatingTag);
}

export function getTagCategories(preferences: LibraryTagPreferences): TagCategory[] {
  const builtins = TAG_CATEGORIES.filter((category) => category !== '未分类');
  const all = [...builtins, ...preferences.customCategories].filter(category => !preferences.deletedCategories?.includes(category));
  const order = new Map(preferences.categoryOrder.map((category, index) => [category, index]));
  return all.sort((a, b) => {
    const ai = order.get(a);
    const bi = order.get(b);
    if (ai !== undefined || bi !== undefined) {
      if (ai === undefined) return 1;
      if (bi === undefined) return -1;
      return ai - bi;
    }
    return (TAG_CATEGORIES.indexOf(a as BuiltinTagCategory) - TAG_CATEGORIES.indexOf(b as BuiltinTagCategory))
      || a.localeCompare(b, 'zh-CN');
  });
}

export function buildManagedTagOptions(
  assignedTags: string[],
  preferences: LibraryTagPreferences,
  characters?: readonly ArchiveCharacter[],
): ManagedTagOption[] {
  const counts = new Map<string, number>();
  for (const item of characters ? characters.flatMap(characterFilterTags) : assignedTags) {
    const raw = normalizeRatingTag(item.trim());
    if (raw && !raw.startsWith('类型/')) counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }

  const definitions = new Map<string, { parsed: ParsedTag; builtIn: boolean }>();
  const knownCategories = [...preferences.customCategories, ...(preferences.deletedCategories ?? [])];
  for (const category of TAG_CATEGORIES) {
    for (const label of BUILTIN_TAGS[category]) {
      const raw = makeTag(category, label);
      definitions.set(raw, { parsed: parseTag(raw), builtIn: true });
    }
  }
  for (const storedRaw of [...preferences.customTags, ...(preferences.chatVisible ?? [])]) {
    const raw = normalizeRatingTag(storedRaw);
    if (!raw.startsWith('类型/') && !definitions.has(raw)) {
      definitions.set(raw, { parsed: parseTag(raw, knownCategories), builtIn: false });
    }
  }
  for (const raw of counts.keys()) {
    if (!definitions.has(raw)) definitions.set(raw, { parsed: parseTag(raw, knownCategories), builtIn: BUILTIN_RAWS.has(raw) });
  }

  const order = new Map(preferences.order.map((raw, index) => [normalizeRatingTag(raw), index]));
  const categoryOrder = new Map(getTagCategories(preferences).map((category, index) => [category, index]));
  return [...definitions.entries()]
    .filter(([raw, definition]) => !preferences.deleted?.some(tag => normalizeRatingTag(tag) === raw)
      && !preferences.deletedCategories?.includes(definition.parsed.category))
    .map(([raw, definition]) => ({
      ...definition.parsed,
      raw,
      builtIn: definition.builtIn,
      count: counts.get(raw) ?? 0,
      visible: !preferences.hidden.some(hidden => normalizeRatingTag(hidden) === raw),
    }))
    .sort((a, b) => {
      const ai = order.get(a.raw);
      const bi = order.get(b.raw);
      if (ai !== undefined || bi !== undefined) {
        if (ai === undefined) return 1;
        if (bi === undefined) return -1;
        return ai - bi;
      }
      const categoryDiff = (categoryOrder.get(a.category) ?? Number.MAX_SAFE_INTEGER)
        - (categoryOrder.get(b.category) ?? Number.MAX_SAFE_INTEGER);
      return categoryDiff || a.label.localeCompare(b.label, 'zh-CN');
    });
}

/** Keep global definitions and preferences while counting the current type/search scope. */
export function scopeLibraryTagOptions(
  options: readonly ManagedTagOption[],
  characters: ArchiveCharacter[],
  filters: Pick<LibraryFilterState, 'search' | 'type'>,
): ManagedTagOption[] {
  const counts = new Map<string, number>();
  const scopedCharacters = filterCharacters(characters, { search: filters.search, type: filters.type, tags: {} });
  for (const character of scopedCharacters) {
    const tags = new Set(characterFilterTags(character).map(raw => normalizeRatingTag(raw.trim())));
    for (const raw of tags) counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return options.map(option => ({ ...option, count: counts.get(option.raw) ?? 0 }));
}

export function addCustomCategory(
  preferences: LibraryTagPreferences,
  label: string,
): LibraryTagPreferences {
  const normalizedLabel = label.trim();
  if (!normalizedLabel) throw new Error('标签组名称不能为空');
  if (normalizedLabel.includes('/')) throw new Error('标签组名称不能包含“/”');
  if (preferences.deletedCategories?.includes(normalizedLabel)) return {
    ...preferences,
    deletedCategories: preferences.deletedCategories.filter(category => category !== normalizedLabel),
    customCategories: TAG_CATEGORIES.includes(normalizedLabel as BuiltinTagCategory) || normalizedLabel === '类型'
      ? preferences.customCategories : uniqueStrings([...preferences.customCategories, normalizedLabel]),
  };
  if (normalizedLabel === '类型') throw new Error('「类型」是内置分类，请在类型面板维护');
  if (normalizedLabel === '未分类' || (TAG_CATEGORIES as readonly string[]).includes(normalizedLabel)
    || preferences.customCategories.includes(normalizedLabel)) {
    throw new Error('标签组已存在');
  }
  return {
    ...preferences,
    customCategories: [...preferences.customCategories, normalizedLabel],
    categoryOrder: [...preferences.categoryOrder, normalizedLabel],
  };
}

export function setTagVisibility(
  preferences: LibraryTagPreferences,
  raw: string,
  visible: boolean,
): LibraryTagPreferences {
  const hidden = new Set(preferences.hidden.filter(item => normalizeRatingTag(item) !== normalizeRatingTag(raw)));
  if (!visible) hidden.add(normalizeRatingTag(raw));
  return { ...preferences, hidden: [...hidden] };
}

export function addCustomTagDefinition(
  preferences: LibraryTagPreferences,
  category: TagCategory,
  label: string,
): LibraryTagPreferences {
  const normalizedLabel = label.trim();
  if (!normalizedLabel) throw new Error('标签名称不能为空');
  if (category !== '未分类' && !TAG_CATEGORIES.includes(category as BuiltinTagCategory)
    && !preferences.customCategories.includes(category) || preferences.deletedCategories?.includes(category)) {
    throw new Error('标签组不存在');
  }
  const raw = normalizeRatingTag(makeTag(category, normalizedLabel));
  const restoring = preferences.deleted?.some(tag => normalizeRatingTag(tag) === raw);
  if (!restoring && (BUILTIN_RAWS.has(raw) || preferences.customTags.includes(raw))) throw new Error('标签已存在');
  return {
    ...preferences,
    customTags: BUILTIN_RAWS.has(raw) ? preferences.customTags : uniqueStrings([...preferences.customTags, raw]),
    order: preferences.order.includes(raw) ? preferences.order : [...preferences.order, raw],
    hidden: preferences.hidden.filter((item) => normalizeRatingTag(item) !== raw),
    ...(preferences.deleted ? { deleted: preferences.deleted.filter(tag => normalizeRatingTag(tag) !== raw) } : {}),
  };
}

export function removeTagCategory(preferences: LibraryTagPreferences, category: string): LibraryTagPreferences {
  const belongs = (raw: string) => parseTag(raw, ['类型', ...preferences.customCategories]).category === category;
  return { ...preferences, customCategories: preferences.customCategories.filter(value => value !== category),
    customTags: preferences.customTags.filter(raw => !belongs(raw)), order: preferences.order.filter(raw => !belongs(raw)),
    hidden: preferences.hidden.filter(raw => !belongs(raw)), categoryOrder: preferences.categoryOrder.filter(value => value !== category),
    chatVisible: (preferences.chatVisible ?? DEFAULT_CHAT_VISIBLE).filter(raw => !belongs(raw)),
    deletedCategories: [...new Set([...(preferences.deletedCategories ?? []), category])] };
}

export function removeCustomTagDefinition(
  preferences: LibraryTagPreferences,
  raw: string,
): LibraryTagPreferences {
  const normalizedRaw = normalizeRatingTag(raw);
  return {
    ...preferences,
    customTags: preferences.customTags.filter((item) => normalizeRatingTag(item) !== normalizedRaw),
    order: preferences.order.filter((item) => normalizeRatingTag(item) !== normalizedRaw),
    hidden: preferences.hidden.filter((item) => normalizeRatingTag(item) !== normalizedRaw),
    chatVisible: (preferences.chatVisible ?? DEFAULT_CHAT_VISIBLE).filter(item => normalizeRatingTag(item) !== normalizedRaw),
    deleted: uniqueStrings([...(preferences.deleted ?? []).map(normalizeRatingTag), normalizedRaw]),
  };
}

export function moveTag(
  preferences: LibraryTagPreferences,
  currentOrder: string[],
  raw: string,
  targetIndex: number,
): LibraryTagPreferences {
  const ordered = uniqueStrings(currentOrder);
  const sourceIndex = ordered.indexOf(raw);
  if (sourceIndex < 0) return preferences;
  const [moved] = ordered.splice(sourceIndex, 1);
  const nextIndex = Math.max(0, Math.min(targetIndex, ordered.length));
  ordered.splice(nextIndex, 0, moved);
  const leftovers = preferences.order.filter((item) => !ordered.includes(item));
  return { ...preferences, order: [...ordered, ...leftovers] };
}

export function buildLibraryFilterSections(
  options: ManagedTagOption[],
  uncategorizedExpanded: boolean,
  preferences: LibraryTagPreferences = DEFAULT_LIBRARY_TAG_PREFERENCES,
  hideUnused = false,
  selectedTags: readonly string[] = [],
): LibraryFilterSections {
  const selected = new Set(selectedTags.map(normalizeRatingTag));
  const eligible = options.filter((option) => option.visible
    && (!hideUnused || option.count > 0 || selected.has(option.raw)));
  const categories = getTagCategories(preferences)
    .map((category) => ({ category, options: eligible.filter((option) => option.category === category) }))
    .filter((section) => section.options.length > 0
      || (!hideUnused && preferences.customCategories.includes(section.category)));
  const uncategorizedAll = eligible.filter((option) => option.category === '未分类'
    && (option.count > 0 || selected.has(option.raw)));
  const optionsToShow = uncategorizedExpanded ? uncategorizedAll
    : uncategorizedAll.filter((option, index) => index < 6 || selected.has(option.raw));
  return {
    categories,
    uncategorized: {
      options: optionsToShow,
      total: uncategorizedAll.length,
      hasMore: !uncategorizedExpanded && uncategorizedAll.length > optionsToShow.length,
    },
  };
}
