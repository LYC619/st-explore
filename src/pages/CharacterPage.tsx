/**
 * 角色卡主页（10.3a 骨架重构，对照 _reference/0801.实测/角色卡界面设计/character-detail.html）：
 * - 左信息栏 272px（CharacterInfoRail）：立绘 3:4+lightbox / 信息行 / 操作抽屉
 * - 主列：头部（CharacterHeader：大标题+meta 编辑弹窗+折叠动画+标签条 NSFW 开关）
 *   + tab 导航（故事/备注/关联资产/立绘）+ tab 行右侧统一导入钮（10.3c，按当前 tab 预选类型）
 * - patchCharacter：评分→评价档位标签单向联动（10.0）+ 标签变化同步 nsfw 字段
 */
import { useState, useEffect, useMemo, useCallback, useLayoutEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, BookOpen, Download, Package, MessageSquare } from 'lucide-react';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Skeleton, StoryListSkeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import type { RemoveOptions } from '@/lib/repo';
import { duplicateArchiveStory } from '@/lib/story-maintenance';
import { useToast } from '@/hooks/use-toast';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import {
  getCharacter,
  getArchiveStory,
  getRoleplayPreferences,
  updateCharacter,
  getStoriesByCharacter,
  updateArchiveStory,
  deleteArchiveStory,
  deleteCharacter,
  sortStoriesForDisplay,
  markCharacterViewed,
  type ArchiveMetaRecord,
} from '@/lib/archive-db';
import { getCurrentRepo } from '@/lib/repo';
import { stScriptToRule, type STRegexScript } from '@/lib/st-regex-interop';
import { normalizeCharacterCard } from '@/lib/adapters/st';
import { applyCharacterTagPatch, applyCharacterTypePatch } from '@/lib/character-tag-domain';
import { importEmbeddedAssets } from '@/lib/card-embedded-assets';
import { characterExportName, downloadCharacterFile, downloadCharacterJson } from '@/lib/character-file';
import { CharacterWorldbookChoiceRequired } from '@/lib/character-export-snapshot';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { buildStoryFileExport, type StoryFileFormat } from '@/lib/story-file-export';
import { saveTextFile } from '@/lib/roleplay/export-package-file';
import { getVaultEpoch } from '@/lib/vault/active';
import { subscribePortraitCloudSaves } from '@/lib/portrait-cloud-task';
import { editsFromNormalized, exportCardJson, type CardEdits } from '@/lib/card-export';
import { applyCharacterPageCardEdits, applyCharacterPageDisplayMeta } from '@/lib/character-page-edit';
import { setPendingToolFile } from '@/lib/tool-handoff';
import { cn } from '@/lib/utils';
import { useViewport } from '@/hooks/use-viewport';
import { renameArchiveStory } from '@/lib/story-rename';
import { IMPORT_KINDS, type CharacterImportKind, type CharacterImportResult } from '@/lib/character-import';
import { importFilesForCharacter } from '@/lib/character-import';
import { commitCharacterPatch, type CharacterPatch } from '@/lib/character-write';
import { isPreparedCharacterMutation } from '@/lib/character-mutation';
import {
  buildEditorChatPath,
  buildEditorStoryPath,
  setEditorStoryId,
  type EditorStoryView,
} from '@/lib/editor-story-context';
import { CharacterInfoRail } from '@/components/character/CharacterInfoRail';
import { CharacterHeader } from '@/components/character/CharacterHeader';
import { CharacterLoadoutBar } from '@/components/character/CharacterLoadoutBar';
import { AssetSection } from '@/components/character/AssetSection';
import { useCharacterNeighbors } from '@/hooks/use-character-neighbors';
import { NotesSection } from '@/components/character/NotesSection';
import { PortraitSection } from '@/components/character/PortraitSection';
import { CharacterImportDialog } from '@/components/character/CharacterImportDialog';
import { StoryListSection } from '@/components/character/StoryListSection';
import { ReadingPackExportDialog } from '@/components/character/ReadingPackExportDialog';
import { InlineStoryReader, type FloorJumpRequest, type InlineStoryReaderHandle } from '@/components/character/InlineStoryReader';
import { StoryRecordsView, type RecordViewKind } from '@/components/character/StoryRecordsView';
import { CharacterCardEditSection } from '@/components/character/CharacterCardEditSection';
import { GreetingsSection } from '@/components/character/GreetingsSection';
import { LOADING_LABEL } from '@/lib/ui-copy';

/** 故事 tab 内的子视图：列表 | 总结/日记/故事树查看视图 */
type StorySubView = 'list' | RecordViewKind;

const STORY_SUB_VIEWS: { key: RecordViewKind; label: string }[] = [
  { key: 'volume', label: '总结' },
  { key: 'diary', label: '日记' },
  { key: 'tree', label: '故事树' },
];

/** tab → 导入弹窗预选类型 */
const TAB_IMPORT_KIND: Record<string, CharacterImportKind> = {
  stories: 'story',
  notes: 'quote',
  assets: 'worldbook',
  portraits: 'portrait',
};

const CharacterPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isMobile, isCompact } = useViewport();
  const [searchParams, setSearchParams] = useSearchParams();
  const [character, setCharacter] = useState<ArchiveCharacter | null>(null);
  const [stories, setStories] = useState<ArchiveStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [storyToDelete, setStoryToDelete] = useState<ArchiveStory | null>(null);
  const [charDeleteOpen, setCharDeleteOpen] = useState(false);
  // 就地阅读：?story=<id> 深链（首页最近故事跳入）；readingBranchId 区分显式主线 null、指定支线 string 与默认恢复 undefined
  const readingStoryId = searchParams.get('story');
  const requestedTab = searchParams.get('tab');
  const [readingBranchId, setReadingBranchId] = useState<string | null | undefined>(undefined);
  const [readingJumpRequest, setReadingJumpRequest] = useState<FloorJumpRequest | null>(null);
  const [readingReturnSubView, setReadingReturnSubView] = useState<StorySubView | null>(null);
  const jumpSeqRef = useRef(0);
  const [storySubView, setStorySubView] = useState<StorySubView>('list');
  // 统一导入弹窗（10.3c）：按当前 tab 预选类型
  const [activeTab, setActiveTab] = useState(() => (
    requestedTab && ['stories', 'notes', 'assets', 'portraits', 'card-edit', 'greetings'].includes(requestedTab)
      ? requestedTab
      : 'stories'
  ));
  const [importOpen, setImportOpen] = useState(false);
  const [packExportOpen, setPackExportOpen] = useState(false);
  const [exportChoice, setExportChoice] = useState<{ format: 'json' | 'file'; choices: { id: string; title: string }[] } | null>(null);
  const [cardEdits, setCardEdits] = useState<CardEdits | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [tavernUserName, setTavernUserName] = useState('你');
  const [cardSaving, setCardSaving] = useState(false);
  const [startingPlay, setStartingPlay] = useState(false);
  const [startingGreetingIdx, setStartingGreetingIdx] = useState<number | null>(null);
  const readerRef = useRef<InlineStoryReaderHandle>(null);
  const playPendingRef = useRef(false);
  const playStartLock = useRef(false);
  const contentColumnRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    contentColumnRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    setStorySubView('list');
    setReadingReturnSubView(null);
    setReadingJumpRequest(null);
  }, [id]);

  useEffect(() => {
    if (requestedTab && ['stories', 'notes', 'assets', 'portraits', 'card-edit', 'greetings'].includes(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [requestedTab, id]);

  useEffect(() => {
    let cancelled = false;
    getRoleplayPreferences(getCurrentRepo<ArchiveMetaRecord>('archiveMeta'))
      .then((prefs) => {
        if (!cancelled && typeof prefs.tavern?.username === 'string' && prefs.tavern.username.trim()) {
          setTavernUserName(prefs.tavern.username.trim());
        }
      })
      .catch(() => {
        // 读取偏好失败时回退默认称呼“你”，不影响角色页浏览
      });
    return () => { cancelled = true; };
  }, []);

  const changeActiveTab = useCallback((nextTab: string) => {
    setActiveTab(nextTab);
    if (searchParams.has('tab')) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('tab');
        return next;
      }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [c, s] = await Promise.all([getCharacter(id), getStoriesByCharacter(id)]);
      const viewed = c ? await markCharacterViewed(id).catch(() => undefined) : undefined;
      setCharacter(viewed ?? c ?? null);
      setStories(s);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => subscribePortraitCloudSaves(saved => {
    if (saved.id === id) setCharacter(saved);
  }), [id]);

  useEffect(() => {
    if (!character) return;
    setCardEdits(editsFromNormalized(normalizeCharacterCard(character.card)));
    setDisplayNameDraft(character.displayMeta?.name ?? '');
    // 有意只按 id 重置：页内整理（评分/标签）更新 character 时不能清掉未保存的卡编辑草稿。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character?.id]);

  // 展示名有两个编辑入口（头部铅笔弹窗 / 卡编辑页签）：档案值变化时同步草稿，防止旧草稿把另一入口刚保存的值回写掉。
  useEffect(() => {
    setDisplayNameDraft(character?.displayMeta?.name ?? '');
  }, [character?.displayMeta?.name]);

  const norm = useMemo(() => (character ? normalizeCharacterCard(character.card) : null), [character]);
  const cardDirty = useMemo(() => {
    if (!cardEdits || !norm) return false;
    return JSON.stringify(cardEdits) !== JSON.stringify(editsFromNormalized(norm));
  }, [cardEdits, norm]);
  const displayNameDirty = Boolean(character && (displayNameDraft.trim() || undefined) !== character.displayMeta?.name);
  const displayRegexRules = useMemo(() => {
    const rawScripts = norm?.extensions?.regex_scripts;
    if (!Array.isArray(rawScripts)) return [];
    return (rawScripts as STRegexScript[])
      .filter((s) => s && !s.disabled && !s.promptOnly)
      .map((s) => stScriptToRule(s));
  }, [norm]);

  /** 更新角色档案（整理信息属于本地元数据，updatedAt 跟随）。
   * 评分变化时联动评价档位标签（10.0，单向：评分→标签）；
   * 标签变化时同步 nsfw 字段（'卡面/NSFW' 在场即 true）。 */
  const patchCharacter = useCallback(async (patch: CharacterPatch): Promise<ArchiveCharacter> => {
    if (!id) throw new Error('角色档案不存在');
    try {
      return await commitCharacterPatch(
        id,
        async (current, context) => {
          const requested = typeof patch === 'function' ? await patch(current, context) : patch;
          if (!requested) return undefined;
          const prepared = isPreparedCharacterMutation(requested);
          const requestedPatch = prepared ? requested.patch : requested;
          let effective = ('rating' in requestedPatch || 'tags' in requestedPatch || 'nsfw' in requestedPatch)
            ? { ...requestedPatch, ...applyCharacterTagPatch(current, requestedPatch) }
            : requestedPatch;
          // 设类型统一走域函数，顺带清理历史误写的「类型/*」标签（与标签管理、导入两条路径一致）。
          if ('type' in requestedPatch && requestedPatch.type) {
            effective = { ...effective, ...applyCharacterTypePatch({ ...current, ...effective }, requestedPatch.type) };
          }
          const nextPatch = { ...effective, updatedAt: Date.now() };
          return prepared ? { ...requested, patch: nextPatch } : nextPatch;
        },
        updateCharacter,
        setCharacter,
        { onWarning: (report) => toast({ title: '立绘清理需要稍后重试', description: report.warnings.join('；'), variant: 'destructive' }) },
      );
    } catch (error) {
      toast({
        title: '保存角色档案失败',
        description: error instanceof Error ? error.message : '请检查库目录是否可写',
        variant: 'destructive',
      });
      throw error;
    }
  }, [id, toast]);

  const saveCardEdits = useCallback(async (): Promise<boolean> => {
    // 直跳到另一角色而新档案尚未加载完成时，character 仍是旧卡；禁止把旧卡整卡写进新 id。
    if (!character || character.id !== id || !cardEdits || cardSaving) return false;
    setCardSaving(true);
    try {
      const next = applyCharacterPageCardEdits(character, cardEdits);
      await patchCharacter({ name: next.name, subtitle: next.subtitle, card: next.card, pngBase64: next.pngBase64 });
      setCardEdits(editsFromNormalized(normalizeCharacterCard(next.card)));
      toast({ title: '角色卡已保存', description: '实际名、核心字段和开场白已更新。' });
      return true;
    } catch (error) {
      toast({ title: '角色卡保存失败', description: error instanceof Error ? error.message : '请检查内容后重试', variant: 'destructive' });
      return false;
    } finally {
      setCardSaving(false);
    }
  }, [cardEdits, cardSaving, character, id, patchCharacter, toast]);

  const saveDisplayName = useCallback(async () => {
    if (!character || character.id !== id) return;
    // 与档案值相同则跳过：避免多余写入和「已保存」噪音提示。
    if ((displayNameDraft.trim() || undefined) === character.displayMeta?.name) return;
    try {
      const next = applyCharacterPageDisplayMeta(character, { name: displayNameDraft });
      await patchCharacter({ displayMeta: next.displayMeta });
      toast({ title: '展示名已保存' });
    } catch (error) {
      toast({ title: '展示名保存失败', description: error instanceof Error ? error.message : '请重试', variant: 'destructive' });
    }
  }, [character, displayNameDraft, id, patchCharacter, toast]);

  /** 统一导入完成（10.3c）：patch 落库；故事导入后刷列表；弹窗保持打开可继续导 */
  const handleImport = async (kind: CharacterImportKind, files: File[]) => {
    if (!id) throw new Error('角色档案不存在');
    let result: CharacterImportResult | undefined;
    try {
      const saved = await updateCharacter(id, async (current) => {
        result = await importFilesForCharacter(current, kind, files);
        return result.patch ? { ...result.patch, updatedAt: Date.now() } : undefined;
      });
      if (!saved || !result) throw new Error('角色档案不存在');
      setCharacter(saved);
      if (kind === 'story' && result.ok > 0) await load();
      const label = IMPORT_KINDS.find((k) => k.kind === kind)?.label ?? '';
      toast({
        title: `${label}导入完成：成功 ${result.ok}${result.fail ? `，失败 ${result.fail}` : ''}`,
        variant: result.ok === 0 && result.fail > 0 ? 'destructive' : undefined,
      });
    } catch (error) {
      toast({
        title: '导入失败',
        description: error instanceof Error ? error.message : '请检查库目录是否可写',
        variant: 'destructive',
      });
      throw error;
    }
  };

  const handlePasteQuote = async (title: string, body: string) => {
    await patchCharacter((current) => ({
      quotes: [
        ...(current.quotes ?? []),
        { id: crypto.randomUUID(), title, body, addedAt: Date.now() },
      ],
    }));
    toast({ title: `已添加引用「${title}」` });
  };

  const handleConfirmDeleteStory = async (options: RemoveOptions) => {
    if (!storyToDelete) return;
    await deleteArchiveStory(storyToDelete.id, options);
    setStoryToDelete(null);
    await load();
    toast({ title: '故事已删除' });
  };

  const flushUnsavedCardEdits = useCallback(async (): Promise<boolean> => {
    if (cardDirty) {
      const ok = await saveCardEdits();
      if (!ok) return false;
    }
    if (displayNameDirty) {
      await saveDisplayName();
    }
    return true;
  }, [cardDirty, displayNameDirty, saveCardEdits, saveDisplayName]);

  const navigateWithGuard = useCallback(async (targetPath: string) => {
    if (!(await flushUnsavedCardEdits())) return;
    try {
      await readerRef.current?.flushPendingSave();
    } catch (error) {
      toast({
        title: '阅读进度尚未保存，已取消跳转',
        description: error instanceof Error ? error.message : '请检查文件库是否可写',
        variant: 'destructive',
      });
      return;
    }
    navigate(targetPath);
  }, [flushUnsavedCardEdits, navigate, toast]);

  const neighbors = useCharacterNeighbors(id, {
    disabled: Boolean(readingStoryId || importOpen || packExportOpen || exportChoice || storyToDelete || charDeleteOpen || cardSaving),
    onNavigateNeighbor: (targetId) => { void navigateWithGuard(`/character/${targetId}`); },
  });

  /** 编辑角色卡：把卡原件经内存交接送进编辑区角色卡工具（处理归编辑区的动线） */
  const handleEditCard = () => {
    if (!character) return;
    let file: File;
    if (character.pngBase64) {
      const bytes = Uint8Array.from(atob(character.pngBase64), (ch) => ch.charCodeAt(0));
      file = new File([bytes], `${character.name}.png`, { type: 'image/png' });
    } else {
      file = new File([exportCardJson(character.card)], `${character.name}.json`, { type: 'application/json' });
    }
    setPendingToolFile('card', file);
    navigate('/card-viewer');
  };

  /** 读取内置资源：重扫卡内嵌世界书/正则入库并挂关联（sourcePath 去重，不重复建） */
  const handleReadEmbedded = async () => {
    if (!character) return;
    try {
      let added = 0;
      let duplicates = 0;
      await patchCharacter(async (current) => {
        const refs = await importEmbeddedAssets(current, {
          onDuplicate: () => { duplicates++; },
        });
        const existing = current.assets ?? [];
        const merged = [...existing];
        for (const r of refs) {
          if (!merged.some((x) => x.kind === r.kind && x.assetId === r.assetId)) merged.push(r);
        }
        added = merged.length - existing.length;
        return added > 0 ? { assets: merged } : undefined;
      });
      if (added > 0) {
        toast({
          title: `已读取内置资源：新挂 ${added} 个关联`,
          description: duplicates > 0 ? `${duplicates} 个相同内容已导入过，已跳过重复创建。` : undefined,
        });
      } else if (duplicates > 0) {
        toast({ title: '内置资源已导入过', description: `${duplicates} 个相同内容已跳过。` });
      } else {
        toast({ title: '没有新的内置资源', description: '卡内嵌的世界书/正则已在关联列表里。' });
      }
    } catch {
      toast({ title: '读取内置资源失败', variant: 'destructive' });
    }
  };

  /** 删除角色及其故事、记录和角色自有文件；共享资产仍保留。 */
  const handleConfirmDeleteChar = async (options: RemoveOptions) => {
    if (!character) return;
    try {
      await deleteCharacter(character.id, options);
      toast({ title: `已删除「${character.name}」（名下故事与记录已一并移除）` });
      navigate('/library');
    } catch (e) {
      toast({
        title: '删除失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
      return false;
    }
  };

  const sortedStories = useMemo(() => sortStoriesForDisplay(stories), [stories]);
  /** 底部「开始阅读」的目标：排序后的第一条（sortStoriesForDisplay 已按最近在前） */
  const latestStory = sortedStories[0];

  // ===== 就地阅读与故事子视图（10.3b） =====

  const openReader = useCallback((
    storyId: string,
    branchId?: string | null,
    floorOverride?: number,
    returnSubView?: StorySubView | null,
  ) => {
    setReadingBranchId(branchId);
    setReadingJumpRequest(
      floorOverride !== undefined
        ? { floor: floorOverride, seq: ++jumpSeqRef.current }
        : null,
    );
    if (returnSubView !== undefined) setReadingReturnSubView(returnSubView);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('story', storyId);
      return next;
    });
  }, [setSearchParams]);

  const closeReader = useCallback(() => {
    const backToSubView = readingReturnSubView;
    setReadingBranchId(undefined);
    setReadingJumpRequest(null);
    setReadingReturnSubView(null);
    if (backToSubView) setStorySubView(backToSubView);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('story');
      return next;
    });
    // 阅读中可能改了标题/评分/进度，回列表重新拉一遍
    void load();
  }, [setSearchParams, load, readingReturnSubView]);

  /** 列表行内改状态/评分（就地落库，不动 lastViewedAt） */
  const patchStory = useCallback(async (storyId: string, patch: Partial<ArchiveStory>) => {
    await updateArchiveStory(storyId, () => ({ ...patch, updatedAt: Date.now() }));
    await load();
  }, [load]);

  /** 普通处理进入聊天工作台；整理/导出进入同一故事的明确子视图。 */
  const goWorkspace = useCallback((storyId: string, view?: EditorStoryView, branchId?: string | null) => {
    setEditorStoryId(storyId);
    if (!view || view === 'read') {
      navigate(buildEditorChatPath(storyId));
      return;
    }
    const state = branchId !== undefined ? { state: { branchId } } : undefined;
    navigate(buildEditorStoryPath(storyId, view), state);
  }, [navigate]);

  const exportJsonCard = async (worldbookId?: string) => {
    if (!character) return;
    try {
      const result = await downloadCharacterJson(character, worldbookId);
      if (result !== 'cancelled') toast({ title: result === 'downloaded' ? '已发起角色卡下载' : result === 'shared' ? '已分享角色卡' : '已导出角色卡 JSON', description: `${characterExportName(character)}.json` });
    } catch (error) {
      if (error instanceof CharacterWorldbookChoiceRequired) setExportChoice({ format: 'json', choices: error.choices });
      else toast({ title: '导出失败', description: (error as Error).message, variant: 'destructive' });
    }
  };

  const exportCardFile = async (worldbookId?: string) => {
    if (!character) return;
    try {
      const result = await downloadCharacterFile(character, worldbookId);
      if (result !== 'cancelled') toast({ title: result === 'downloaded' ? '已发起角色卡下载' : result === 'shared' ? '已分享角色卡' : '已导出角色卡',
        description: `${characterExportName(character)}.${character.pngBase64 ? 'png' : 'json'}` });
    } catch (error) {
      if (error instanceof CharacterWorldbookChoiceRequired) setExportChoice({ format: 'file', choices: error.choices });
      else toast({ title: '导出失败', description: (error as Error).message, variant: 'destructive' });
    }
  };

  const exportStoryFile = async (storyId: string, branchId: string | null, format: StoryFileFormat) => {
    const epoch = getVaultEpoch();
    try {
      await readerRef.current?.flushPendingSave();
      const current = await getArchiveStory(storyId);
      if (epoch !== getVaultEpoch()) throw new Error('文件库已切换，请重新打开故事');
      if (!current) throw new Error('故事不存在');
      const result = await saveTextFile(buildStoryFileExport(current, branchId, format));
      if (result !== 'cancelled') toast({ title: '导出成功', description: branchId ? '已导出所选分支' : '已导出故事主线' });
    } catch (error) { toast({ title: '导出失败', description: (error as Error).message, variant: 'destructive' }); }
  };

  const playStory = async (storyId: string, branchId: string | null) => {
    if (playPendingRef.current) return;
    playPendingRef.current = true;
    const epoch = getVaultEpoch();
    try {
      await readerRef.current?.flushPendingSave();
      const { prepareStoryPlay } = await import('@/lib/roleplay/open-story');
      if (epoch !== getVaultEpoch()) throw new Error('文件库已切换，请重新打开故事');
      const target = await prepareStoryPlay(storyId, branchId);
      if (epoch !== getVaultEpoch()) return;
      navigate(target.path);
    } catch (error) { toast({ title: '无法进入聊天', description: (error as Error).message, variant: 'destructive' }); }
    finally { playPendingRef.current = false; }
  };

  const branchAndPlayFromFloor = async (
    storyId: string,
    branchId: string | null,
    floor: number,
    targetMessageId?: string | null,
  ) => {
    if (playPendingRef.current) return;
    playPendingRef.current = true;
    const epoch = getVaultEpoch();
    try {
      await readerRef.current?.flushPendingSave();
      const { branchStoryFromFloor } = await import('@/lib/roleplay/branch-from-floor');
      if (epoch !== getVaultEpoch()) throw new Error('文件库已切换，请重新打开故事');
      const created = await branchStoryFromFloor(storyId, branchId, floor, { targetMessageId });
      if (epoch !== getVaultEpoch()) return;
      toast({
        title: `已开辟支线「${created.branchName}」`,
        description: `已保留前 ${created.floorCount} 楼剧情与设定，正在进入酒馆续聊…`,
      });
      navigate(created.playPath);
    } catch (error) {
      toast({
        title: '创建支线续聊未成功',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      playPendingRef.current = false;
    }
  };

  const startWithGreeting = async (greetingIndex: number) => {
    if (!character || character.id !== id || playStartLock.current) return;
    playStartLock.current = true;
    setStartingGreetingIdx(greetingIndex);
    const epoch = getVaultEpoch();
    try {
      if (!(await flushUnsavedCardEdits())) return;
      const { startCharacterStory } = await import('@/lib/roleplay/start-story');
      const storyId = await startCharacterStory(character.id, { greetingIndex });
      if (epoch !== getVaultEpoch()) return;
      navigate('/play/' + encodeURIComponent(storyId));
    } catch (error) {
      toast({
        title: '无法开启新对话',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      playStartLock.current = false;
      setStartingGreetingIdx(null);
    }
  };

  if (loading) {
    // 骨架照着真实版面摆：窄屏是封面+信息横排在顶部，桌面是左信息栏 272px + 右内容列。
    // 原来是一行居中的「加载中…」，数据到位那一瞬整页版面会跳一下。
    return (
      <AppLayout>
        <div
          className={cn('character-page h-full overflow-hidden', isMobile ? 'flex flex-col' : 'flex')}
          aria-busy="true"
          aria-label={LOADING_LABEL}
          data-character-skeleton
        >
          {isMobile ? (
            <div className="flex shrink-0 items-start gap-4 border-b border-[color:var(--border-subtle)] px-4 py-4">
              <Skeleton className="aspect-[2/3] w-[38%] max-w-[148px] shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 flex flex-col gap-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ) : (
            <div className="w-[304px] shrink-0 border-r border-[color:var(--hairline-inner)] px-4 py-4">
              <Skeleton className="aspect-[2/3] w-full rounded-xl" />
              <div className="mt-4 flex flex-col gap-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          )}
          <div className={cn('min-w-0 flex-1 flex flex-col pt-3', isMobile ? 'px-3 pb-4' : 'px-6 pb-6')}>
            <Skeleton className="h-8 w-64 shrink-0" />
            <StoryListSkeleton className="mt-3" count={isMobile ? 4 : 6} />
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!character || !norm) {
    return (
      <AppLayout>
        <div className="flex flex-col min-h-[50vh] items-center justify-center gap-4">
          <BookOpen className="w-16 h-16 text-muted-foreground/50" />
          <p className="text-muted-foreground">找不到该角色</p>
          <Button onClick={() => navigate('/library')}>返回角色库</Button>
        </div>
      </AppLayout>
    );
  }

  // tab 计数（10.3c）：资产含引用摘录与关联文件；立绘=各行图片合计
  const assetCount = (character.assets?.length ?? 0)
    + (character.quotes?.length ?? 0)
    + (character.attachments?.length ?? 0);
  const portraitCount = (character.portraitRows ?? []).reduce((n, r) => n + r.items.length, 0);

  return (
    <AppLayout
      leftActions={
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => { void navigateWithGuard('/library'); }}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            角色库
          </Button>
          {(neighbors.prev || neighbors.next) && !readingStoryId && (
            <div className="hidden sm:flex items-center gap-0.5 border-l border-[color:var(--hairline-inner)] pl-1.5 text-xs text-muted-foreground">
              <Button
                variant="ghost"
                size="icon"
                disabled={!neighbors.prev}
                onClick={() => neighbors.prev && void navigateWithGuard(`/character/${neighbors.prev.id}`)}
                aria-label={neighbors.prev ? `上一张角色卡：${neighbors.prev.name}` : '已是第一张角色卡'}
                title={neighbors.prev ? `上一张：${neighbors.prev.name}（快捷键 [ ）` : '已是第一张'}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              {neighbors.positionLabel && (
                <span className="px-1 tabular-nums text-[11px]">{neighbors.positionLabel}</span>
              )}
              <Button
                variant="ghost"
                size="icon"
                disabled={!neighbors.next}
                onClick={() => neighbors.next && void navigateWithGuard(`/character/${neighbors.next.id}`)}
                aria-label={neighbors.next ? `下一张角色卡：${neighbors.next.name}` : '已是最后一张角色卡'}
                title={neighbors.next ? `下一张：${neighbors.next.name}（快捷键 ] ）` : '已是最后一张'}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      }
    >
       <div className={cn('character-page h-full overflow-hidden', isMobile ? 'flex flex-col' : 'flex')}>
        {/* ===== 左信息栏 272px（窄屏堆到顶部，跟着主列一起滚） ===== */}
        {!isMobile && (
          <CharacterInfoRail
            character={character}
            norm={norm}
            stories={sortedStories}
            onPatch={patchCharacter}
            onEditCard={handleEditCard}
            onReadEmbedded={handleReadEmbedded}
            onExport={() => { void exportCardFile(); }}
            onExportJson={() => { void exportJsonCard(); }}
            onDelete={() => setCharDeleteOpen(true)}
          />
        )}

        {/* ===== 主列：头部 + tabs（就地阅读时头部收起，返回列表自动展开） ===== */}
        <div ref={contentColumnRef} className="flex-1 min-w-0 min-h-0 flex flex-col overflow-y-auto scrollbar-thin">
          {/* 就地阅读时把封面信息块一起收掉：手机屏幕上它会把正文挤到折叠线以下 */}
          {isMobile && !readingStoryId && (
            <CharacterInfoRail
              stacked
              character={character}
              norm={norm}
              stories={sortedStories}
              onPatch={patchCharacter}
              onEditCard={handleEditCard}
              onReadEmbedded={handleReadEmbedded}
              onExport={() => { void exportCardFile(); }}
              onExportJson={() => { void exportJsonCard(); }}
              onDelete={() => setCharDeleteOpen(true)}
            />
          )}

          <CharacterHeader
            character={character}
            norm={norm}
            onPatch={patchCharacter}
            collapsed={readingStoryId ? true : undefined}
          />

          {!readingStoryId && (
            <CharacterLoadoutBar
              character={character}
              norm={norm}
              onSelectTab={changeActiveTab}
            />
          )}

          <Tabs
            value={activeTab}
            onValueChange={changeActiveTab}
            className={cn('flex-1 flex flex-col pt-3', isMobile ? 'px-3 pb-4' : 'px-6 pb-6')}
          >
            {/* TabsList 用 flex（布局铁律：防插件包裹破坏 grid）；行右侧=统一导入钮（10.3c） */}
            <div className="flex flex-wrap items-center gap-2">
               <TabsList className="flex w-fit flex-wrap gap-1">
                 <TabsTrigger value="stories">故事 {stories.length > 0 && <span className="ml-1 text-[11px] opacity-70">{stories.length}</span>}</TabsTrigger>
                 <TabsTrigger value="notes">备注 {(character.notes?.length ?? 0) > 0 && <span className="ml-1 text-[11px] opacity-70">{character.notes!.length}</span>}</TabsTrigger>
                 <TabsTrigger value="assets">关联资产 {assetCount > 0 && <span className="ml-1 text-[11px] opacity-70">{assetCount}</span>}</TabsTrigger>
                 <TabsTrigger value="portraits">立绘 {portraitCount > 0 && <span className="ml-1 text-[11px] opacity-70">{portraitCount}</span>}</TabsTrigger>
                 <TabsTrigger value="card-edit">角色卡编辑</TabsTrigger>
                 <TabsTrigger value="greetings">开场白</TabsTrigger>
               </TabsList>
               {activeTab === 'stories' && <Button size="sm" disabled={startingPlay} onClick={() => {
                 if (playStartLock.current || character.id !== id) return;
                 const epoch = getVaultEpoch();
                 playStartLock.current = true; setStartingPlay(true);
                 void flushUnsavedCardEdits()
                   .then(ok => {
                     if (!ok) return null;
                     return import('@/lib/roleplay/start-story').then(module => module.startCharacterStory(character.id));
                   })
                   .then(storyId => {
                     if (storyId && epoch === getVaultEpoch()) navigate('/play/' + encodeURIComponent(storyId));
                   })
                   .catch(error => toast({ title: '无法开始新聊天', description: error instanceof Error ? error.message : String(error), variant: 'destructive' }))
                   .finally(() => { playStartLock.current = false; setStartingPlay(false); });
               }}><MessageSquare className="mr-1 h-3.5 w-3.5" />{startingPlay ? '正在打开…' : '新开聊天'}</Button>}
               {/* 导出阅读包：只在故事 tab 且有故事时给——包的主体就是故事正文，
                   空卡导出一个只有卡面的包没有意义 */}
               {activeTab === 'stories' && stories.length > 0 && (
                 <Button
                   variant="outline"
                   size="sm"
                   className="ml-auto"
                   onClick={() => setPackExportOpen(true)}
                   title="打包这张卡和选中的故事，在手机上导入阅读"
                 >
                   <Package className="w-3.5 h-3.5 mr-1" />
                   {isCompact ? '阅读包' : '导出阅读包'}
                 </Button>
               )}
               {TAB_IMPORT_KIND[activeTab] && (
                 <Button
                   variant="outline"
                   size="sm"
                   className={activeTab === 'stories' && stories.length > 0 ? '' : 'ml-auto'}
                   onClick={() => setImportOpen(true)}
                 >
                   <Download className="w-3.5 h-3.5 mr-1" />
                   导入
                 </Button>
               )}
            </div>

            {/* 故事 tab：就地阅读 / 列表+子视图（总结/日记/故事树，10.3b） */}
            <TabsContent value="stories" className="mt-3">
              {readingStoryId ? (
                <InlineStoryReader
                  ref={readerRef}
                  storyId={readingStoryId}
                  stories={sortedStories}
                  initialBranchId={readingBranchId}
                  jumpRequest={readingJumpRequest}
                  backLabel={
                    readingReturnSubView === 'volume'
                      ? '返回总结'
                      : readingReturnSubView === 'diary'
                        ? '返回日记'
                        : readingReturnSubView === 'tree'
                          ? '返回故事树'
                          : '故事列表'
                  }
                  onSwitchStory={(sid) => openReader(sid, undefined, undefined, null)}
                  onBack={closeReader}
                  onOpenEditor={(sid) => goWorkspace(sid)}
                  onOpenChat={(sid, branchId) => { void playStory(sid, branchId); }}
                  onBranchChatFromFloor={(sid, branchId, floor, msgId) => { void branchAndPlayFromFloor(sid, branchId, floor, msgId); }}
                  onCharacterUpdated={setCharacter}
                />
              ) : (
                <div className="space-y-3">
                  {/* 子视图切换：故事列表 › 总结/日记/故事树（设计稿的三个子 tab） */}
                  <div className="flex items-center gap-1 text-xs">
                    <button
                      type="button"
                      className={cn(
                        'rounded-md px-2 py-1 transition-colors',
                        storySubView === 'list' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                      )}
                      onClick={() => setStorySubView('list')}
                    >
                      故事列表
                    </button>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
                    {STORY_SUB_VIEWS.map((v) => (
                      <button
                        type="button"
                        key={v.key}
                        className={cn(
                          'rounded-md px-2 py-1 transition-colors',
                          storySubView === v.key ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                        )}
                        onClick={() => setStorySubView(v.key)}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>

                  {storySubView !== 'list' ? (
                    <StoryRecordsView
                      stories={sortedStories}
                      kind={storySubView}
                      onGoGenerate={(sid, kind, branchId) => goWorkspace(sid, kind, branchId)}
                      onJumpToFloor={(sid, branchId, floor) => {
                        const fromSubView = storySubView;
                        setStorySubView('list');
                        openReader(sid, branchId ?? null, floor, fromSubView);
                      }}
                    />
                  ) : stories.length === 0 ? (
                    <Card>
                      <CardContent className="py-10 text-center text-sm text-muted-foreground">
                        还没有故事。点右上角「导入」，把 ST 聊天记录（JSONL）挂到这张卡下。
                      </CardContent>
                    </Card>
                  ) : (
                    <StoryListSection
                      stories={sortedStories}
                      activeStoryId={readingStoryId}
                      onRead={openReader}
                      onProcess={(sid) => goWorkspace(sid)}
                      onExport={(sid) => goWorkspace(sid, 'io')}
                      onExportFile={(sid, branchId, format) => { void exportStoryFile(sid, branchId, format); }}
                      onPlay={(sid, branchId) => { void playStory(sid, branchId); }}
                      onDelete={setStoryToDelete}
                      onCopy={async sid => {
                        const copy = await duplicateArchiveStory(sid);
                        await load();
                        toast({ title: '已复制故事', description: copy.title });
                      }}
                      onPatchStory={(sid, patch) => void patchStory(sid, patch)}
                      onRenameStory={async (sid, title) => {
                        await renameArchiveStory(sid, title);
                        await load();
                      }}
                    />
                  )}
                </div>
              )}
            </TabsContent>

            {/* 备注 tab（10.3c CRUD） */}
            <TabsContent value="notes" className="mt-3">
              <NotesSection
                key={character.id}
                characterId={character.id}
                notes={character.notes ?? []}
                onChange={async (notes) => {
                  await patchCharacter({ notes });
                }}
              />
            </TabsContent>

            {/* 关联资产 tab（10.3c：宽抽屉预览 + 引用条目 + 导入/读取内置入口） */}
            <TabsContent value="assets" className="mt-3">
              <AssetSection
                key={character.id}
                character={character}
                onAssetsChange={async (assets) => {
                  await patchCharacter({ assets });
                }}
                onQuotesChange={async (quotes) => {
                  await patchCharacter({ quotes });
                }}
                onPatch={patchCharacter}
                onReadEmbedded={handleReadEmbedded}
                onOpenImport={() => setImportOpen(true)}
              />
            </TabsContent>

            {/* 立绘 tab（10.3c 分行式，网页版 IDB 与客户端行文件夹同构） */}
             <TabsContent value="portraits" className="mt-3">
              <PortraitSection
                character={character}
                onPatch={patchCharacter}
                onOpenImport={() => setImportOpen(true)}
              />
             </TabsContent>

             <TabsContent value="card-edit" className="mt-3">
               {cardEdits && (
                 <CharacterCardEditSection
                   edits={cardEdits}
                   displayName={displayNameDraft}
                   onEditChange={(key, value) => setCardEdits((current) => (current ? { ...current, [key]: value } : current))}
                   onDisplayNameChange={setDisplayNameDraft}
                   onSave={async () => {
                     // 卡片保存失败时不再继续保存展示名，避免「失败+已保存」两条矛盾提示。
                     if (await saveCardEdits()) await saveDisplayName();
                   }}
                   saving={cardSaving}
                 />
               )}
             </TabsContent>

             <TabsContent value="greetings" className="mt-3">
               {cardEdits && (
                 <GreetingsSection
                   key={character.id}
                   edits={cardEdits}
                   characterName={character.displayMeta?.name || character.name}
                   userName={tavernUserName}
                   displayRegexRules={displayRegexRules}
                   dirty={cardDirty}
                   saving={cardSaving}
                   onSave={() => { void saveCardEdits(); }}
                   onEditChange={(key, value) => setCardEdits((current) => (current ? { ...current, [key]: value } : current))}
                   onStartWithGreeting={(greetingIdx) => { void startWithGreeting(greetingIdx); }}
                   startingGreetingIndex={startingGreetingIdx}
                 />
               )}
             </TabsContent>
          </Tabs>
        </div>

        {/*
          底部固定「开始阅读」：手机上拇指够得着的位置只有这一条。
          它是主列的兄弟节点而不是 fixed 定位——外壳底下还有一条标签栏，
          fixed 就得跟着它的高度算偏移，flex 里 shrink-0 自然叠在它上面。
          就地阅读时收起（阅读器自带返回和进度条）。
        */}
        {isMobile && !readingStoryId && latestStory && (
          <div className="shrink-0 border-t border-[color:var(--border-subtle)] bg-chrome px-3 py-2">
            <Button
              className="w-full"
              onClick={() => { setActiveTab('stories'); openReader(latestStory.id); }}
            >
              <BookOpen className="mr-1.5 h-4 w-4" />
              开始阅读
              <span className="ml-1.5 min-w-0 truncate text-xs opacity-75">{latestStory.title}</span>
            </Button>
          </div>
        )}
      </div>

      <CharacterImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        initialKind={TAB_IMPORT_KIND[activeTab] ?? 'story'}
        onImport={handleImport}
        onPasteQuote={handlePasteQuote}
      />

      <Dialog open={!!exportChoice} onOpenChange={open => { if (!open) setExportChoice(null); }}>
        <DialogContent><DialogHeader><DialogTitle>选择本次导出的世界书</DialogTitle>
          <DialogDescription>当前角色有多个同级绑定。仅将所选世界书装入这次角色卡，不改变库内关联。</DialogDescription></DialogHeader>
          {exportChoice?.choices.map(choice => <Button key={choice.id} variant="outline" onClick={() => {
            const format = exportChoice.format; setExportChoice(null);
            void (format === 'json' ? exportJsonCard(choice.id) : exportCardFile(choice.id));
          }}>{choice.title}</Button>)}
        </DialogContent>
      </Dialog>

      <ReadingPackExportDialog
        open={packExportOpen}
        onOpenChange={setPackExportOpen}
        character={character}
        stories={sortedStories}
      />

      <DeleteConfirmDialog open={!!storyToDelete} onOpenChange={open => !open && setStoryToDelete(null)}
        title={`删除故事「${storyToDelete?.title}」？`}
        description="日记、总结和故事树会保留为未绑定记录。"
        fileTarget={storyToDelete ? { store: 'archiveStories', id: storyToDelete.id } : undefined}
        onConfirm={handleConfirmDeleteStory} />

      <DeleteConfirmDialog open={charDeleteOpen} onOpenChange={setCharDeleteOpen}
        title={`删除「${character.name}」？`}
        description="名下故事、总结、日记与角色附件会一并删除；共享资产保留。"
        fileTarget={{ store: 'characters', id: character.id }}
        onConfirm={handleConfirmDeleteChar} />
    </AppLayout>
  );
};

export default CharacterPage;
