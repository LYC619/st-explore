import { tr } from '@/lib/i18n';
import { useI18n, useLocalizedMemo } from '@/lib/i18n/react';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
/**
 * 角色库（10.2 重构，0801 实测反馈）：
 * - 左侧筛选栏 = 标签系统：顶部「标签管理」→ 类型单选组（互斥，10.0 type 字段）→ 分类法 v2 各组（问号说明；
 *   内置打底常显 + 库内自建；每类至多选一，类别间交集）；旧五档进度组已废弃移除
 * - 顶栏一行：搜索 / 排序（+最后游玩 +方向钮）/ 批量管理 / 外观（视图·卡片大小·字体大小）/ 导入；筛选在侧栏再次点击取消
 * - 卡面重排：左上=评分数字（未评分）+时间（≤7天相对/hover 完整），右上=故事数角标（对比度修正）+菜单；
 *   下方只留 名称（tooltip）+清洗简介；NSFW 卡面按全局设置模糊（hover 揭示）
 * - 批量模式：点选/Ctrl 点选/Shift 范围选/全选当前筛选结果；常驻条=打标签/导出（逐卡原件）/删除
 * - 红线：2:3 比例（ST 标准卡 400×600）不可改、不加左上角编号
 *
 * 阶段 C2 拆分：卡面/列表行/操作菜单/工具条/分页条已抽到 components/library/，
 * 外观偏好与批量选择抽到 hooks/，本文件只留数据装载、导入导出删除与组装。
 */
import { useMemo, useState, useEffect, useLayoutEffect, useCallback, useRef, lazy, Suspense, useSyncExternalStore  } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StoryPackageTools } from '@/components/workspace/StoryPackageTools';
import { Plus, BookOpen, ListFilter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isPlainSingleKeyShortcut, shouldIgnoreGlobalShortcut } from '@/lib/keyboard-shortcuts';
import { AppLayout } from '@/components/AppLayout';
import { TagManagerDialog } from '@/components/library/TagManagerDialog';
import { BatchTagDialog } from '@/components/library/BatchTagDialog';
import { LibraryFilterRail } from '@/components/library/LibraryFilterRail';
import { LibraryDropOverlay } from '@/components/library/LibraryDropOverlay';
import {
  LibraryImportDialog,
  type LibraryImportTagSelection,
} from '@/components/library/LibraryImportDialog';
import { LibraryListHeader } from '@/components/library/LibraryListHeader';
import { LibraryToolbar } from '@/components/library/LibraryToolbar';
import { CARD_W_COMPACT, cardFontSizes, type ViewMode } from '@/lib/library-view';
import type { LibraryReviewHandle } from '@/components/library/review/LibraryReviewView';
import { LibraryPager, LibraryBatchBar } from '@/components/library/LibraryPager';
import { CharacterTile } from '@/components/library/CharacterTile';
import { CharacterQuickPills } from '@/components/library/CharacterQuickPills';
import { CharacterListRow } from '@/components/library/CharacterListRow';
import { CharacterActionsMenu } from '@/components/library/CharacterActionsMenu';
import { Button } from '@/components/ui/button';
import { CharacterGridSkeleton, RefreshIndicator } from '@/components/ui/skeleton';
import { LibraryWebExportConfirmDialog } from '@/components/library/LibraryWebExportConfirmDialog';
import { useToast } from '@/hooks/use-toast';
import { useLibraryViewPrefs } from '@/hooks/use-library-view-prefs';
import { useLibrarySelection } from '@/hooks/use-library-selection';
import {
  getHideUnusedLibraryTags,
  LIBRARY_DISPLAY_SETTINGS_EVENT,
} from '@/lib/local-settings';
import {
  exportBatchCharactersToDesktop,
  exportSingleCharacterFromLibrary,
  isTauri,
  runWebBatchCharacterDownload,
  WEB_BATCH_DOWNLOAD_LIMIT,
} from '@/lib/library-export-actions';
import type { ArchiveCharacter, CharacterType } from '@/types/archive';
import {
  CHARACTER_TYPES,
  saveCharacter,
  deleteCharacter,
  getLibraryTagPreferences,
  saveLibraryTagPreferences,
} from '@/lib/archive-db';
import { listCharacterIndex, toCharacterIndex, listStoryIndex, type CharacterIndexEntry, type StoryIndexEntry } from '@/lib/archive-index';
import { buildEditorChatPath, setEditorStoryId } from '@/lib/editor-story-context';
import { readLibraryReturnState, writeLibraryReturnState } from '@/lib/library-return-state';
import { preloadRoleplayPage } from '@/components/roleplay/RoleplayWorkspace';
import { launchRoleplayTarget, reserveDetachedWindowForAsyncAction } from '@/lib/roleplay/detached-window';
import { prepareStoryPlay } from '@/lib/roleplay/open-story';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { scopedKey } from '@/lib/vault/vault-scope';
import { importEmbeddedAssets } from '@/lib/card-embedded-assets';
import {
  applyLibraryImportType,
  applyLibraryImportTags,
  prepareLibraryCharacterFile,
  registerLibraryImportCustomTag,
  type PreparedLibraryCharacterImport,
} from '@/lib/library-character-import';
import { type TagCategory } from '@/lib/tag-taxonomy';
import {
  buildLibraryFilterSections,
  scopeLibraryTagOptions,
  buildManagedTagOptions,
  getTagCategories,
  normalizeLibraryTagPreferences,
  type LibraryTagPreferences,
} from '@/lib/library-tag-preferences';
import {
  displayCharacterName,
  filterCharacters,
  sortCharacters,
  toggleTagFilter as toggleLibraryTagFilter,
  type LibrarySortKey,
} from '@/lib/library-query';
import { buildLibraryGroups, collapseLibraryGroups } from '@/lib/library-grouping';
import { useGridColumns } from '@/hooks/use-grid-columns';
import { useViewport } from '@/hooks/use-viewport';

