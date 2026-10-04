import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CharacterPortrait } from '@/components/library/CharacterPortrait';
import { displayCharacterName } from '@/lib/library-query';
import { getAllSummaries } from '@/lib/summary-db';
import { scopedKey } from '@/lib/vault/vault-scope';
import { getVaultEpoch } from '@/lib/vault/active';
import { useViewport } from '@/hooks/use-viewport';
import { cn } from '@/lib/utils';
import type { ArchiveCharacter } from '@/types/archive';
import type { StoryIndexEntry } from '@/lib/archive-index';
import type { SummaryItem } from '@/types/summary';
import type { InlineStoryReaderHandle } from '@/components/character/InlineStoryReader';
import { ReviewCharacterContent } from './ReviewCharacterContent';
import { ReviewEdits } from './ReviewEdits';
import { reviewStories } from './review-model';
import { getReviewSession, type ReviewTab } from './review-session';

interface LibraryReviewViewProps {
  characters: ArchiveCharacter[];
  storyIndex: StoryIndexEntry[];
  onCharacterChange: (character: ArchiveCharacter) => void;
  onStoriesChange: () => Promise<void>;
}
const tabs: { id: ReviewTab; label: string }[] = [{ id: 'overview', label: '总览' }, { id: 'notes', label: '备注' }, { id: 'stories', label: '故事' }, { id: 'volume', label: '总结' }, { id: 'diary', label: '日记' }];

export interface LibraryReviewHandle { flushPendingSave: () => Promise<void> }

