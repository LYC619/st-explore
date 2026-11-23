import type { RemoveOptions } from '@/lib/repo';
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { GuidedTour } from '@/components/GuidedTour';
import { AppLayout } from '@/components/AppLayout';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { WORLDBOOK_TOUR_STEPS, isTourCompleted, setTourCompleted } from '@/lib/tour-steps';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { AIUpdateDialog } from '@/components/worldbook/AIUpdateDialog';
import { QuickCreate } from '@/components/worldbook/QuickCreate';
import { WorldBookHeader, type WorldBookTab } from '@/components/worldbook/WorldBookHeader';
import { WorldBookEmptyState } from '@/components/worldbook/WorldBookEmptyState';
import { WorldBookBatchBar } from '@/components/worldbook/WorldBookBatchBar';
import { EntryFilterBar, type EntryViewMode } from '@/components/worldbook/EntryFilterBar';
import { EntryListPanel } from '@/components/worldbook/EntryListPanel';
import { EntryEditorPane } from '@/components/worldbook/EntryEditorPane';
import type { WorldBook, WorldBookItem } from '@/types/worldbook';
import { generateWorldBookId } from '@/types/worldbook';
import { saveWorldBook, getAllWorldBooks, getWorldBook, deleteWorldBook } from '@/lib/worldbook-db';
import { appendEntries } from '@/lib/worldbook-entry-copy';
import { saveAssetWithCow } from '@/lib/asset-cow-save';
import { buildWorldBookSaveItem } from '@/lib/asset-save-record';
import { getCharacter } from '@/lib/archive-db';
import { updateCharacterAssetReference } from '@/lib/character-asset-ref';
import { executeDeleteAction } from '@/lib/destructive-action';
import { takePendingToolFile } from '@/lib/tool-handoff';
import { estimateTokens } from '@/lib/preset-parser';
import { useToast } from '@/hooks/use-toast';
import { useWorldBookDraftState } from '@/hooks/use-worldbook-draft-state';
import { useWorldbookSession, useRestoredWbSession, loadWorldbookRecovery, worldbookRecoveryKey, type WbSession } from '@/hooks/use-worldbook-session';
import { useEntryFilters } from '@/hooks/use-entry-filters';
import { useBatchSelection } from '@/hooks/use-batch-selection';
import { useWorldbookEntries } from '@/hooks/use-worldbook-entries';
import { ToastAction } from '@/components/ui/toast';
import { readWorldBookUpload, type WorldBookUpload } from '@/lib/worldbook-file-import';
import { useAssetIdentityNavigation } from '@/hooks/use-asset-identity-navigation';
import { useWorldbookAutosave } from '@/hooks/use-worldbook-autosave';
import { getVaultEpoch } from '@/lib/vault/active';
import { WorldBookSaveBoundary } from '@/components/worldbook/WorldBookSaveBoundary';

const undoAction = (undo: () => void) => <ToastAction altText="撤销" onClick={undo}>撤销</ToastAction>;

/**
 * TODO(移动端适配)：世界书编辑器暂未做窄屏适配（<1024px）。
 * 这一页本来就用 useIsMobile 做过一点分支，但它只是 768px 单点判断，
 * 跟本轮新增的 useViewport 三档并存（合并方案见 docs/mobile-adaptation.md）。
 * 条目编辑是「长列表 + 每条一堆插入策略字段」的双栏结构，
 * 手机上要拆成列表页 + 条目详情页两级，字段还得分组折叠——
 * 属于重排信息层级，不是调 className，本轮不动。
 */
