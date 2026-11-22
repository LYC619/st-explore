/**
 * 角色卡主页（10.3a 骨架重构，对照 _reference/0801.实测/角色卡界面设计/character-detail.html）：
 * - 左信息栏 272px（CharacterInfoRail）：立绘 3:4+lightbox / 信息行 / 操作抽屉
 * - 主列：头部（CharacterHeader：大标题+meta 编辑弹窗+折叠动画+标签条 NSFW 开关）
 *   + tab 导航（故事/备注/关联资产/立绘）+ tab 行右侧统一导入钮（10.3c，按当前 tab 预选类型）
 * - patchCharacter：评分→评价档位标签单向联动（10.0）+ 标签变化同步 nsfw 字段
 */
import { useState, useEffect, useMemo, useCallback, useLayoutEffect, useRef, useContext } from 'react';
import { useParams, useNavigate, useSearchParams, UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { buildStoryFileExport, type StoryFileFormat } from '@/lib/story-file-export';
import { saveTextFile } from '@/lib/roleplay/export-package-file';
import {
  closeDetachedTavernWindow,
  getRoleplaySessionSnapshot,
  launchRoleplayTarget,
  preopenDetachedTavernWindow,
  setRoleplayOpenChat,
} from '@/lib/roleplay/detached-window';
import { getVaultEpoch } from '@/lib/vault/active';
import { subscribePortraitCloudSaves } from '@/lib/portrait-cloud-task';
import { editsFromNormalized, type CardEdits } from '@/lib/card-export';
import { applyCharacterPageCardEdits, applyCharacterPageDisplayMeta } from '@/lib/character-page-edit';
import { cn } from '@/lib/utils';
import { useViewport } from '@/hooks/use-viewport';
import { renameArchiveStory } from '@/lib/story-rename';
import { IMPORT_KINDS, type CharacterImportKind, type CharacterImportResult } from '@/lib/character-import';
import { importFilesForCharacter } from '@/lib/character-import';
import { commitCharacterPatch, type CharacterPatch } from '@/lib/character-write';
import { isPreparedCharacterMutation } from '@/lib/character-mutation';
import {
  buildEditorStoryPath,
  buildStoryReadPath,
  setEditorStoryId,
  type EditorStoryView,
} from '@/lib/editor-story-context';
import { CharacterInfoRail } from '@/components/character/CharacterInfoRail';
import { CharacterHeader } from '@/components/character/CharacterHeader';
import { AssetSection } from '@/components/character/AssetSection';
import { useCharacterNeighbors } from '@/hooks/use-character-neighbors';
import { NotesSection } from '@/components/character/NotesSection';
import { PortraitSection } from '@/components/character/PortraitSection';
import { CharacterImportDialog } from '@/components/character/CharacterImportDialog';
import { StoryListSection } from '@/components/character/StoryListSection';
import { ReadingPackExportDialog } from '@/components/character/ReadingPackExportDialog';
import { StoryRecordsView, type RecordViewKind } from '@/components/character/StoryRecordsView';
import { CharacterCardEditSection } from '@/components/character/CharacterCardEditSection';
import { GreetingsSection } from '@/components/character/GreetingsSection';
import { LOADING_LABEL } from '@/lib/ui-copy';

/** 故事 tab 内的子视图：列表 | 总结/日记/自定义记录/故事树查看视图 */
type StorySubView = 'list' | RecordViewKind;

const STORY_SUB_VIEWS: { key: RecordViewKind; label: string }[] = [
  { key: 'volume', label: '总结' },
  { key: 'diary', label: '日记' },
  { key: 'diy', label: '自定义记录' },
  { key: 'tree', label: '故事树' },
];

/** tab → 导入弹窗预选类型 */
const TAB_IMPORT_KIND: Record<string, CharacterImportKind> = {
  stories: 'story',
  notes: 'quote',
  assets: 'worldbook',
  portraits: 'portrait',
};

function CharacterRouteBlocker({
  dirty,
  saving,
  flush,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  flush: () => Promise<boolean>;
  onDiscard: () => void;
}) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    dirty && currentLocation.pathname !== nextLocation.pathname
  ));

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  if (blocker.state !== 'blocked') return null;

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !saving) blocker.reset(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>角色卡设定还未保存</AlertDialogTitle>
          <AlertDialogDescription>
            你刚修改了人设、展示名或开场白，离开当前页面会丢失未保存的改动。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus disabled={saving} onClick={() => blocker.reset()}>
            继续编辑
          </AlertDialogCancel>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => {
              onDiscard();
              blocker.proceed();
            }}
          >
            放弃修改并离开
          </Button>
          <AlertDialogAction
            disabled={saving}
            onClick={(event) => {
              event.preventDefault();
              void flush().then((ok) => {
                if (ok) blocker.proceed();
              });
            }}
          >
            {saving ? '保存中…' : '保存并离开'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SafeCharacterRouteBlocker(props: {
  dirty: boolean;
  saving: boolean;
  flush: () => Promise<boolean>;
  onDiscard: () => void;
}) {
  const router = useContext(UNSAFE_DataRouterContext);
  return router ? <CharacterRouteBlocker {...props} /> : null;
}

const CharacterPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isMobile, isCompact } = useViewport();
  const [searchParams, setSearchParams] = useSearchParams();
  const [character, setCharacter] = useState<ArchiveCharacter | null>(null);
  const [stories, setStories] = useState<ArchiveStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadSeqRef = useRef(0);
  const [storyToDelete, setStoryToDelete] = useState<ArchiveStory | null>(null);
  const [charDeleteOpen, setCharDeleteOpen] = useState(false);
  // 兼容旧 ?story=<id> 书签直跳大屏故事工作区
  const legacyReadingStoryId = searchParams.get('story');
  const requestedTab = searchParams.get('tab');
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
  const playPendingRef = useRef(false);
  const playStartLock = useRef(false);
  const contentColumnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!legacyReadingStoryId) return;
    setEditorStoryId(legacyReadingStoryId);
    navigate(buildStoryReadPath(legacyReadingStoryId), { replace: true });
  }, [legacyReadingStoryId, navigate]);

  useLayoutEffect(() => {
    contentColumnRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    setStorySubView('list');
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

  const load = useCallback(async (resetCharacter = false) => {
    if (!id) return;
    const seq = ++loadSeqRef.current;
    const epoch = getVaultEpoch();
    setLoadError(null);
    if (resetCharacter) {
      setLoading(true);
      setCharacter(null);
      setStories([]);
    }
    try {
      const [c, s] = await Promise.all([getCharacter(id), getStoriesByCharacter(id)]);
      if (seq !== loadSeqRef.current || epoch !== getVaultEpoch()) return;
      const viewed = c ? await markCharacterViewed(id).catch(() => undefined) : undefined;
      if (seq !== loadSeqRef.current || epoch !== getVaultEpoch()) return;
      setCharacter(viewed ?? c ?? null);
      setStories(s);
    } catch (error) {
      if (seq !== loadSeqRef.current || epoch !== getVaultEpoch()) return;
      setCharacter(null);
      setStories([]);
      setLoadError(error instanceof Error ? error.message : '读取角色档案失败，请检查文件库连接后重试');
    } finally {
      if (seq === loadSeqRef.current && epoch === getVaultEpoch()) {
        setLoading(false);
      }
    }
  }, [id]);

  useEffect(() => {
    void load(true);
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

  const discardCardEdits = useCallback(() => {
    if (!character) return;
    setCardEdits(editsFromNormalized(normalizeCharacterCard(character.card)));
    setDisplayNameDraft(character.displayMeta?.name ?? '');
  }, [character]);

  const saveCardEdits = useCallback(async (): Promise<ArchiveCharacter | null> => {
    // 直跳到另一角色而新档案尚未加载完成时，character 仍是旧卡；禁止把旧卡整卡写进新 id。
    if (!character || character.id !== id || !cardEdits || cardSaving) return null;
    setCardSaving(true);
    try {
      const next = applyCharacterPageCardEdits(character, cardEdits);
      const saved = await patchCharacter({ name: next.name, subtitle: next.subtitle, card: next.card, pngBase64: next.pngBase64 });
      setCardEdits(editsFromNormalized(normalizeCharacterCard(saved.card)));
      toast({ title: '角色卡已保存', description: '实际名、核心字段和开场白已更新。' });
      return saved;
    } catch (error) {
      toast({ title: '角色卡保存失败', description: error instanceof Error ? error.message : '请检查内容后重试', variant: 'destructive' });
      return null;
    } finally {
      setCardSaving(false);
    }
  }, [cardEdits, cardSaving, character, id, patchCharacter, toast]);

  const saveDisplayName = useCallback(async (): Promise<ArchiveCharacter | null> => {
    if (!character || character.id !== id) return null;
    // 与档案值相同则跳过：避免多余写入和「已保存」噪音提示。
    if ((displayNameDraft.trim() || undefined) === character.displayMeta?.name) return character;
    try {
      const next = applyCharacterPageDisplayMeta(character, { name: displayNameDraft });
      const saved = await patchCharacter({ displayMeta: next.displayMeta });
      toast({ title: '展示名已保存' });
      return saved;
    } catch (error) {
      toast({ title: '展示名保存失败', description: error instanceof Error ? error.message : '请重试', variant: 'destructive' });
      return null;
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
    const activeSession = getRoleplaySessionSnapshot();
    if (activeSession.openChat?.id === storyToDelete.id) {
      if (activeSession.generating) {
        toast({
          title: '无法删除正在生成的故事',
          description: '请先在酒馆窗口停止本轮生成或关闭该对话后再删除。',
          variant: 'destructive',
        });
        return;
      }
      closeDetachedTavernWindow();
      setRoleplayOpenChat(null);
    }
    await deleteArchiveStory(storyToDelete.id, options);
    setStoryToDelete(null);
    await load();
    toast({ title: '故事已删除' });
  };

  const ensureLatestSavedCharacter = useCallback(async (): Promise<ArchiveCharacter | null> => {
    if (!character || character.id !== id) return null;
    let latest: ArchiveCharacter = character;
    if (cardDirty) {
      const saved = await saveCardEdits();
      if (!saved) return null;
      latest = saved;
    }
    if (displayNameDirty) {
      const saved = await saveDisplayName();
      if (!saved) return null;
      latest = saved;
    }
    return latest;
  }, [cardDirty, character, displayNameDirty, id, saveCardEdits, saveDisplayName]);

  const flushUnsavedCardEdits = useCallback(async (): Promise<boolean> => {
    const latest = await ensureLatestSavedCharacter();
    return Boolean(latest);
  }, [ensureLatestSavedCharacter]);

  const neighbors = useCharacterNeighbors(id, {
    disabled: Boolean(importOpen || packExportOpen || exportChoice || storyToDelete || charDeleteOpen || cardSaving),
    onNavigateNeighbor: (targetId) => { navigate(`/character/${targetId}`); },
  });

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
  const latestStory = sortedStories[0];

  // ===== 大屏故事阅读与子视图 =====

  const openReader = useCallback((
    storyId: string,
    branchId?: string | null,
    floorOverride?: number,
  ) => {
    setEditorStoryId(storyId);
    navigate(buildStoryReadPath(storyId, { branchId, floor: floorOverride }));
  }, [navigate]);

  /** 列表行内改状态/评分（就地落库，不动 lastViewedAt） */
  const patchStory = useCallback(async (storyId: string, patch: Partial<ArchiveStory>) => {
    try {
      await updateArchiveStory(storyId, () => ({ ...patch, updatedAt: Date.now() }));
      await load();
    } catch (error) {
      toast({
        title: '保存故事状态失败',
        description: error instanceof Error ? error.message : '请检查文件库是否可写后重试',
        variant: 'destructive',
      });
    }
  }, [load, toast]);

  /** 故事阅读与编辑、总结整理、导入导出统一进入大屏故事工作区 `/story/:id`。 */
  const goWorkspace = useCallback((storyId: string, view?: EditorStoryView, branchId?: string | null) => {
    setEditorStoryId(storyId);
    if (!view || view === 'read') {
      navigate(buildStoryReadPath(storyId, { branchId }));
      return;
    }
    const state = branchId !== undefined ? { state: { branchId } } : undefined;
    navigate(buildEditorStoryPath(storyId, view), state);
  }, [navigate]);

  const exportJsonCard = async (worldbookId?: string) => {
    if (!character) return;
    const target = (cardDirty || displayNameDirty) ? await ensureLatestSavedCharacter() : character;
    if (!target) return;
    try {
      const result = await downloadCharacterJson(target, worldbookId);
      if (result !== 'cancelled') toast({ title: result === 'downloaded' ? '已发起角色卡下载' : result === 'shared' ? '已分享角色卡' : '已导出角色卡 JSON', description: `${characterExportName(target)}.json` });
    } catch (error) {
      if (error instanceof CharacterWorldbookChoiceRequired) setExportChoice({ format: 'json', choices: error.choices });
      else toast({ title: '导出失败', description: (error as Error).message, variant: 'destructive' });
    }
  };

  const exportCardFile = async (worldbookId?: string) => {
    if (!character) return;
    const target = (cardDirty || displayNameDirty) ? await ensureLatestSavedCharacter() : character;
    if (!target) return;
    try {
      const result = await downloadCharacterFile(target, worldbookId);
      if (result !== 'cancelled') toast({ title: result === 'downloaded' ? '已发起角色卡下载' : result === 'shared' ? '已分享角色卡' : '已导出角色卡',
        description: `${characterExportName(target)}.${target.pngBase64 ? 'png' : 'json'}` });
    } catch (error) {
      if (error instanceof CharacterWorldbookChoiceRequired) setExportChoice({ format: 'file', choices: error.choices });
      else toast({ title: '导出失败', description: (error as Error).message, variant: 'destructive' });
    }
  };

  const exportStoryFile = async (storyId: string, branchId: string | null, format: StoryFileFormat) => {
    const epoch = getVaultEpoch();
    try {
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
    const reservation = preopenDetachedTavernWindow();
    try {
      if (!(await flushUnsavedCardEdits())) {
        reservation?.cancelIfUnused();
        return;
      }
      const { prepareStoryPlay } = await import('@/lib/roleplay/open-story');
      if (epoch !== getVaultEpoch()) throw new Error('文件库已切换，请重新打开故事');
      const target = await prepareStoryPlay(storyId, branchId);
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
    } catch (error) {
      reservation?.cancelIfUnused();
      toast({ title: '无法进入聊天', description: (error as Error).message, variant: 'destructive' });
    } finally {
      playPendingRef.current = false;
    }
  };

  const startWithGreeting = async (greetingIndex: number) => {
    if (!character || character.id !== id || playStartLock.current) return;
    playStartLock.current = true;
    setStartingGreetingIdx(greetingIndex);
    const epoch = getVaultEpoch();
    const reservation = preopenDetachedTavernWindow();
    try {
      if (!(await flushUnsavedCardEdits())) {
        reservation?.cancelIfUnused();
        return;
      }
      const { startCharacterStory } = await import('@/lib/roleplay/start-story');
      const storyId = await startCharacterStory(character.id, { greetingIndex });
      if (epoch !== getVaultEpoch()) {
        reservation?.cancelIfUnused();
        return;
      }
      launchRoleplayTarget({ storyId, navigate, reservation });
    } catch (error) {
      reservation?.cancelIfUnused();
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

  if (loadError) {
    return (
      <AppLayout>
        <div role="alert" className="flex flex-col min-h-[50vh] items-center justify-center gap-3 px-4 text-center">
          <BookOpen className="w-12 h-12 text-muted-foreground/50" />
          <p className="font-medium text-foreground">角色档案暂时没能读出来，库里的原文件未受影响</p>
          <p className="max-w-md break-words text-sm text-muted-foreground">{loadError}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/library')}>返回角色库</Button>
            <Button onClick={() => void load(true)}>重新读取</Button>
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

  // tab 计数（10.3c）：资产含引用摘录与关联文件；立绘=各行图片合计；开场白=首段+备选
  const assetCount = (character.assets?.length ?? 0)
    + (character.quotes?.length ?? 0)
    + (character.attachments?.length ?? 0);
  const portraitCount = (character.portraitRows ?? []).reduce((n, r) => n + r.items.length, 0);
  const greetingCount = (norm.firstMessage.trim() ? 1 : 0)
    + norm.alternateGreetings.filter((g) => g.trim()).length;
  const showTopImport = activeTab === 'stories' || activeTab === 'notes';

  return (
    <AppLayout
      leftActions={
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => navigate('/library')}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            角色库
          </Button>
          {(neighbors.prev || neighbors.next) && (
            <div className="hidden sm:flex items-center gap-0.5 border-l border-[color:var(--hairline-inner)] pl-1.5 text-xs text-muted-foreground">
              <Button
                variant="ghost"
                size="icon"
                disabled={!neighbors.prev}
                onClick={() => neighbors.prev && navigate(`/character/${neighbors.prev.id}`)}
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
                onClick={() => neighbors.next && navigate(`/character/${neighbors.next.id}`)}
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
            onReadEmbedded={handleReadEmbedded}
            onExport={() => { void exportCardFile(); }}
            onExportJson={() => { void exportJsonCard(); }}
            onDelete={() => setCharDeleteOpen(true)}
          />
        )}

        {/* ===== 主列：头部 + tabs（就地阅读时头部收起，返回列表自动展开） ===== */}
        <div ref={contentColumnRef} className="flex-1 min-w-0 min-h-0 flex flex-col overflow-y-auto scrollbar-thin">
          {isMobile && (
            <CharacterInfoRail
              stacked
              character={character}
              norm={norm}
              stories={sortedStories}
              onPatch={patchCharacter}
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
            onSelectTab={changeActiveTab}
          />

          <Tabs
            value={activeTab}
            onValueChange={changeActiveTab}
            className={cn('flex-1 flex flex-col pt-3', isMobile ? 'px-3 pb-4' : 'px-6 pb-6')}
          >
            {/* TabsList 用 flex（布局铁律：防插件包裹破坏 grid）；行右侧=统一导入钮（关联资产与立绘自带导入栏不重复渲染） */}
            <div className="flex flex-wrap items-center gap-2">
               <TabsList className="flex w-fit flex-wrap gap-1">
                 <TabsTrigger value="stories">故事 {stories.length > 0 && <span className="ml-1 text-[11px] opacity-70">{stories.length}</span>}</TabsTrigger>
                 <TabsTrigger value="notes">备注 {(character.notes?.length ?? 0) > 0 && <span className="ml-1 text-[11px] opacity-70">{character.notes!.length}</span>}</TabsTrigger>
                 <TabsTrigger value="assets">关联资产 {assetCount > 0 && <span className="ml-1 text-[11px] opacity-70">{assetCount}</span>}</TabsTrigger>
                 <TabsTrigger value="portraits">立绘 {portraitCount > 0 && <span className="ml-1 text-[11px] opacity-70">{portraitCount}</span>}</TabsTrigger>
                 <TabsTrigger value="card-edit">角色卡编辑</TabsTrigger>
                 <TabsTrigger value="greetings">开场白 {greetingCount > 0 && <span className="ml-1 text-[11px] opacity-70">{greetingCount}</span>}</TabsTrigger>
               </TabsList>
               {activeTab === 'stories' && <Button size="sm" disabled={startingPlay} onClick={() => {
                 if (playStartLock.current || character.id !== id) return;
                 const epoch = getVaultEpoch();
                 const reservation = preopenDetachedTavernWindow();
                 playStartLock.current = true; setStartingPlay(true);
                 void flushUnsavedCardEdits()
                   .then(ok => {
                     if (!ok) {
                       reservation?.cancelIfUnused();
                       return null;
                     }
                     return import('@/lib/roleplay/start-story').then(module => module.startCharacterStory(character.id));
                   })
                   .then(storyId => {
                     if (!storyId || epoch !== getVaultEpoch()) {
                       reservation?.cancelIfUnused();
                       return;
                     }
                     launchRoleplayTarget({ storyId, navigate, reservation });
                   })
                   .catch(error => {
                     reservation?.cancelIfUnused();
                     toast({ title: '无法开始新聊天', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
                   })
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
               {showTopImport && TAB_IMPORT_KIND[activeTab] && (
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

            {/* 故事 tab：列表 + 子视图（总结/日记/自定义记录/故事树），阅读与处理统一跳转大屏 /story/:id */}
            <TabsContent value="stories" className="mt-3">
              <div className="space-y-3">
                <div className="flex items-center gap-1 text-xs flex-wrap">
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
                    onJumpToFloor={(sid, branchId, floor) => openReader(sid, branchId ?? null, floor)}
                  />
                ) : stories.length === 0 ? (
                  <Card>
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">
                      还没有故事。点右上角「导入」，把 ST 聊天记录（JSONL）挂到这张卡下，或直接点「新开聊天」开启第一段对话。
                    </CardContent>
                  </Card>
                ) : (
                  <StoryListSection
                    stories={sortedStories}
                    activeStoryId={null}
                    onRead={(sid, branchId) => openReader(sid, branchId)}
                    onProcess={(sid) => goWorkspace(sid, 'volume')}
                    onExport={(sid) => goWorkspace(sid, 'io')}
                    onExportFile={(sid, branchId, format) => { void exportStoryFile(sid, branchId, format); }}
                    onPlay={(sid, branchId) => { void playStory(sid, branchId); }}
                    onDelete={setStoryToDelete}
                    onCopy={async (sid) => {
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
                key={character.id}
                character={character}
                onPatch={patchCharacter}
              />
             </TabsContent>

             <TabsContent value="card-edit" className="mt-3">
               {cardEdits && (
                 <CharacterCardEditSection
                   key={character.id}
                   edits={cardEdits}
                   displayName={displayNameDraft}
                   dirty={cardDirty || displayNameDirty}
                   onEditChange={(key, value) => setCardEdits((current) => (current ? { ...current, [key]: value } : current))}
                   onDisplayNameChange={setDisplayNameDraft}
                   onSave={flushUnsavedCardEdits}
                   onDiscard={discardCardEdits}
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
                   onDiscard={discardCardEdits}
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
        {isMobile && latestStory && (
          <div className="shrink-0 border-t border-[color:var(--border-subtle)] bg-chrome px-3 py-2">
            <Button
              className="w-full"
              onClick={() => openReader(latestStory.id)}
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

      <SafeCharacterRouteBlocker
        dirty={cardDirty || displayNameDirty}
        saving={cardSaving}
        flush={flushUnsavedCardEdits}
        onDiscard={discardCardEdits}
      />
      <DeleteConfirmDialog open={charDeleteOpen} onOpenChange={setCharDeleteOpen}
        title={`删除「${character.name}」？`}
        description="名下故事、总结、日记与角色附件会一并删除；共享资产保留。"
        fileTarget={{ store: 'characters', id: character.id }}
        onConfirm={handleConfirmDeleteChar} />
    </AppLayout>
  );
};

export default CharacterPage;