export const LibraryReviewView = forwardRef<LibraryReviewHandle, LibraryReviewViewProps>(function LibraryReviewView({ characters, storyIndex, onCharacterChange, onStoriesChange }, ref) {
  const navigate = useNavigate();
  const { isCompact } = useViewport();
  const scope = scopedKey('library-review');
  const session = useMemo(() => getReviewSession(scope), [scope]);
  const [selectedId, setSelectedId] = useState(session.selectedId);
  const [tab, setTab] = useState(session.tab);
  const [onlyWithStories, setOnlyWithStories] = useState(session.onlyWithStories);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [summaries, setSummaries] = useState<SummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [, setStoryRevision] = useState(0);
  const readerRef = useRef<InlineStoryReaderHandle>(null);
  const readerReadyRef = useRef(false);
  const [readerReady, setReaderReady] = useState(false);
  const onReaderReady = useCallback((ready: boolean) => {
    readerReadyRef.current = ready;
    setReaderReady(ready);
  }, []);
  const directoryRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const transitionLock = useRef(false);
  const mounted = useRef(true);
  const previousCharacter = useRef<ArchiveCharacter>();
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    storyIndex.forEach(story => { if (story.characterId) result.set(story.characterId, (result.get(story.characterId) ?? 0) + 1); });
    return result;
  }, [storyIndex]);
  const directory = useMemo(() => onlyWithStories ? characters.filter(character => counts.has(character.id)) : characters, [characters, counts, onlyWithStories]);
  const selected = characters.find(character => character.id === selectedId) ?? previousCharacter.current;
  if (selected) previousCharacter.current = selected;
  const stories = useMemo(() => selected ? reviewStories(storyIndex, selected.id) : [], [storyIndex, selected]);
  const characterSession = selected ? session.characters.get(selected.id) : undefined;
  const selectedStoryId = characterSession?.storyId;
  const activeCharacterId = selected?.id;
  const virtual = useVirtualizer({ count: directory.length, getScrollElement: () => directoryRef.current, estimateSize: () => 76, overscan: 5, enabled: directory.length > 80, initialRect: { width: 260, height: 600 }, initialOffset: session.directoryScroll });
  const rememberScroll = useCallback(() => {
    if (!selected || !scrollRef.current) return;
    if ((loading || loadError) && (tab === 'volume' || tab === 'diary' || tab === 'overview')) return;
    if (tab === 'stories' && selectedStoryId && !readerReadyRef.current) return;
    const value = session.characters.get(selected.id) ?? { scroll: {} };
    if (tab === 'stories' && selectedStoryId) value.storyScroll = scrollRef.current.scrollTop;
    else value.scroll[tab] = scrollRef.current.scrollTop;
    session.characters.set(selected.id, value);
  }, [selected, session, tab, loading, loadError, selectedStoryId]);
  const flushPendingSave = useCallback(async () => {
    const epoch = getVaultEpoch();
    await readerRef.current?.flushPendingSave();
    if (!mounted.current || epoch !== getVaultEpoch()) throw new Error('文件库或页面已切换');
    rememberScroll();
  }, [rememberScroll]);
  useImperativeHandle(ref, () => ({ flushPendingSave }), [flushPendingSave]);
  const transition = useCallback(async (action: () => void) => {
    if (transitionLock.current) return;
    transitionLock.current = true; setTransitioning(true); setTransitionError(null);
    const epoch = getVaultEpoch();
    try {
      await flushPendingSave();
      if (!mounted.current || epoch !== getVaultEpoch()) return;
      action();
    } catch (e) { if (mounted.current && epoch === getVaultEpoch()) setTransitionError(`故事尚未保存，已保留当前内容：${e instanceof Error ? e.message : '请重试'}`); }
    finally { transitionLock.current = false; if (mounted.current) setTransitioning(false); }
  }, [flushPendingSave]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false; const epoch = getVaultEpoch();
    setLoading(true); setLoadError(null);
    getAllSummaries().then(records => { if (!cancelled && epoch === getVaultEpoch()) setSummaries(records); }, error => { if (!cancelled && epoch === getVaultEpoch()) setLoadError(error instanceof Error ? error.message : '请稍后重试'); }).finally(() => { if (!cancelled && epoch === getVaultEpoch()) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, refresh]);
  useEffect(() => {
    if (directory.some(character => character.id === selectedId)) return;
    if (selectedId === undefined && !directory.length) return;
    void transition(() => {
      const next = directory[0]; previousCharacter.current = next;
      session.selectedId = next?.id; setSelectedId(next?.id);
    });
  }, [directory, selectedId, session, transition]);
  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    const saved = activeCharacterId ? session.characters.get(activeCharacterId) : undefined;
    if (tab === 'stories' && selectedStoryId) {
      if (!readerReadyRef.current || saved?.storyScroll === undefined) return;
      scrollRef.current.scrollTop = saved.storyScroll;
    } else scrollRef.current.scrollTop = saved?.scroll[tab] ?? 0;
  }, [activeCharacterId, selectedStoryId, tab, loading, readerReady, session]);
  useLayoutEffect(() => {
    const index = directory.findIndex(character => character.id === selectedId);
    if (index < 0) return;
    if (directory.length > 80) virtual.scrollToIndex(index, { align: 'auto' });
    else directoryRef.current?.querySelector(`[data-review-character="${CSS.escape(selectedId!)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, directory, directoryOpen, virtual]);
  const changeTab = (next: ReviewTab) => { void transition(() => { session.tab = next; setTab(next); }); };
  const changeStory = (id?: string) => { void transition(() => {
    if (!selected) return;
    const value = session.characters.get(selected.id) ?? { scroll: {} };
    value.storyId = id; value.storyScroll = undefined; value.scroll.stories = 0;
    session.characters.set(selected.id, value); setStoryRevision(value => value + 1);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }); };
  const selectCharacter = (id: string) => { void transition(() => { session.selectedId = id; setSelectedId(id); setDirectoryOpen(false); }); };
  const renderRow = (character: ArchiveCharacter) => <button type="button" data-review-character={character.id} aria-label={`选择${displayCharacterName(character)}`} aria-pressed={character.id === selectedId} disabled={transitioning} className={cn('tap-target flex h-[76px] w-full items-center gap-3 rounded-lg px-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', character.id === selectedId && 'bg-primary/10 ring-1 ring-inset ring-primary/30')} onClick={() => selectCharacter(character.id)}>
    <span className="relative h-14 w-10 shrink-0 overflow-hidden rounded bg-muted"><CharacterPortrait character={character} /></span><span className="min-w-0 space-y-1"><span className="block truncate text-sm font-medium">{displayCharacterName(character)}</span><span className="block text-xs text-muted-foreground">{counts.get(character.id) ?? 0} 个故事 · {character.notes?.length ?? 0} 条备注</span></span>
  </button>;
  return <div className={cn('flex min-h-[400px] flex-1 overflow-hidden rounded-xl border border-border bg-background', isCompact ? 'flex-col' : 'flex-row')} style={{ height: 'calc(100dvh - 12rem)' }} data-library-review>
    {isCompact && <Button variant="ghost" className="m-2 justify-between" aria-expanded={directoryOpen} onClick={() => setDirectoryOpen(open => !open)}>{selected ? displayCharacterName(selected) : '选择角色'} · {directory.length} 张卡<ChevronDown className="h-4 w-4" /></Button>}
    {(!isCompact || directoryOpen) && <aside aria-label="回顾角色目录" className={cn('flex shrink-0 flex-col bg-muted/20', isCompact ? 'max-h-[45dvh] border-b border-border' : 'w-64 border-r border-border xl:w-72')}>
      <div className="flex items-center justify-between gap-2 border-b border-border p-3"><span className="text-xs text-muted-foreground">{directory.length} 张卡</span><label className="flex min-h-8 cursor-pointer items-center gap-2 text-xs"><input type="checkbox" aria-label="仅有故事" checked={onlyWithStories} disabled={transitioning} onChange={e => { const checked = e.target.checked; void transition(() => { session.onlyWithStories = checked; setOnlyWithStories(checked); }); }} />仅有故事</label></div>
      <div ref={directoryRef} className="min-h-0 flex-1 overflow-y-auto p-2" onScroll={e => { session.directoryScroll = e.currentTarget.scrollTop; }}>
        {!directory.length && <p className="px-3 py-8 text-center text-sm text-muted-foreground">没有符合条件的角色</p>}
        {directory.length > 80 ? <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>{virtual.getVirtualItems().map(item => <div key={directory[item.index].id} style={{ position: 'absolute', width: '100%', top: 0, transform: `translateY(${item.start}px)` }}>{renderRow(directory[item.index])}</div>)}</div> : directory.map(character => <div key={character.id}>{renderRow(character)}</div>)}
      </div>
    </aside>}
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="角色回顾内容">
      {selected ? <>
        <header className="space-y-3 border-b border-border px-4 pb-3 pt-4 sm:px-6"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words font-display text-xl font-semibold">{displayCharacterName(selected)}</h2><p className="mt-1 text-xs text-muted-foreground">{selected.rating !== undefined ? `${selected.rating} 分` : '未评分'} · {selected.type ?? '未分类'}</p></div><div className="flex flex-wrap gap-2"><ReviewEdits character={selected} notesVisible={false} onCharacterChange={onCharacterChange} /><Button size="sm" variant="outline" disabled={transitioning} onClick={() => void transition(() => navigate(`/character/${selected.id}`))}><ExternalLink className="mr-1 h-3.5 w-3.5" />打开角色详情</Button><Button size="icon" variant="ghost" aria-label="刷新回顾" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw className="h-4 w-4" /></Button></div></div>
          {!!selected.tags.length && <div className="flex flex-wrap gap-1.5">{selected.tags.map(tag => <span key={tag} className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">{tag}</span>)}</div>}
          <div role="tablist" aria-label="回顾内容" className="flex gap-1 overflow-x-auto">{tabs.map(item => <Button key={item.id} id={`review-tab-${item.id}`} role="tab" aria-controls="review-content" aria-selected={tab === item.id} disabled={transitioning} variant={tab === item.id ? 'secondary' : 'ghost'} size="sm" onClick={() => changeTab(item.id)}>{item.label}</Button>)}</div>
        </header>
        {transitionError && <p role="alert" className="border-b border-border px-4 py-2 text-sm text-[color:var(--status-danger)]">{transitionError}</p>}
        <div id="review-content" role="tabpanel" aria-labelledby={`review-tab-${tab}`} ref={scrollRef} data-review-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6" onScroll={rememberScroll}>
          <ReviewCharacterContent character={selected} stories={stories} summaries={summaries} tab={tab} storyId={selectedStoryId} loading={loading} error={loadError} onRetry={() => setRefresh(value => value + 1)} onTabChange={changeTab} onStoryChange={changeStory} onCharacterChange={onCharacterChange} onStoriesChange={onStoriesChange} onOpenEditor={id => void transition(() => navigate(`/story/${id}`))} readerRef={readerRef} onReaderReady={onReaderReady} restoreFloor={characterSession?.storyScroll === undefined} />
        </div>
      </> : <p className="m-auto p-8 text-center text-sm text-muted-foreground">没有符合条件的角色</p>}
    </section>
  </div>;
});