/** 类型筛选：all=不筛；none=未分类（type 为空） */
type TypeFilter = 'all' | CharacterType | 'none';

const LibraryReviewView = lazy(() => import('@/components/library/review/LibraryReviewView')
  .then((module) => ({ default: module.LibraryReviewView })));

const Library = () => {
  useI18n();
  const navigate = useNavigate();
  const { toast } = useToast();
  /** 窄屏（<1024px）把筛选栏搬进左抽屉；桌面档保持原来的可拖宽侧栏 */
  const { isMobile, isCompact } = useViewport();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [characters, setCharacters] = useState<CharacterIndexEntry[]>([]);
  const [storyIndex, setStoryIndex] = useState<StoryIndexEntry[]>([]);
  const [returnState] = useState(readLibraryReturnState);
  const [scopeEpoch] = useState(getVaultEpoch);
  const [reviewFiltersOpen, setReviewFiltersOpen] = useState(false);
  const loadSequence = useRef(0);
  const reviewRef = useRef<LibraryReviewHandle>(null);
  const viewTransition = useRef(false);
  const [storyCounts, setStoryCounts] = useState<Record<string, number>>({});
  const [latestStoryByChar, setLatestStoryByChar] = useState<Record<string, string>>({});
  /** 每角色最后游玩时间 = 名下故事 lastMessageAt 最大值（10.0 物化） */
  const [lastPlayed, setLastPlayed] = useState<Record<string, number>>({});
  /** 首屏：还没读到任何数据，给骨架 */
  const [loading, setLoading] = useState(true);
  /** 刷新：已经有数据，只在顶部给细指示条，别把读到的内容换回骨架 */
  const [refreshing, setRefreshing] = useState(false);
  /** 读档失败：要跟「库是空的」区分开，空库是正常状态，失败得能重试 */
  const [loadFailed, setLoadFailed] = useState(false);
  const [searchQuery, setSearchQuery] = useState(returnState?.searchQuery ?? '');
  /** 分级标签筛选：类型单选，其余类别组内多选 OR，类别间取交集 */
  const [tagFilters, setTagFilters] = useState<Partial<Record<TagCategory, string[]>>>(returnState?.tagFilters ?? {});
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(returnState?.typeFilter ?? 'all');
  const [tagPreferences, setTagPreferences] = useState<LibraryTagPreferences>(() =>
    normalizeLibraryTagPreferences(undefined),
  );
  const [uncategorizedExpanded, setUncategorizedExpanded] = useState(false);
  const [sortKey, setSortKey] = useState<LibrarySortKey>(returnState?.sortKey ?? 'recent');
  const [sortAsc, setSortAsc] = useState(returnState?.sortAsc ?? false);
  const [batchExporting, setBatchExporting] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    items: PreparedLibraryCharacterImport[];
    failures: string[];
  } | null>(null);
  const [searchParams] = useSearchParams();
  const [chatTagSetup] = useState(() => searchParams.get('manageTags') === '1');
  const chatTagSetupOpened = useRef(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [tagManagerCategory, setTagManagerCategory] = useState<TagCategory | '类型'>('人物');
  useEffect(() => {
    if (chatTagSetup && !loading && !loadFailed && !chatTagSetupOpened.current) {
      chatTagSetupOpened.current = true; setTagManagerCategory('未分类'); setTagManagerOpen(true);
    }
  }, [chatTagSetup, loading, loadFailed]);
  const [batchTagOpen, setBatchTagOpen] = useState(false);
  /** 待确认删除（单删=长度1，批量=多条）；null=无弹窗 */
  const [pendingDelete, setPendingDelete] = useState<ArchiveCharacter[] | null>(null);
  /** 网页版一次选太多要先确认（只下前 WEB_BATCH_DOWNLOAD_LIMIT 张） */
  const [pendingWebExport, setPendingWebExport] = useState<ArchiveCharacter[] | null>(null);
  const [hideUnusedTags, setHideUnusedTags] = useState(() => getHideUnusedLibraryTags());
  const prefs = useLibraryViewPrefs();
  const browseLayout = JSON.stringify([prefs.viewMode, prefs.pageSize, prefs.groupBy, prefs.groupTagCategory]);
  const savedBrowse = returnState?.browse?.layout === browseLayout ? returnState.browse : undefined;
  const [page, setPage] = useState(savedBrowse?.page ?? 1);
  const browseScroll = useRef(savedBrowse?.scrollTop ?? 0);
  const browseElement = useRef<HTMLDivElement>(null);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set(savedBrowse?.expandedGroups));

  useEffect(() => {
    if (getVaultEpoch() === scopeEpoch) {
      writeLibraryReturnState({ searchQuery, tagFilters, typeFilter, sortKey, sortAsc,
        browse: { page, scrollTop: browseScroll.current, expandedGroups: [...expandedGroups], layout: browseLayout } });
    }
  }, [searchQuery, tagFilters, typeFilter, sortKey, sortAsc, page, expandedGroups, browseLayout, scopeEpoch]);

  useEffect(() => {
    const syncDisplaySettings = () => setHideUnusedTags(getHideUnusedLibraryTags());
    window.addEventListener(LIBRARY_DISPLAY_SETTINGS_EVENT, syncDisplaySettings);
    return () => window.removeEventListener(LIBRARY_DISPLAY_SETTINGS_EVENT, syncDisplaySettings);
  }, []);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const isCurrent = () => getVaultEpoch() === scopeEpoch && sequence === loadSequence.current;
    setRefreshing(true);
    try {
      const [chars, stories, preferences] = await Promise.all([
        listCharacterIndex(),
        listStoryIndex(),
        getLibraryTagPreferences(),
      ]);
      if (!isCurrent()) return;
      setLoadFailed(false);
      setCharacters(chars);
      setStoryIndex(stories);
      setTagPreferences(preferences);
      const counts: Record<string, number> = {};
      const played: Record<string, number> = {};
      const latestStory: Record<string, { id: string; rankTime: number }> = {};
      for (const s of stories) {
        if (!s.characterId) continue;
        counts[s.characterId] = (counts[s.characterId] ?? 0) + 1;
        if (s.lastMessageAt !== undefined) {
          played[s.characterId] = Math.max(played[s.characterId] ?? 0, s.lastMessageAt);
        }
        const rankTime = Math.max(s.lastViewedAt ?? 0, s.lastMessageAt ?? 0, s.updatedAt ?? 0);
        if (!latestStory[s.characterId] || rankTime >= latestStory[s.characterId].rankTime) {
          latestStory[s.characterId] = { id: s.id, rankTime };
        }
      }
      setStoryCounts(counts);
      setLastPlayed(played);
      setLatestStoryByChar(Object.fromEntries(Object.entries(latestStory).map(([cid, item]) => [cid, item.id])));
    } catch {
      if (!isCurrent()) return;
      setLoadFailed(true);
      toast({ title: tr("加载失败"), description: tr("无法读取角色库数据"), variant: 'destructive' });
    } finally {
      if (isCurrent()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [toast, scopeEpoch]);

  useEffect(() => {
    load();
    return () => { loadSequence.current += 1; };
  }, [load]);

  const handleTagPreferencesChange = useCallback(async (next: LibraryTagPreferences) => {
    const normalized = normalizeLibraryTagPreferences(next);
    await saveLibraryTagPreferences(normalized);
    setTagPreferences(normalized);
  }, []);

  const handleImportFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const selectedFiles = Array.from(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
    const results = await Promise.allSettled(selectedFiles.map(prepareLibraryCharacterFile));
    const items: PreparedLibraryCharacterImport[] = [];
    const failures: string[] = [];
      results.forEach((result, index) => {
      if (result.status === 'fulfilled') items.push(result.value);
      else {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        failures.push(tr("{{v0}}：{{v1}}", { v0: selectedFiles[index].name, v1: reason }));
      }
    });
    if (items.length === 0) {
      toast({
        title: tr("没有可导入的角色卡"),
        description: failures.slice(0, 3).join('\n'),
        variant: 'destructive',
      });
      return;
    }
    setPendingImport({ items, failures });
  };

  const handleConfirmImport = async (selection: LibraryImportTagSelection) => {
    if (!pendingImport || importBusy) return;
    setImportBusy(true);
    try {
      const tags = new Set(selection.tags);
      let nextPreferences = tagPreferences;
      if (selection.applyTags && selection.customTag) {
        const registered = registerLibraryImportCustomTag(nextPreferences, selection.customTag);
        nextPreferences = registered.preferences;
        tags.add(registered.raw);
      }
      if (nextPreferences !== tagPreferences) await handleTagPreferencesChange(nextPreferences);

      let ok = 0;
      let failedDuringSave = 0;
      let firstSaveError: string | undefined;
      for (const prepared of pendingImport.items) {
        try {
          let character = selection.applyTags
            ? applyLibraryImportTags(prepared.character, tags)
            : prepared.character;
          if (selection.type) character = applyLibraryImportType(character, selection.type);
          // 卡内嵌世界书/正则自动入库并挂关联（阶段9.5）
          const refs = await importEmbeddedAssets(character);
          if (refs.length > 0) character = { ...character, assets: refs };
          await saveCharacter(character);
          ok += 1;
        } catch (error) {
          failedDuringSave += 1;
          if (!firstSaveError) firstSaveError = error instanceof Error ? error.message : String(error);
        }
      }

      const failed = pendingImport.failures.length + failedDuringSave;
      const blankCount = pendingImport.items.filter((item) => item.kind === 'blank-image').length;
      const warningMessages = pendingImport.items.flatMap((item) => item.warning ? [tr("{{v0}}：{{v1}}", { v0: item.fileName, v1: item.warning })] : []);
      await load();
      setPendingImport(null);
      toast({
        title: failed
          ? tr("导入完成：成功 {{v0}} 张，失败 {{v1}} 张", { v0: ok, v1: failed })
          : tr("导入完成：成功 {{v0}} 张", { v0: ok }),
        description: [
          blankCount > 0 ? tr("其中 {{v0}} 张普通图片已转为空白角色卡。", { v0: blankCount }) : undefined,
          warningMessages.length > 0 ? warningMessages[0] : undefined,
          firstSaveError ? tr("失败原因：{{v0}}", { v0: firstSaveError }) : undefined,
        ].filter(Boolean).join(' ') || undefined,
        variant: failed > 0 && ok === 0 ? 'destructive' : undefined,
      });
    } catch (error) {
      toast({
        title: tr("无法开始导入"),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setImportBusy(false);
    }
  };

  const handleConfirmDelete = async (options: import('@/lib/repo').RemoveOptions) => {
    if (!pendingDelete?.length) return;
    try {
      for (const c of pendingDelete) await deleteCharacter(c.id, options);
      await load();
      selection.setSelected(new Set());
      toast({ title: tr("已删除 {{v0}} 个角色（名下故事与记录已一并移除）", { v0: pendingDelete.length }) });
    } catch (e) {
      toast({
        title: tr("删除失败"),
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
      await load();
      return false;
    }
  };

  const runWebExport = async (targets: ArchiveCharacter[]) => {
    setBatchExporting(true);
    try {
      await runWebBatchCharacterDownload(targets, toast);
    } catch (error) {
      toast({
        title: tr("下载未成功"),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setBatchExporting(false);
    }
  };

  const handleBatchExport = async () => {
    const targets = characters.filter((c) => selection.selected.has(c.id));
    if (targets.length === 0 || batchExporting) return;
    if (!isTauri()) {
      if (targets.length > WEB_BATCH_DOWNLOAD_LIMIT) {
        setPendingWebExport(targets);
        return;
      }
      await runWebExport(targets);
      return;
    }

    setBatchExporting(true);
    try {
      await exportBatchCharactersToDesktop(targets, toast);
    } catch (error) {
      toast({
        title: tr("导出未成功"),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setBatchExporting(false);
    }
  };

  const handleSingleExport = async (character: ArchiveCharacter) => {
    await exportSingleCharacterFromLibrary(character, toast);
  };

  const managedTagOptions = useMemo(
    () => buildManagedTagOptions(characters.flatMap((character) => character.tags), tagPreferences, characters),
    [characters, tagPreferences],
  );
  const groupTagCategories = useMemo(() => getTagCategories(tagPreferences), [tagPreferences]);
  const { groupTagCategory, setGroupTagCategory } = prefs;
  useEffect(() => {
    if (!groupTagCategories.includes(groupTagCategory)) {
      setGroupTagCategory(groupTagCategories[0] ?? '人物');
    }
  }, [groupTagCategories, groupTagCategory, setGroupTagCategory]);
  const scopedTagOptions = useMemo(
    () => scopeLibraryTagOptions(managedTagOptions, characters, { search: searchQuery, type: typeFilter }),
    [managedTagOptions, characters, searchQuery, typeFilter],
  );
  const filterSections = useMemo(
    () => buildLibraryFilterSections(scopedTagOptions, uncategorizedExpanded, tagPreferences, hideUnusedTags, Object.values(tagFilters).flatMap(tags => tags ?? [])),
    [scopedTagOptions, uncategorizedExpanded, tagPreferences, hideUnusedTags, tagFilters],
  );

  useEffect(() => {
    if (loading || loadFailed) return;
    setTypeFilter(current => current !== 'all' && current !== 'none'
      && (tagPreferences.deletedCategories?.includes('类型') || tagPreferences.deleted?.includes(`类型/${current}`))
      ? 'all' : current);
    const visible = new Set(
      managedTagOptions
        .filter((option) => option.visible)
        .map((option) => option.raw),
    );
    setTagFilters((current) => {
      let changed = false;
      const next: Partial<Record<TagCategory, string[]>> = {};
      for (const [category, tags] of Object.entries(current)) {
        const kept = (tags ?? []).filter((raw) => visible.has(raw));
        if (kept.length !== (tags ?? []).length) changed = true;
        if (kept.length > 0) next[category as TagCategory] = kept;
      }
      return changed ? next : current;
    });
  }, [managedTagOptions, tagPreferences, loading, loadFailed]);

  /** 筛选栏计数：类型按 type 字段，标签按 raw 出现次数 */
  const typeCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of characters) m[c.type ?? 'none'] = (m[c.type ?? 'none'] ?? 0) + 1;
    return m;
  }, [characters]);
  const filtered = useMemo(() => {
    const list = filterCharacters(characters, { search: searchQuery, type: typeFilter, tags: tagFilters });
    return sortCharacters(list, sortKey, sortAsc, lastPlayed);
  }, [characters, searchQuery, tagFilters, typeFilter, sortKey, sortAsc, lastPlayed]);

  // Initial mounting restores the previous page; only an actual query/layout change resets it.
  const queryKey = JSON.stringify([searchQuery, tagFilters, typeFilter, sortKey, sortAsc, browseLayout]);
  const previousQuery = useRef(queryKey);
  useEffect(() => {
    if (previousQuery.current === queryKey) return;
    previousQuery.current = queryKey;
    browseScroll.current = 0;
    setPage(1);
    setExpandedGroups(new Set());
  }, [queryKey]);

  const selection = useLibrarySelection(filtered, page);
  const [startingStoryId, setStartingStoryId] = useState<string | null>(null);
  const playBusyRef = useRef(false);

  const continueStoryFromCard = useCallback(async (storyId: string) => {
    if (playBusyRef.current) return;
    playBusyRef.current = true;
    setStartingStoryId(storyId);
    const epoch = getVaultEpoch();
    const reservation = reserveDetachedWindowForAsyncAction();
    try {
      const [target] = await Promise.all([prepareStoryPlay(storyId), preloadRoleplayPage()]);
      if (epoch !== getVaultEpoch()) {
        reservation?.cancelIfUnused();
        return;
      }
      launchRoleplayTarget({
        storyId: target.storyId,
        branchId: target.branchId,
        navigate,
        reservation,
      });
    } catch (err) {
      reservation?.cancelIfUnused();
      toast({
        title: tr("暂时未能进入聊天"),
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      playBusyRef.current = false;
      setStartingStoryId(null);
    }
  }, [navigate, toast]);

  // 桌面快捷键：/ 聚焦搜索，Esc 退出批量模式或清空搜索（回顾视图内留给内嵌阅读器/小说视图消费）
  useEffect(() => {
    if (prefs.viewMode === 'review' || pendingImport !== null || tagManagerOpen || batchTagOpen || !!pendingDelete || !!pendingWebExport) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.activeElement === searchInputRef.current) {
          e.preventDefault();
          if (searchQuery) setSearchQuery('');
          else searchInputRef.current?.blur();
          return;
        }
        if (shouldIgnoreGlobalShortcut(e)) return;
        if (selection.batchMode) {
          e.preventDefault();
          selection.exitBatchMode();
        } else if (searchQuery) {
          e.preventDefault();
          setSearchQuery('');
        }
        return;
      }
      if (!isPlainSingleKeyShortcut(e)) return;
      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [batchTagOpen, pendingDelete, pendingImport, pendingWebExport, prefs.viewMode, searchQuery, selection, tagManagerOpen]);

  const changeView = async (mode: ViewMode) => {
    if (viewTransition.current || mode === prefs.viewMode) return;
    viewTransition.current = true;
    try {
      await reviewRef.current?.flushPendingSave();
      if (scopeEpoch !== getVaultEpoch()) return;
      selection.exitBatchMode();
      prefs.setViewMode(mode);
    } catch (error) {
      toast({ title: tr("暂时无法离开回顾"), description: error instanceof Error ? error.message : tr("请先保存当前故事后重试"), variant: 'destructive' });
    } finally { viewTransition.current = false; }
  };

  const { pageSize } = prefs;
  const pageCount = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(filtered.length / Number(pageSize)));
  // 删除等操作使总页数缩小时收敛到最后一页
  useEffect(() => {
    if (!loading && !loadFailed && page > pageCount) setPage(pageCount);
  }, [page, pageCount, loading, loadFailed]);
  const pageItems = useMemo(() => {
    if (pageSize === 'all') return filtered;
    const n = Number(pageSize);
    return filtered.slice((page - 1) * n, page * n);
  }, [filtered, page, pageSize]);
  /**
   * 分组视图不参与全局分页：先分页再分组会把每个分组按当前页的余量切断
   * （每页 24 张 → 一组只剩 6 张，其余甩到第二页，0830 反馈 3）。
   * 分组时改成对全部筛选结果分组，每组先露两行，行尾给展开按钮。
   */
  const grouping = prefs.viewMode === 'grid' && prefs.groupBy !== 'none';
  const { ref: gridRef, cols: measuredCols } = useGridColumns(prefs.cardWidth);
  /**
   * 手机上固定两列：卡宽偏好是给鼠标调的，390px 屏上按 240px 卡宽算只排得下一列，
   * 一屏看一张卡等于把库页变成一条队列。分组折叠的「每组两行」也按这个列数算。
   */
  const cols = isMobile ? 2 : measuredCols;
  const restoredBrowse = useRef<string>();
  const browsePosition = JSON.stringify([page, queryKey]);
  useLayoutEffect(() => {
    if (loading || loadFailed || !browseElement.current || grouping && cols === 0) return;
    if (restoredBrowse.current === browsePosition) return;
    browseElement.current.scrollTop = restoredBrowse.current ? 0 : browseScroll.current;
    restoredBrowse.current = browsePosition;
  }, [loading, loadFailed, grouping, cols, browsePosition]);
  const gridTemplateColumns = isMobile
    ? 'repeat(2, minmax(0, 1fr))'
    : `repeat(auto-fill, minmax(${prefs.cardWidth}px, 1fr))`;
  const displayGroups = useLocalizedMemo(() => {
    const groups = buildLibraryGroups(grouping ? filtered : pageItems, prefs.groupBy, {
      tagCategory: prefs.groupTagCategory,
    });
    return grouping
      ? collapseLibraryGroups(groups, cols, expandedGroups)
      : groups.map((group) => ({ ...group, visible: group.items, hiddenCount: 0 }));
  }, [grouping, filtered, pageItems, prefs.groupBy, prefs.groupTagCategory, cols, expandedGroups]);

  const toggleTagFilter = (cat: TagCategory, raw: string) => {
    setTagFilters((f) => toggleLibraryTagFilter(f, cat, raw) as Partial<Record<TagCategory, string[]>>);
  };

  const { name: nameSize, intro: introSize, rowName: rowNameSize } = cardFontSizes(prefs.fontScale);

  /** 卡面与列表行共用的一份接线：点击 = 批量选择或进角色页 */
  const activate = (c: ArchiveCharacter) => (shiftKey: boolean) => {
    if (selection.batchMode) selection.clickCharacter(c, shiftKey);
    else navigate(`/character/${c.id}`);
  };
  const openReminisceStory = useCallback((storyId: string) => {
    setEditorStoryId(storyId);
    navigate(buildEditorChatPath(storyId));
  }, [navigate]);

  const menuFor = (
    c: ArchiveCharacter,
    triggerClassName: string,
    iconClassName?: string,
  ) => {
    const latestId = latestStoryByChar[c.id];
    return (
      <CharacterActionsMenu
        onOpen={() => navigate(`/character/${c.id}`)}
        onContinueChat={latestId ? () => { void continueStoryFromCard(latestId); } : undefined}
        onReminisceStory={latestId ? () => openReminisceStory(latestId) : undefined}
        onOpenGreetings={() => navigate(`/character/${c.id}?tab=greetings`)}
        onExport={() => void handleSingleExport(c)}
        onDelete={() => setPendingDelete([c])}
        triggerClassName={triggerClassName}
        iconClassName={iconClassName}
      />
    );
  };

  /** 筛选栏本体：窄屏塞进左抽屉，桌面留在页面左侧；两处只会同时存在一个 */
  const filterRail = (embedded: boolean) => (
    <LibraryFilterRail
      embedded={embedded}
      typeOptions={CHARACTER_TYPES.filter(type => !tagPreferences.deletedCategories?.includes('类型') && !tagPreferences.deleted?.includes(`类型/${type}`)).map((type) => ({
        value: type,
        label: tr(type),
        count: typeCounts[type] ?? 0,
      }))}
      unclassifiedCount={typeCounts.none ?? 0}
      activeType={typeFilter}
      sections={filterSections}
      activeTags={tagFilters}
      uncategorizedExpanded={uncategorizedExpanded}
      onTypeChange={(value) => setTypeFilter(value as TypeFilter)}
      onTagToggle={toggleTagFilter}
      onUncategorizedExpandedChange={setUncategorizedExpanded}
    />
  );

  return (
    <AppLayout mobileDrawer={isCompact ? filterRail(true) : undefined}>
      <LibraryDropOverlay
        disabled={pendingImport !== null || importBusy}
        onDropFiles={(files) => { void handleImportFiles(files); }}
      >
        <LibraryToolbar
          characterCount={characters.length}
          filteredCount={filtered.length}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchInputRef={searchInputRef}
          onOpenTagManager={() => { setTagManagerCategory('人物'); setTagManagerOpen(true); }}
          batchMode={selection.batchMode}
          onToggleBatchMode={() =>
            (selection.batchMode ? selection.exitBatchMode() : selection.enterBatchMode())}
          sortKey={sortKey}
          onSortKeyChange={setSortKey}
          sortAsc={sortAsc}
          onSortAscToggle={() => setSortAsc((v) => !v)}
          viewMode={prefs.viewMode}
          onViewModeChange={(mode) => { void changeView(mode); }}
          groupBy={prefs.groupBy}
          onGroupByChange={prefs.setGroupBy}
          groupTagCategory={prefs.groupTagCategory}
          groupTagCategories={groupTagCategories}
          onGroupTagCategoryChange={prefs.setGroupTagCategory}
          cardWidth={prefs.cardWidth}
          onCardWidthChange={prefs.setCardWidth}
          fontScale={prefs.fontScale}
          onFontScaleChange={prefs.setFontScale}
          fileInputRef={fileInputRef}
          onPickFiles={handleImportFiles}
          storyPackageTools={<StoryPackageTools />}
          reviewFilters={!isCompact && (
            <Button variant="outline" size="sm" aria-expanded={reviewFiltersOpen} onClick={() => setReviewFiltersOpen((open) => !open)}>
              <ListFilter className="w-4 h-4 mr-1.5" />{tr("筛选")}</Button>
          )}
        />

        {/* ===== 内容区：标签筛选栏 + 卡墙 ===== */}
        <div className="flex-1 min-h-0 flex">
          {!isCompact && (prefs.viewMode !== 'review' || reviewFiltersOpen) && filterRail(false)}

          {prefs.viewMode === 'review' && !loading && characters.length > 0 ? (
            <div className="flex-1 min-w-0 min-h-0 flex flex-col">
              <RefreshIndicator active={refreshing} />
              {loadFailed && (
                <div role="alert" className="px-4 py-2 text-sm">{tr("刷新失败，当前显示上次读取的内容。")}<Button variant="ghost" size="sm" onClick={() => void load()}>{tr("重试")}</Button>
                </div>
              )}
              <Suspense fallback={<p role="status" className="p-6 text-sm text-muted-foreground">{tr("正在打开回顾视图…")}</p>}>
                <LibraryReviewView
                  ref={reviewRef}
                  characters={filtered}
                  storyIndex={storyIndex}
                  onCharacterChange={(updated) => setCharacters((current) => current.map((c) => c.id === updated.id ? toCharacterIndex(updated) : c))}
                  onStoriesChange={load}
                />
              </Suspense>
            </div>
          ) : (
          <div ref={browseElement} data-library-scroll onScroll={event => {
            browseScroll.current = event.currentTarget.scrollTop;
            if (!loading && getVaultEpoch() === scopeEpoch) writeLibraryReturnState({ searchQuery, tagFilters, typeFilter, sortKey, sortAsc,
              browse: { page, scrollTop: browseScroll.current, expandedGroups: [...expandedGroups], layout: browseLayout } });
          }} className={cn(
            'flex-1 min-w-0 overflow-y-auto scrollbar-thin py-3',
            isMobile ? 'px-3' : 'px-6',
          )}>
            <RefreshIndicator active={refreshing && !loading} className="-mt-3 mb-3" />
            {loading ? (
              <CharacterGridSkeleton count={isMobile ? 4 : 8} gridTemplateColumns={gridTemplateColumns} />
            ) : loadFailed && characters.length === 0 ? (
              /* 读档失败跟空库是两件事：空库该引导导入，失败该给重试 */
              <div className="flex h-64 flex-col items-center justify-center gap-3 text-center" data-library-load-error>
                <p className="text-sm text-[color:var(--text-body)]">{tr("读取角色库失败")}</p>
                <p className="text-xs text-[color:var(--text-muted)]">{tr("这不是空档案，是这次没读出来。数据仍在库里。")}</p>
                <Button variant="outline" size="sm" onClick={() => void load()}>{tr("重试")}</Button>
              </div>
            ) : characters.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <BookOpen className="w-16 h-16 text-muted-foreground/50 mb-4" />
                <h2 className="font-display text-xl mb-2">{tr("角色库还是空的")}</h2>
                <p className="text-muted-foreground mb-4">{tr("导入 ST 角色卡（PNG 或 JSON）开始建立你的收藏馆")}</p>
                <Button onClick={() => fileInputRef.current?.click()}>
                  <Plus className="w-4 h-4 mr-2" />{tr("导入角色卡")}</Button>
              </div>
            ) : (
              <>
                {filtered.length === 0 && (
                  <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
                    <p className="text-sm text-muted-foreground">{tr("没有找到符合当前筛选的角色卡")}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSearchQuery('');
                        setTypeFilter('all');
                        setTagFilters({});
                      }}
                    >{tr("清除全部筛选")}</Button>
                  </div>
                )}
                {prefs.viewMode === 'grid' ? (
                  /* 卡墙：auto-fill 按卡宽自动分列；卡图 2:3（红线：比例不可改、不加编号） */
                  <div className="space-y-7" ref={gridRef}>
                    {displayGroups.map((group) => (
                      <section key={group.key} aria-label={tr("{{v0}}分组", { v0: group.label })}>
                        {prefs.groupBy !== 'none' && (
                          <div className="mb-3 flex items-center gap-2.5">
                            <span className="h-4 w-1 rounded-full bg-brand" aria-hidden="true" />
                            <h2 className="font-serif text-base font-semibold text-[color:var(--text-primary)]">
                              {group.label}
                            </h2>
                            <span className="rounded-full bg-[var(--brand-active-bg)] px-2 py-0.5 text-[11px] text-brand">
                              {tr("{{v0}} 张", { v0: group.items.length })}</span>
                            <span className="h-px flex-1 bg-[color:var(--hairline-inner)]" aria-hidden="true" />
                          </div>
                        )}
                        <div className="grid gap-3.5 content-start" style={{ gridTemplateColumns }}>
                          {group.visible.map((c) => (
                            <CharacterTile
                              key={c.id}
                              character={c}
                              storyCount={storyCounts[c.id] ?? 0}
                              timestamp={lastPlayed[c.id] ?? c.updatedAt}
                              nameSize={nameSize}
                              introSize={introSize}
                              compact={prefs.cardWidth < CARD_W_COMPACT}
                              batchMode={selection.batchMode}
                              selected={selection.selected.has(c.id)}
                              onActivate={activate(c)}
                              actions={menuFor(
                                c,
                                'hover-reveal tap-target w-6 h-6 rounded-full bg-[rgba(0,0,0,0.65)] backdrop-blur-sm text-white/80 flex items-center justify-center',
                              )}
                              quickAction={prefs.cardWidth >= CARD_W_COMPACT ? (
                                <CharacterQuickPills
                                  hasStory={Boolean(latestStoryByChar[c.id])}
                                  busy={Boolean(latestStoryByChar[c.id] && startingStoryId === latestStoryByChar[c.id])}
                                  onReminisce={() => openReminisceStory(latestStoryByChar[c.id])}
                                  onContinueChat={() => { void continueStoryFromCard(latestStoryByChar[c.id]); }}
                                  onOpenGreetings={() => navigate(`/character/${c.id}?tab=greetings`)}
                                />
                              ) : undefined}
                            />
                          ))}
                        </div>
                        {group.hiddenCount > 0 && (
                          <button
                            type="button"
                            onClick={() => setExpandedGroups((prev) => new Set(prev).add(group.key))}
                            className="mt-2.5 w-full rounded-lg border border-dashed border-[color:var(--border-subtle)] py-2 text-xs text-muted-foreground transition-colors hover:border-brand hover:text-brand"
                          >{tr("展开「{{v0}}」剩余 {{v1}} 张", { v0: group.label, v1: group.hiddenCount })}</button>
                        )}
                      </section>
                    ))}
                  </div>
                ) : (
                  /* 列表视图：小缩略图 + 名字/简介 + 评分/故事数/时间 */
                  <div className="rounded-xl border border-border bg-[var(--bg-canvas)]">
                    <LibraryListHeader batchMode={selection.batchMode} />
                    <div className="divide-y divide-[color:var(--hairline-inner)]">
                      {pageItems.map((c) => (
                        <CharacterListRow
                          key={c.id}
                          character={c}
                          storyCount={storyCounts[c.id] ?? 0}
                          timestamp={lastPlayed[c.id] ?? c.updatedAt}
                          nameSize={rowNameSize}
                          introSize={introSize}
                          batchMode={selection.batchMode}
                          selected={selection.selected.has(c.id)}
                          onActivate={activate(c)}
                          actions={menuFor(
                            c,
                            'tap-target w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-[var(--hover-overlay)] hover:text-[color:var(--text-body)]',
                            'w-4 h-4',
                          )}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* 分组视图用「每组两行 + 展开」替代了分页，分页条在那儿没有意义 */}
                {filtered.length > 0 && !grouping && (
                  <LibraryPager
                    total={filtered.length}
                    page={page}
                    pageCount={pageCount}
                    pageSize={pageSize}
                    onPageSizeChange={prefs.setPageSize}
                    onPageChange={setPage}
                  />
                )}
              </>
            )}
          </div>
          )}
        </div>
      </LibraryDropOverlay>

      {selection.batchMode && (
        <LibraryBatchBar
          selectedCount={selection.selected.size}
          filteredCount={filtered.length}
          onSelectAllToggle={selection.toggleSelectAll}
          onTag={() => setBatchTagOpen(true)}
          onType={() => { setTagManagerCategory('类型'); setTagManagerOpen(true); }}
          onExport={() => void handleBatchExport()}
          exporting={batchExporting}
          onDelete={() => setPendingDelete(characters.filter((c) => selection.selected.has(c.id)))}
          onExit={selection.exitBatchMode}
        />
      )}

      <LibraryImportDialog
        open={pendingImport !== null}
        onOpenChange={(open) => !open && setPendingImport(null)}
        items={pendingImport?.items ?? []}
        failures={pendingImport?.failures ?? []}
        tagOptions={managedTagOptions}
        busy={importBusy}
        onConfirm={handleConfirmImport}
      />
      <TagManagerDialog
        initialCategory={tagManagerCategory}
        open={tagManagerOpen}
        onOpenChange={open => { setTagManagerOpen(open); if (!open && chatTagSetup) navigate('/play'); }}
        characters={characters}
        selectedCharacters={characters.filter((character) => selection.selected.has(character.id))}
        preferences={tagPreferences}
        onPreferencesChange={handleTagPreferencesChange}
        onChanged={load}
      />
      <BatchTagDialog
        open={batchTagOpen}
        onOpenChange={setBatchTagOpen}
        targets={characters.filter((c) => selection.selected.has(c.id))}
        allCharacters={characters}
        onDone={load}
      />

      <DeleteConfirmDialog open={!!pendingDelete} onOpenChange={open => !open && setPendingDelete(null)}
        title={pendingDelete?.length === 1 ? tr("删除「{{v0}}」？", { v0: displayCharacterName(pendingDelete[0]) }) : tr("删除所选 {{v0}} 个角色？", { v0: pendingDelete?.length ?? 0 })}
        description={tr("名下故事、总结、日记与角色附件会一并删除；共享资产保留。")}
        fileTargets={pendingDelete?.map(c => ({ store: 'characters', id: c.id }))}
        onConfirm={handleConfirmDelete} confirmLabel={tr("删除")} />

      <LibraryWebExportConfirmDialog
        targets={pendingWebExport}
        onClose={() => setPendingWebExport(null)}
        onConfirmBatch={(batch) => { void runWebExport(batch); }}
      />
    </AppLayout>
  );
};

export default function LibraryPage() {
  const epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch, getVaultEpoch);
  return <Library key={`${scopedKey('library')}:${epoch}`} />;
}