export default function WorldBookPage() {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  // 角色上下文（角色页关联资产区「处理」进来）：保存走写时复制（定稿第七章）
  const [cowCharacterId, setCowCharacterId] = useState<string | undefined>();
  const [cowCharacterName, setCowCharacterName] = useState('');

  const restored = useRestoredWbSession();
  const {
    worldbook,
    setWorldbook,
    hydrateWorldbook,
    markWorldbookClean,
    isDirty: contentDirty,
  } = useWorldBookDraftState(restored?.worldbook ?? null);
  const latestWorldbook = useRef(worldbook); latestWorldbook.current = worldbook;
  const [filename, setFilename] = useState(restored?.filename ?? 'worldbook');
  const [savedFilename, setSavedFilename] = useState(restored?.filename ?? 'worldbook');
  const isDirty = contentDirty || filename !== savedFilename;
  const pendingCreate = useRef<WorldBookItem | null>(null);
  const createCompletion = useRef<((saved: boolean) => void) | null>(null);
  const [renameRequest, setRenameRequest] = useState<{ title: string } | null>(null);
  const [currentItemId, setCurrentItemId] = useState<string | null>(restored?.currentItemId ?? null);
  const [stagedDialogOpen, setStagedDialogOpen] = useState(false);
  const [confirmLoadItem, setConfirmLoadItem] = useState<WorldBookItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorldBookItem | null>(null);
  const [savedItems, setSavedItems] = useState<WorldBookItem[]>([]);
  const saveTargetRef = useRef<WorldBookItem | null>(null);
  // Content can commit before the character reference does. Keep that exact revision
  // for retries, while retaining the original base id until the reference switches.
  const partialSaveRef = useRef<{ baseId: string; item: WorldBookItem } | null>(null);
  const [saveScope, setSaveScope] = useState('initial');
  const recoveryKeyRef = useRef<string | null>(null);
  const [recoverableDraft, setRecoverableDraft] = useState<WbSession | null>(null);
  /** 资产库读完之前，空态不能断言「你没有可恢复的世界书」 */
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [savedLoadError, setSavedLoadError] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<EntryViewMode>('card');
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<WorldBookTab>('edit');
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [showTour, setShowTour] = useState(false);

  useWorldbookSession(worldbook, filename, currentItemId);

  // beforeunload guard for unsaved changes
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const allEntries = useMemo(
    () => (worldbook ? Object.entries(worldbook.entries) : []),
    [worldbook]
  );
  const selectedEntry = selectedUid && worldbook ? worldbook.entries[selectedUid] : null;

  const { controls, filteredEntries, pagedEntries, page, totalPages, setPage } = useEntryFilters(allEntries);

  // token 汇总（粗估）：启用条目才会注入上下文，故分开给启用/全部两个数
  const tokenStats = useMemo(() => {
    let enabled = 0, total = 0;
    for (const [, e] of allEntries) {
      const t = estimateTokens(e.content);
      total += t;
      if (e.enabled) enabled += t;
    }
    return { enabled, total };
  }, [allEntries]);

  const summary = useMemo(() => {
    if (!worldbook) return null;
    const enabled = tokenStats.enabled;
    return {
      title: `token 为粗略估算（CJK≈1字1token）。启用条目 ≈${enabled.toLocaleString()} / 全部 ≈${tokenStats.total.toLocaleString()} tokens`,
      text: `${controls.hasFilters ? `${filteredEntries.length} / ${allEntries.length} 条` : `${allEntries.length} 条`}`
        + ` · ≈${enabled >= 10000 ? `${(enabled / 1000).toFixed(1)}k` : enabled.toLocaleString()} tok(启用)`
        + ` · ${filename}`,
    };
  }, [worldbook, tokenStats, controls.hasFilters, filteredEntries.length, allEntries.length, filename]);

  // Cache consumed handoffs so StrictMode can retry initialization without losing the file.
  const initialImport = useRef<Promise<(WorldBookUpload & { autoSave: boolean }) | null> | null>(null);
  const {
    pendingTarget, confirmPending, cancelPending, captureCurrent, acceptLocalAsset, ownsLocation,
  } = useAssetIdentityNavigation({
    isDirty,
    load: async (identity, { initial, isCurrent }) => {
      if (initial && !identity.assetId && !initialImport.current) {
        const handoff = takePendingToolFile('worldbook');
        const blankFlag = sessionStorage.getItem('ste-create-blank-worldbook');
        sessionStorage.removeItem('ste-create-blank-worldbook');
        const aiImport = sessionStorage.getItem('ai-worldbook-import');
        sessionStorage.removeItem('ai-worldbook-import');
        let aiWorldbook: WorldBook | null = null;
        try {
          const parsed = aiImport ? JSON.parse(aiImport) : null;
          if (parsed?.entries) aiWorldbook = parsed;
        } catch { /* ignore invalid AI handoff */ }
        initialImport.current = handoff
          ? readWorldBookUpload(handoff).then((upload) => ({ ...upload, autoSave: true }))
          : blankFlag
            ? Promise.resolve({ worldbook: { entries: {} }, title: '新建世界书', autoSave: true })
            : Promise.resolve(aiWorldbook ? { worldbook: aiWorldbook, title: 'AI 提取的世界书', autoSave: false } : null);
      }
      const [item, character, items, imported] = await Promise.all([
        identity.assetId ? getWorldBook(identity.assetId) : null,
        identity.characterId ? getCharacter(identity.characterId) : null,
        getAllWorldBooks().catch((error: unknown) => {
          if (isCurrent()) setSavedLoadError(error instanceof Error ? error.message : '无法读取世界书库');
          return [];
        }),
        initial && !identity.assetId ? initialImport.current : null,
      ]);
      if (isCurrent()) {
        setSavedItems(item && !items.some((saved) => saved.id === item.id) ? [item, ...items] : items);
        setSavedLoaded(true);
      }
      if (identity.assetId && !item) throw new Error('找不到这个世界书，它可能已经被删除');
      return {
        item: item ?? (initial && !identity.assetId && !restored && !imported ? items[0] ?? null : null),
        characterName: character?.name ?? '',
        preserveSession: initial && !identity.assetId && !!restored,
        // A session only records its displayed content, not a trustworthy newer
        // repository baseline. Preserve that revision so stale drafts conflict.
        sessionBase: initial && !identity.assetId && restored?.currentItemId ? {
          id: restored.currentItemId, title: restored.filename, createdAt: 0, updatedAt: 0,
          ...items.find(saved => saved.id === restored.currentItemId), worldbook: restored.worldbook,
        } : null,
        imported,
      };
    },
    accept: (target, identity) => {
      pendingCreate.current = null;
      partialSaveRef.current = null;
      const base = target.item ?? target.sessionBase;
      recoveryKeyRef.current = base ? worldbookRecoveryKey(base.id, identity.characterId) : null;
      setRecoverableDraft(recoveryKeyRef.current ? loadWorldbookRecovery(recoveryKeyRef.current) : null);
      saveTargetRef.current = base;
      setSaveScope(`${identity.characterId ?? ''}/${base?.id ?? 'draft'}`);
      if (!target.preserveSession || target.item) {
        hydrateWorldbook(target.item?.worldbook ?? null);
        setFilename(target.item?.title ?? 'worldbook');
        setSavedFilename(target.item?.title ?? 'worldbook');
        setCurrentItemId(target.item?.id ?? null);
      }
      setSelectedUid(null);
      setMobileEditorOpen(false);
      setCowCharacterId(identity.characterId ?? undefined);
      setCowCharacterName(target.characterName);
      setConfirmLoadItem(null);
      setStagedDialogOpen(false);
      if (target.imported?.autoSave) {
        handleImport(target.imported.worldbook, target.imported.title, target.imported.sourceModifiedAt);
      } else if (target.imported) {
        setWorldbook(target.imported.worldbook);
        setFilename(target.imported.title);
        toast({ title: '已导入 AI 生成的世界书数据' });
      }
    },
    onError: (error) => {
      setSavedLoaded(true);
      toast({ title: '载入世界书失败', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    },
  });

  useEffect(() => {
    if (!isTourCompleted('worldbook')) {
      const timer = setTimeout(() => setShowTour(true), 500);
      return () => clearTimeout(timer);
    }
  }, []);

  const selectEntry = useCallback((key: string) => {
    setSelectedUid(key);
    if (isMobile) setMobileEditorOpen(true);
  }, [isMobile]);

  const clearSelectedEntry = useCallback(() => {
    setSelectedUid(null);
    setMobileEditorOpen(false);
  }, []);

  const entryActions = useWorldbookEntries({
    worldbook, setWorldbook, selectedUid, selectEntry, clearSelectedEntry,
    switchToEditTab: useCallback(() => setActiveTab('edit'), []),
    toast, renderUndoAction: undoAction,
  });

  const batch = useBatchSelection({
    filteredEntries, worldbook, setWorldbook, selectedUid, clearSelectedEntry,
    toast, renderUndoAction: undoAction,
  });

  const handleImport = useCallback((wb: WorldBook, name: string, sourceModifiedAt?: number) => {
    const id = generateWorldBookId();
    const now = Date.now();
    const item: WorldBookItem = {
      id,
      title: name,
      worldbook: wb,
      createdAt: now,
      updatedAt: now,
      autoSaved: false,
      ...(sourceModifiedAt === undefined ? {} : { sourceModifiedAt }),
    };
    const completion = new Promise<boolean>(resolve => { createCompletion.current = resolve; });
    acceptLocalAsset(id, () => {
      pendingCreate.current = item;
      saveTargetRef.current = null;
      partialSaveRef.current = null;
      setSaveScope(`import/${id}`);
      recoveryKeyRef.current = worldbookRecoveryKey(id, cowCharacterId);
      setRecoverableDraft(null);
      setCurrentItemId(id);
      setWorldbook(wb);
      setFilename(name);
      setSelectedUid(null);
      setActiveTab('edit');
    });
    return completion;
  }, [setWorldbook, acceptLocalAsset, cowCharacterId]);

  const filenameRef = useRef(filename);
  filenameRef.current = filename;
  const persistSnapshot = useCallback(async (draft: { worldbook: WorldBook | null; filename: string }) => {
    const snapshot = draft.worldbook;
    if (!snapshot) return;
    const isCurrent = captureCurrent();
    const epoch = getVaultEpoch();
    const assertCurrent = () => { if (epoch !== getVaultEpoch()) throw new Error('文件库已切换，保存已停止'); };
    const now = Date.now();
    const activeTitle = draft.filename.trim() || 'worldbook';
    const base = saveTargetRef.current ?? (currentItemId ? savedItems.find(s => s.id === currentItemId) : undefined);
    const explicitTitle = activeTitle !== base?.title;
    if (cowCharacterId) {
      const character = await getCharacter(cowCharacterId);
      assertCurrent();
      if (!character) throw new Error('角色已被删除，保存已停止；草稿已保留');
    }
    const expectedRevision = (id: string) => {
      const partial = partialSaveRef.current;
      if (partial?.baseId === base?.id && partial?.item.id === id) return partial.item;
      return id === base?.id ? base : savedItems.find(item => item.id === id) ?? base;
    };
    const validate = (fresh: WorldBookItem) => {
      const expected = expectedRevision(fresh.id);
      const partial = partialSaveRef.current;
      const isOwnPartial = partial?.baseId === base?.id && partial?.item.id === fresh.id;
      if ((expected && JSON.stringify(fresh.worldbook) !== JSON.stringify(expected.worldbook))
        || (!isOwnPartial && base && fresh.id !== base.id && JSON.stringify(fresh.worldbook) !== JSON.stringify(base.worldbook))) {
        throw new Error('世界书已在其他位置修改；草稿已保留，请先导出草稿再重新打开以核对冲突');
      }
    };

    // 角色上下文 + 已入库的资产：写时复制（定稿第七章）——原资产不动，改动落到该角色的派生副本
    if (cowCharacterId && base) {
      const result = await saveAssetWithCow({
        kind: 'worldbook',
        baseId: base.id,
        reload: getAllWorldBooks,
        characterId: cowCharacterId,
        characterName: cowCharacterName,
        title: activeTitle,
        titleExplicit: explicitTitle,
        content: { worldbook: snapshot, autoSaved: false },
        newId: generateWorldBookId,
        save: async item => {
          const expected = expectedRevision(item.id);
          await saveWorldBook(item, expected?.id === item.id ? expected : undefined);
          assertCurrent();
          if (isCurrent()) partialSaveRef.current = { baseId: base.id, item: structuredClone(item) };
        },
        now,
        assertCurrent,
        validate,
      });
      assertCurrent();
      if (!isCurrent()) return;
      partialSaveRef.current = null;
      saveTargetRef.current = { ...base, id: result.targetId, title: result.title, worldbook: snapshot,
        updatedAt: now, ...(result.action === 'copy' ? { derived: { derivedFrom: base.id, characterId: cowCharacterId, diverged: true, createdAt: now, updatedAt: now } } : {}) };
      filenameRef.current = result.title;
      setFilename(current => current === draft.filename ? result.title : current);
      setSavedFilename(result.title);
      if (result.targetId !== currentItemId && ownsLocation()) acceptLocalAsset(result.targetId, () => setCurrentItemId(result.targetId));
      else setCurrentItemId(result.targetId);
      markWorldbookClean(snapshot);
      const stillCurrent = captureCurrent();
      const items = await getAllWorldBooks();
      if (stillCurrent()) setSavedItems(items);
      return;
    }

    const id = base?.id || currentItemId || generateWorldBookId();
      const fresh = base ? await getWorldBook(base.id) : undefined;
      assertCurrent();
      if (base && !fresh) throw new Error('这条世界书已经不在库里；草稿已保留');
      if (fresh) validate(fresh);
      const item = buildWorldBookSaveItem({
        base: fresh ?? base ?? pendingCreate.current ?? undefined,
        id,
        title: activeTitle,
        worldbook: snapshot,
        now,
      });
      await saveWorldBook(item, fresh);
      assertCurrent();
      // 角色上下文里保存全新世界书：入库并直接挂到该角色名下
      if (cowCharacterId && !base) {
        const updatedCharacter = await updateCharacterAssetReference(cowCharacterId, 'worldbook', id, id, now);
        if (!updatedCharacter) throw new Error('资产已保存，但角色引用切换失败：角色可能已被删除');
      }
      if (!isCurrent()) return;
      saveTargetRef.current = item;
      pendingCreate.current = null;
      setCurrentItemId(id);
      markWorldbookClean(snapshot);
      setSavedFilename(activeTitle);
      const items = await getAllWorldBooks();
      if (!isCurrent()) return;
      setSavedItems(items);
  }, [currentItemId, savedItems, cowCharacterId, cowCharacterName, markWorldbookClean, captureCurrent, acceptLocalAsset, ownsLocation]);

  const saveDraft = useMemo(() => ({ worldbook, filename }), [worldbook, filename]);
  const autosave = useWorldbookAutosave({ value: saveDraft, dirty: isDirty,
    enabled: !!currentItemId && savedLoaded, scope: saveScope, save: persistSnapshot });
  const { flush: flushWorldbook } = autosave;

  // Start creation only after the new identity and complete draft have rendered.
  // Initial writes and later edits share the same writer and failure recovery.
  useEffect(() => {
    const complete = createCompletion.current;
    if (!complete) return;
    createCompletion.current = null;
    const isCurrent = captureCurrent();
    const creationId = pendingCreate.current?.id;
    void flushWorldbook(true).then(() => complete(isCurrent() && saveTargetRef.current?.id === creationId), (error: unknown) => {
      complete(false);
      if (isCurrent()) toast({ title: '保存世界书失败', description: '草稿已保留，请检查文件库后再点「保存」。' + (error instanceof Error ? error.message : ''), variant: 'destructive' });
    });
  }, [saveScope, captureCurrent, flushWorldbook, toast]);

  useEffect(() => {
    if (!renameRequest) return;
    const title = renameRequest.title;
    const isCurrent = captureCurrent();
    void flushWorldbook(true).then(() => {
      if (isCurrent() && saveTargetRef.current?.title === title) toast({ title: '世界书已重命名', description: `「${title}」` });
    }, (error: unknown) => {
      if (isCurrent()) toast({ title: '重命名尚未保存', description: '新名称已保留，请点「保存」重试。' + (error instanceof Error ? error.message : ''), variant: 'destructive' });
    });
  }, [renameRequest, captureCurrent, flushWorldbook, toast]);

  const handleCreateBlank = useCallback(() => {
    void (async () => {
      if (isDirty) {
        try {
          await flushWorldbook(true);
        } catch (error) {
          toast({
            title: '当前世界书尚未保存，已保留原内容',
            description: error instanceof Error ? error.message : String(error),
            variant: 'destructive',
          });
          return;
        }
      }
      const used = new Set(savedItems.map((item) => item.title.trim()));
      let nextTitle = '新建世界书';
      for (let n = 2; used.has(nextTitle); n++) nextTitle = `新建世界书 ${n}`;
      if (await handleImport({ entries: {} }, nextTitle)) {
        toast({ title: `已创建「${nextTitle}」`, description: '点击左上角「添加条目」即可开始编写设定' });
      }
    })();
  }, [flushWorldbook, handleImport, isDirty, savedItems, toast]);

  const handleRenameWorldbook = useCallback((nextName: string) => {
    const trimmed = nextName.trim();
    const prevFilename = filenameRef.current;
    if (!trimmed || trimmed === prevFilename) return;
    filenameRef.current = trimmed;
    setFilename(trimmed);
    if (!latestWorldbook.current) return;
    setRenameRequest({ title: trimmed });
  }, []);
  useEffect(() => {
    if (!recoveryKeyRef.current) return;
    try {
      if (autosave.status === 'error' && worldbook) localStorage.setItem(recoveryKeyRef.current, JSON.stringify({ worldbook, filename, currentItemId }));
      else if (autosave.status === 'saved' && !isDirty && !recoverableDraft) localStorage.removeItem(recoveryKeyRef.current);
    } catch { /* The editor and session draft remain usable when browser storage is full. */ }
  }, [autosave.status, worldbook, filename, currentItemId, isDirty, recoverableDraft]);
  const handleSaveLocal = useCallback(() => flushWorldbook(true).catch((error: Error) => {
    toast({ title: '保存失败', description: error.message, variant: 'destructive' });
  }), [flushWorldbook, toast]);
  const currentSaved = savedItems.find(item => item.id === currentItemId) ?? saveTargetRef.current;
  const sourceBook = currentSaved?.derived?.derivedFrom ? savedItems.find(item => item.id === currentSaved.derived!.derivedFrom) : undefined;
  const restoreSource = async () => {
    try {
      await autosave.flush();
      const source = sourceBook && await getWorldBook(sourceBook.id);
      if (!source) throw new Error('来源世界书已不存在');
      setWorldbook(structuredClone(source.worldbook));
    } catch (error) { toast({ title: '恢复失败', description: String(error), variant: 'destructive' }); }
  };

  // Ctrl+S / Cmd+S to save (declared after handleSaveLocal to avoid TDZ)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (worldbook) handleSaveLocal();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [worldbook, handleSaveLocal]);

  const handleBatchDelete = useCallback(() => {
    const count = batch.removeSelected();
    toast({ title: '已删除', description: `已删除 ${count} 个条目` });
  }, [batch, toast]);

  // 条目跨书复制/转移（阶段9.8 余项）：目标=资产库里另一本世界书，直接落库；
  // 「转移」再从当前书移除（当前书走正常 dirty→手动保存流程）
  const handleBatchCopyTo = useCallback(async (targetId: string, move: boolean) => {
    const isCurrent = captureCurrent();
    const entries = batch.selectedEntries();
    if (entries.length === 0) return;
    try {
      const target = await getWorldBook(targetId);
      if (!target) {
        if (isCurrent()) toast({ title: '目标世界书不存在', description: '可能刚被删除，请刷新后重试', variant: 'destructive' });
        return;
      }
      await saveWorldBook({ ...target, worldbook: appendEntries(target.worldbook, entries), updatedAt: Date.now() });
      if (!isCurrent()) return;
      const items = await getAllWorldBooks();
      if (!isCurrent()) return;
      setSavedItems(items);
      if (move) batch.removeSelected();
      toast({
        title: move ? '已转移' : '已复制',
        description: `${entries.length} 个条目 → 「${target.title}」${move ? '（当前书的移除记得保存）' : '，原条目保留'}`,
      });
    } catch {
      if (!isCurrent()) return;
      toast({ title: move ? '转移失败' : '复制失败', variant: 'destructive' });
    }
  }, [batch, toast, captureCurrent]);

  const doLoadStaged = useCallback((item: WorldBookItem) => {
    partialSaveRef.current = null;
    saveTargetRef.current = item;
    recoveryKeyRef.current = worldbookRecoveryKey(item.id, cowCharacterId);
    setRecoverableDraft(loadWorldbookRecovery(recoveryKeyRef.current));
    setSaveScope(`${cowCharacterId ?? ''}/${item.id}`);
    acceptLocalAsset(item.id, () => {
      hydrateWorldbook(item.worldbook);
      setFilename(item.title);
      setSavedFilename(item.title);
      setCurrentItemId(item.id);
      setSelectedUid(null);
      setStagedDialogOpen(false);
      setConfirmLoadItem(null);
    });
    toast({ title: '已加载', description: `已加载「${item.title}」` });
  }, [hydrateWorldbook, toast, acceptLocalAsset, cowCharacterId]);

  const handleLoadStaged = useCallback((item: WorldBookItem) => {
    if (isDirty) setConfirmLoadItem(item);
    else doLoadStaged(item);
  }, [isDirty, doLoadStaged]);

  const refreshSavedItems = useCallback(async () => {
    const isCurrent = captureCurrent();
    setSavedLoadError(null);
    setSavedLoaded(false);
    try {
      const items = await getAllWorldBooks();
      if (isCurrent()) setSavedItems(items);
    } catch (error: unknown) {
      if (isCurrent()) setSavedLoadError(error instanceof Error ? error.message : '无法读取世界书库');
    } finally {
      if (isCurrent()) setSavedLoaded(true);
    }
  }, [captureCurrent]);

  const handleDeleteStaged = useCallback(async (options: RemoveOptions) => {
    if (!deleteTarget) return;
    const isCurrent = captureCurrent();
    const target = deleteTarget;
    const deleted = await executeDeleteAction(async () => {
      await deleteWorldBook(target.id, options);
      if (!isCurrent()) return;
      const items = await getAllWorldBooks();
      if (!isCurrent()) return;
      setSavedItems(items);
      if (currentItemId === target.id) setCurrentItemId(null);
    }, {
      onSuccess: () => { if (isCurrent()) toast({ title: `已删除世界书「${target.title}」` }); },
      onFailure: () => { if (isCurrent()) toast({ title: '删除世界书失败', variant: 'destructive' }); },
    });
    if (deleted && isCurrent()) setDeleteTarget(null);
    return deleted;
  }, [currentItemId, deleteTarget, toast, captureCurrent]);

  return (
    <AppLayout>
      <WorldBookSaveBoundary dirty={isDirty} saving={autosave.status === 'saving'} currentId={saveTargetRef.current?.id ?? currentItemId}
        flush={autosave.flush} onError={(error) => toast({ title: '尚未保存，已留在当前页', description: String(error), variant: 'destructive' })} />
      <div className="bg-background flex h-full min-h-0 flex-col overflow-hidden">
        {recoverableDraft && <div role="status" className="flex items-center gap-2 border-b px-4 py-2 text-sm">
          发现上次保存失败的草稿；库内内容已载入。
          <button className="underline" onClick={() => { setWorldbook(recoverableDraft.worldbook); setRecoverableDraft(null); }}>恢复草稿并重试保存</button>
          <button className="underline" onClick={() => { if (recoveryKeyRef.current) localStorage.removeItem(recoveryKeyRef.current); setRecoverableDraft(null); }}>放弃这份草稿</button>
        </div>}
        <WorldBookHeader
          worldbook={worldbook}
          filename={filename}
          onRename={handleRenameWorldbook}
          onCreateBlank={handleCreateBlank}
          cowCharacterName={cowCharacterId ? cowCharacterName : ''}
          summary={summary}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onImport={handleImport}
          onAppend={entryActions.appendWorldbook}
          onOpenAiDialog={() => setAiDialogOpen(true)}
          savedItems={savedItems}
          stagedDialogOpen={stagedDialogOpen}
          onStagedDialogOpenChange={setStagedDialogOpen}
          onRefreshStaged={refreshSavedItems}
          onLoadStaged={handleLoadStaged}
          onDeleteStaged={setDeleteTarget}
          onSave={handleSaveLocal}
          saveStatus={autosave.status}
          saveError={autosave.error?.message}
          onBeforeExport={async () => { await autosave.flush(); return latestWorldbook.current ?? undefined; }}
          sourceTitle={sourceBook?.title}
          onRestoreSource={() => { void restoreSource(); }}
        >
          <AlertDialog open={!!confirmLoadItem || !!pendingTarget} onOpenChange={(open) => {
            if (!open) { cancelPending(); setConfirmLoadItem(null); }
          }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认切换</AlertDialogTitle>
                <AlertDialogDescription>
                  当前编辑中的世界书将被替换为「{pendingTarget ? pendingTarget.data.item?.title ?? '空白世界书' : confirmLoadItem?.title}」，还没保存的修改将丢失。是否继续？
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => {
                  if (pendingTarget) confirmPending();
                  else if (confirmLoadItem) doLoadStaged(confirmLoadItem);
                }}>
                  确认加载
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <DeleteConfirmDialog
            open={!!deleteTarget}
            title={`删除世界书「${deleteTarget?.title ?? ''}」？`}
            description="条目将从列表移除。若角色仍引用该世界书，角色页会显示引用失效。"
            onOpenChange={(open) => !open && setDeleteTarget(null)}
            fileTarget={deleteTarget ? { store: 'worldbooks', id: deleteTarget.id } : undefined}
            onConfirm={handleDeleteStaged}
          />
        </WorldBookHeader>

        {/* Body */}
        {activeTab === 'quick' ? (
          <ScrollArea className="flex-1 min-h-0">
            <QuickCreate
              existingWorldbook={worldbook}
              onAddToWorldbook={entryActions.quickAddEntries}
            />
          </ScrollArea>
        ) : (
          <div className="flex-1 min-h-0 flex overflow-hidden">
            {!worldbook ? (
              <WorldBookEmptyState
                savedItems={savedItems}
                savedLoaded={savedLoaded}
                loadError={savedLoadError}
                onRetry={refreshSavedItems}
                onImport={handleImport}
                onCreateBlank={handleCreateBlank}
                onRestore={handleLoadStaged}
                onDelete={setDeleteTarget}
              />
            ) : (
              <>
                {/* Left: entries */}
                <div className="flex-1 min-w-0 md:border-r flex h-full min-h-0 flex-col">
                  <div className="shrink-0 border-b bg-card/60 backdrop-blur px-4 py-2 space-y-2">
                    {batch.batchMode ? (
                      <WorldBookBatchBar
                        batch={batch}
                        totalFiltered={filteredEntries.length}
                        savedItems={savedItems}
                        currentItemId={currentItemId}
                        onBatchDelete={handleBatchDelete}
                        onBatchCopyTo={handleBatchCopyTo}
                      />
                    ) : (
                      <EntryFilterBar
                        controls={controls}
                        viewMode={viewMode}
                        onViewModeChange={setViewMode}
                        onAddEntry={entryActions.addEntry}
                        onEnterBatch={batch.enterBatchMode}
                        entries={worldbook.entries}
                        onPrefixCategorize={entryActions.applyPrefixCategorize}
                      />
                    )}
                  </div>

                  <EntryListPanel
                    pagedEntries={pagedEntries}
                    viewMode={viewMode}
                    selectedUid={selectedUid}
                    onSelect={selectEntry}
                    onToggleEnabled={entryActions.toggleEnabled}
                    onDelete={entryActions.deleteEntry}
                    batchMode={batch.batchMode}
                    batchSelected={batch.batchSelected}
                    onBatchToggle={batch.toggleBatchItem}
                    showFilteredEmpty={filteredEntries.length === 0 && controls.hasFilters}
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    paginated={controls.pageSize > 0}
                  />
                </div>

                {/* Right: 条目编辑器（桌面右栏 / 移动端抽屉） */}
                <EntryEditorPane
                  entry={selectedEntry}
                  entryKey={selectedUid}
                  usedUids={allEntries.map(([, entry]) => entry.uid)}
                  onChange={entryActions.updateEntry}
                  onDelete={entryActions.deleteEntry}
                  isMobile={isMobile}
                  mobileOpen={mobileEditorOpen}
                  onMobileOpenChange={setMobileEditorOpen}
                />
              </>
            )}
          </div>
        )}

        {/* Guided Tour */}
        {showTour && (
          <GuidedTour
            steps={WORLDBOOK_TOUR_STEPS}
            module="worldbook"
            onComplete={() => { setTourCompleted('worldbook'); setShowTour(false); }}
            onSkip={() => { setTourCompleted('worldbook'); setShowTour(false); }}
          />
        )}

        <AIUpdateDialog
          open={aiDialogOpen}
          onOpenChange={setAiDialogOpen}
          existingEntries={allEntries.map(([, e]) => e)}
          onAppend={entryActions.appendWorldbook}
        />
      </div>
    </AppLayout>
  );
}
