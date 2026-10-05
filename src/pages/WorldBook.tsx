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
import { saveWorldBook, getAllWorldBooks, getWorldBook, deleteWorldBook, pruneAutoSavedWorldBooks } from '@/lib/worldbook-db';
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
import { useWorldbookSession, useRestoredWbSession } from '@/hooks/use-worldbook-session';
import { useEntryFilters } from '@/hooks/use-entry-filters';
import { useBatchSelection } from '@/hooks/use-batch-selection';
import { useWorldbookEntries } from '@/hooks/use-worldbook-entries';
import { ToastAction } from '@/components/ui/toast';
import { readWorldBookUpload, type WorldBookUpload } from '@/lib/worldbook-file-import';
import { useAssetIdentityNavigation } from '@/hooks/use-asset-identity-navigation';

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
    isDirty,
  } = useWorldBookDraftState(restored?.worldbook ?? null);
  const [filename, setFilename] = useState(restored?.filename ?? 'worldbook');
  const [currentItemId, setCurrentItemId] = useState<string | null>(restored?.currentItemId ?? null);
  const [stagedDialogOpen, setStagedDialogOpen] = useState(false);
  const [confirmLoadItem, setConfirmLoadItem] = useState<WorldBookItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorldBookItem | null>(null);
  const [savedItems, setSavedItems] = useState<WorldBookItem[]>([]);
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
    pendingTarget, confirmPending, cancelPending, captureCurrent, acceptLocalAsset,
  } = useAssetIdentityNavigation({
    isDirty,
    load: async (identity, { initial, isCurrent }) => {
      if (initial && !identity.assetId && !initialImport.current) {
        const handoff = takePendingToolFile('worldbook');
        const aiImport = sessionStorage.getItem('ai-worldbook-import');
        sessionStorage.removeItem('ai-worldbook-import');
        let aiWorldbook: WorldBook | null = null;
        try {
          const parsed = aiImport ? JSON.parse(aiImport) : null;
          if (parsed?.entries) aiWorldbook = parsed;
        } catch { /* ignore invalid AI handoff */ }
        initialImport.current = handoff ? readWorldBookUpload(handoff).then((upload) => ({ ...upload, autoSave: true })) : Promise.resolve(
          aiWorldbook ? { worldbook: aiWorldbook, title: 'AI 提取的世界书', autoSave: false } : null,
        );
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
        imported,
      };
    },
    accept: (target, identity) => {
      if (!target.preserveSession || target.item) {
        hydrateWorldbook(target.item?.worldbook ?? null);
        setFilename(target.item?.title ?? 'worldbook');
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
    acceptLocalAsset(id, () => {
      setCurrentItemId(id);
      setWorldbook(wb);
      setFilename(name);
      setSelectedUid(null);
      setActiveTab('edit');
    });
    const isCurrent = captureCurrent();
    // 自动保留为导入历史（autoSaved），并裁剪到最近 5 份
    (async () => {
      const now = Date.now();
      await saveWorldBook({
        id,
        title: name,
        worldbook: wb,
        createdAt: now,
        updatedAt: now,
        autoSaved: true,
        ...(sourceModifiedAt === undefined ? {} : { sourceModifiedAt }),
      });
      await pruneAutoSavedWorldBooks(5);
      if (!isCurrent()) return;
      const items = await getAllWorldBooks();
      if (isCurrent()) setSavedItems(items);
    })().catch(() => { /* 自动历史失败不阻塞导入 */ });
  }, [setWorldbook, captureCurrent, acceptLocalAsset]);

  const handleSaveLocal = useCallback(async () => {
    if (!worldbook) return;
    const isCurrent = captureCurrent();
    const now = Date.now();
    const base = currentItemId ? savedItems.find(s => s.id === currentItemId) : undefined;

    // 角色上下文 + 已入库的资产：写时复制（定稿第七章）——原资产不动，改动落到该角色的派生副本
    if (cowCharacterId && base) {
      const result = await saveAssetWithCow({
        kind: 'worldbook',
        baseId: base.id,
        reload: getAllWorldBooks,
        characterId: cowCharacterId,
        characterName: cowCharacterName,
        title: filename,
        content: { worldbook, autoSaved: false },
        newId: generateWorldBookId,
        save: saveWorldBook,
        now,
      }).catch((error: unknown) => {
        if (!isCurrent()) return null;
        // 重读失败 / 资产已被删除 / 落库失败：说清楚并中止，草稿仍在编辑器里
        toast({
          title: '保存失败',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        });
        return null;
      });
      if (!result || !isCurrent()) return;
      // 原地更新时 result.title 就是 filename，这行是空操作
      setFilename(result.title);
      if (result.action === 'update') {
        toast({ title: '已保存', description: '永久留存，不会被自动清理' });
      } else if (result.action === 'redirect') {
        toast({ title: `已更新派生副本「${result.title}」`, description: '原世界书未改动' });
      } else {
        toast({ title: '已生成派生副本', description: `「${result.title}」，原世界书与其他角色不受影响` });
      }
      setCurrentItemId(result.targetId);
      markWorldbookClean(worldbook);
      const items = await getAllWorldBooks();
      if (isCurrent()) setSavedItems(items);
      return;
    }

    const id = currentItemId || generateWorldBookId();
    try {
      const item = buildWorldBookSaveItem({
        base,
        id,
        title: filename,
        worldbook,
        now,
      });
      await saveWorldBook(item);
      // 角色上下文里保存全新世界书：入库并直接挂到该角色名下
      if (cowCharacterId && !base) {
        const updatedCharacter = await updateCharacterAssetReference(cowCharacterId, 'worldbook', id, id, now);
        if (!updatedCharacter) throw new Error('资产已保存，但角色引用切换失败：角色可能已被删除');
      }
      if (!isCurrent()) return;
      setCurrentItemId(id);
      markWorldbookClean(worldbook);
      const items = await getAllWorldBooks();
      if (!isCurrent()) return;
      setSavedItems(items);
      toast({ title: '已保存', description: '永久留存，不会被自动清理' });
    } catch (error: unknown) {
      if (!isCurrent()) return;
      toast({
        title: '保存失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  }, [worldbook, filename, currentItemId, savedItems, cowCharacterId, cowCharacterName, toast, markWorldbookClean, captureCurrent]);

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
    acceptLocalAsset(item.id, () => {
      hydrateWorldbook(item.worldbook);
      setFilename(item.title);
      setCurrentItemId(item.id);
      setSelectedUid(null);
      setStagedDialogOpen(false);
      setConfirmLoadItem(null);
    });
    toast({ title: '已加载', description: `已加载「${item.title}」` });
  }, [hydrateWorldbook, toast, acceptLocalAsset]);

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

  const handleDeleteStaged = useCallback(async () => {
    if (!deleteTarget) return;
    const isCurrent = captureCurrent();
    const target = deleteTarget;
    const deleted = await executeDeleteAction(async () => {
      await deleteWorldBook(target.id);
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
  }, [currentItemId, deleteTarget, toast, captureCurrent]);

  return (
    <AppLayout>
      <div className="bg-background flex h-full min-h-0 flex-col overflow-hidden">
        <WorldBookHeader
          worldbook={worldbook}
          filename={filename}
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
            description="此操作不可恢复。若角色仍引用该世界书，角色页会显示引用失效。"
            onOpenChange={(open) => !open && setDeleteTarget(null)}
            onConfirm={() => void handleDeleteStaged()}
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
