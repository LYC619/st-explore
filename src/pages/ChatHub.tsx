import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CircleHelp, Loader2, MessageCircle, Plus, Search, Settings2, Sparkles, X } from 'lucide-react';
import { AppLayout } from '@/components/AppLayout';
import { CharacterPortrait } from '@/components/library/CharacterPortrait';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StoryListSkeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RoleplayGuide } from '@/components/roleplay/RoleplayGuide';
import { listCharacterIndex, listStoryIndex, type CharacterIndexEntry, type StoryIndexEntry } from '@/lib/archive-index';
import { isPlainSingleKeyShortcut } from '@/lib/keyboard-shortcuts';
import { startCharacterStory } from '@/lib/roleplay/start-story';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { displayCharacterName } from '@/lib/library-query';
import { saveSettingsSection } from '@/lib/settings-navigation';
import { formatFullTime, formatListTime } from '@/lib/time-display';
import { LOADING_LABEL } from '@/lib/ui-copy';
import { getLibraryTagPreferences } from '@/lib/archive-db';
import { characterChatTags, getChatTagOptions, normalizeLibraryTagPreferences } from '@/lib/library-tag-preferences';
import { scopedKey } from '@/lib/vault/vault-scope';

type ChatListFilters = { search: string; tag: string };
const returnFilters = new Map<string, ChatListFilters>();
const defaultFilters: ChatListFilters = { search: '', tag: '' };

export default function ChatHub() {
  const navigate = useNavigate();
  const [stories, setStories] = useState<StoryIndexEntry[]>([]);
  const [characters, setCharacters] = useState<CharacterIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [tagPreferences, setTagPreferences] = useState(() => normalizeLibraryTagPreferences(undefined));
  const scope = scopedKey('chat-list-filters');
  const [filterState, setFilterState] = useState(() => ({ scope, ...(returnFilters.get(scope) ?? defaultFilters) }));
  const filters = filterState.scope === scope ? filterState : returnFilters.get(scope) ?? defaultFilters;
  const { search } = filters;
  const tagOptions = getChatTagOptions(tagPreferences);
  const selectedTag = tagOptions.some(option => option.raw === filters.tag) ? filters.tag : '';
  const [visibleCount, setVisibleCount] = useState(60);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [characterSearch, setCharacterSearch] = useState('');
  const [characterCount, setCharacterCount] = useState(60);
  const [starting, setStarting] = useState<string>();
  const [startError, setStartError] = useState<string>();
  const [guideOpen, setGuideOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let disposed = false, requestId = 0;
    const refresh = async () => {
      const currentRequest = ++requestId, epoch = getVaultEpoch();
      setLoading(true); setLoadError(undefined);
      try {
        const [chats, cards, preferences] = await Promise.all([listStoryIndex(), listCharacterIndex(), getLibraryTagPreferences()]);
        if (disposed || currentRequest !== requestId || epoch !== getVaultEpoch()) return;
        setStories(chats.sort((a, b) => b.updatedAt - a.updatedAt));
        setCharacters(cards.sort((a, b) => b.updatedAt - a.updatedAt));
        setTagPreferences(preferences);
        const key = scopedKey('chat-list-filters');
        const remembered = returnFilters.get(key);
        if (remembered?.tag && !getChatTagOptions(preferences).some(option => option.raw === remembered.tag)) {
          const cleared = { ...remembered, tag: '' };
          returnFilters.set(key, cleared); setFilterState({ scope: key, ...cleared });
        }
      } catch (reason) {
        if (!disposed && currentRequest === requestId) setLoadError(reason instanceof Error ? reason.message : String(reason));
      } finally { if (!disposed && currentRequest === requestId) setLoading(false); }
    };
    void refresh();
    const stop = subscribeActiveVault(() => { void refresh(); });
    return () => { disposed = true; mounted.current = false; stop(); };
  }, [revision]);

  useEffect(() => {
    if (pickerOpen || guideOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isPlainSingleKeyShortcut(e)) return;
      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [guideOpen, pickerOpen]);

  const characterMap = new Map(characters.map(c => [c.id, c]));
  const names = new Map(characters.map(character => [character.id, displayCharacterName(character)]));
  const taggedCharacters = new Set(characters.filter(character => characterChatTags(character).includes(selectedTag)).map(character => character.id));
  const characterName = (story: StoryIndexEntry) => story.characterId ? names.get(story.characterId) ?? '角色已移除' : '未绑定角色';
  const query = search.trim().toLocaleLowerCase();
  const filtered = stories.filter(story => (!selectedTag || !!story.characterId && taggedCharacters.has(story.characterId))
    && (story.title + ' ' + characterName(story)).toLocaleLowerCase().includes(query));
  const hasFilters = !!query || !!selectedTag;
  const changeFilters = (patch: Partial<ChatListFilters>) => {
    const next = { ...filters, ...patch };
    returnFilters.set(scope, next); setFilterState({ ...next, scope }); setVisibleCount(60);
  };
  const cardQuery = characterSearch.trim().toLocaleLowerCase();
  const filteredCharacters = characters.filter(character => [displayCharacterName(character), character.name, character.subtitle ?? '']
    .some(value => value.toLocaleLowerCase().includes(cardQuery)));
  const openChat = (storyId: string) => navigate('/play/' + encodeURIComponent(storyId) + '?from=chats');
  const openModels = () => { saveSettingsSection('ai'); navigate('/settings'); };
  const newChat = () => { setCharacterSearch(''); setCharacterCount(60); setStartError(undefined); setPickerOpen(true); };
  const createChat = async (characterId: string) => {
    if (starting) return;
    setStarting(characterId); setStartError(undefined);
    try {
      const storyId = await startCharacterStory(characterId);
      if (mounted.current) openChat(storyId);
    } catch (reason) { if (mounted.current) setStartError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (mounted.current) setStarting(undefined); }
  };
  const enterTavern = () => {
    if (filtered[0]) openChat(filtered[0].id);
    else newChat();
  };

  return <AppLayout titleBarContent="聊天">
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-wide text-[color:var(--text-primary)]">聊天剧场</h1>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">接着上次的楼层继续聊，或挑一张角色卡展开新故事。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={loading || !!loadError || hasFilters && !filtered.length} onClick={enterTavern}><MessageCircle className="mr-2 h-4 w-4" />进入酒馆</Button>
          <Button variant="outline" onClick={openModels}><Settings2 className="mr-2 h-4 w-4" />模型设置</Button>
          <Button onClick={newChat}><Plus className="mr-2 h-4 w-4" />新建聊天</Button>
        </div>
      </header>
      <button type="button" onClick={() => navigate('/worlds')} className="group flex min-h-28 w-full items-center justify-between gap-4 rounded-xl border border-[color:var(--brand-hairline)] bg-gradient-to-r from-[var(--brand-active-bg-strong)] to-[var(--bg-elevated)] px-6 py-5 text-left text-[color:var(--text-primary)] transition-colors hover:border-brand">
        <span>
          <span className="mb-1 block text-xs tracking-[0.2em] text-brand">原生世界 · 无需配置模型</span>
          <span className="block font-serif text-2xl">山海之间</span>
          <span className="mt-1 block text-sm text-[color:var(--text-muted)]">走进地图，追踪十二位行旅。下一场雨，会改变谁的路？</span>
        </span>
        <ArrowRight className="h-6 w-6 shrink-0 text-brand transition-transform group-hover:translate-x-1" />
      </button>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3.5">
        <CircleHelp className="h-5 w-5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[color:var(--text-primary)]">第一次在 STE 续聊？</p>
          <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">先在「模型设置」填好常用接口即可直接开聊；记忆管家与柏宝书可随时按需开启。</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setGuideOpen(true)}>使用帮助<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>
      </div>
      <section aria-label="已有聊天" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-lg font-semibold text-[color:var(--text-primary)]">
            已有聊天
            {!loading && !loadError && (
              <span className="ml-2 font-sans text-xs font-normal text-[color:var(--text-muted)]">
                {hasFilters ? `${filtered.length} / ${stories.length}` : `${stories.length} 篇`}
              </span>
            )}
          </h2>
          <div className="relative w-full sm:w-72">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              aria-label="搜索聊天"
              placeholder="搜索聊天标题或角色名"
              className="pl-9 pr-8"
              value={search}
              onChange={event => changeFilters({ search: event.target.value })}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  if (search) changeFilters({ search: '' });
                  else searchInputRef.current?.blur();
                }
              }}
            />
            {search ? (
              <button
                type="button"
                aria-label="清空聊天搜索"
                onClick={() => changeFilters({ search: '' })}
                className="tap-target absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd
                aria-hidden="true"
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:inline-block rounded border border-border/70 bg-muted/60 px-1.5 text-[11px] font-mono text-muted-foreground"
              >
                /
              </kbd>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="chat-organizing-tag" className="text-xs text-[color:var(--text-muted)]">标签筛选</label>
          <select id="chat-organizing-tag" value={selectedTag} disabled={loading || !!loadError}
            className="ste-select h-11 min-w-40 text-sm"
            onChange={event => changeFilters({ tag: event.target.value })}>
            <option value="">全部标签</option>
            {tagOptions.map(tag => <option key={tag.raw} value={tag.raw}>{tag.label}</option>)}
          </select>
          {hasFilters && <Button variant="ghost" size="sm" onClick={() => changeFilters(defaultFilters)}>清除筛选</Button>}
          <Button variant="ghost" size="sm" onClick={() => navigate('/library?manageTags=1')}>设置显示的标签</Button>
        </div>
        {selectedTag && <p className="text-xs text-[color:var(--text-muted)]">当前按角色标签筛选，列出所选角色名下的全部对话。</p>}
        {loading ? <StoryListSkeleton count={5} />
          : loadError ? <div role="alert" className="rounded-xl border border-[color:var(--border-normal)] bg-[var(--bg-elevated)] p-5">
            <p className="font-medium text-[color:var(--text-primary)]">聊天列表暂时没能读出来，库里的原记录未受影响。</p>
            <p className="mt-1 break-words text-sm text-[color:var(--text-muted)]">{loadError}</p>
            <Button variant="outline" className="mt-3" onClick={() => setRevision(value => value + 1)}>重新读取</Button>
          </div>
          : filtered.length === 0 ? <div className="flex flex-col items-center rounded-xl border border-dashed border-[color:var(--border-normal)] bg-[var(--bg-elevated)] px-4 py-14 text-center">
            <MessageCircle className="mb-3 h-9 w-9 text-[color:var(--text-muted)]" />
            <h3 className="font-serif text-base font-medium text-[color:var(--text-primary)]">{hasFilters ? '没有找到匹配的聊天' : '还没有开启过对话'}</h3>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">{hasFilters ? '试试换个关键词、切换标签，或清除筛选条件。' : '挑一张收藏馆里的角色卡，就能直接进入酒馆展开初遇。'}</p>
            <Button className="mt-4" variant="outline" onClick={() => (hasFilters ? changeFilters(defaultFilters) : newChat())}>
              {hasFilters ? '显示全部聊天' : '选择角色开始'}
            </Button>
          </div>
          : <div className="divide-y divide-[color:var(--hairline-inner)] rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)]">
            {filtered.slice(0, visibleCount).map(story => {
              const charEntry = story.characterId ? characterMap.get(story.characterId) : undefined;
              const branchCount = story.branchIndex?.length ?? 0;
              return (
                <button
                  key={story.id}
                  type="button"
                  aria-label={'继续 ' + story.title}
                  className="group flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-[var(--hover-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                  onClick={() => openChat(story.id)}
                >
                  {charEntry ? (
                    <span className="relative aspect-[3/4] w-10 shrink-0 overflow-hidden rounded-lg bg-chrome shadow-sm">
                      <CharacterPortrait character={charEntry} markFontSize={16} />
                    </span>
                  ) : (
                    <span aria-hidden="true" className="flex aspect-[3/4] w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--hover-overlay)] font-serif text-sm font-semibold text-brand">
                      {Array.from(characterName(story))[0]}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-serif text-[15px] font-medium text-[color:var(--text-primary)] group-hover:text-brand transition-colors">
                      {story.title}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[color:var(--text-muted)]">
                      <span className="truncate max-w-44">{characterName(story)}</span>
                      <span>·</span>
                      <span>{story.floorCount} 楼</span>
                      {branchCount > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-brand">{branchCount} 条支线</span>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-[color:var(--text-muted)]" title={formatFullTime(story.updatedAt)}>
                    {formatListTime(story.updatedAt)}
                  </span>
                  <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
                </button>
              );
            })}
          </div>}
        {!loading && !loadError && filtered.length > visibleCount && <Button variant="ghost" onClick={() => setVisibleCount(count => count + 60)}>显示更多聊天</Button>}
      </section>
    </div>
    <Dialog open={pickerOpen} onOpenChange={open => { if (!starting) setPickerOpen(open); }}>
      <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif">选择角色，展开新对话</DialogTitle>
          <DialogDescription>点角色立绘直接以默认开场白进入酒馆；想挑备选开场白可点右侧「选开场」。</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Input aria-label="搜索角色" placeholder="搜索角色名或副标题…" className="pr-8" value={characterSearch} onChange={event => { setCharacterSearch(event.target.value); setCharacterCount(60); }} />
          {characterSearch && (
            <button type="button" aria-label="清空角色搜索" onClick={() => { setCharacterSearch(''); setCharacterCount(60); }} className="tap-target absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {startError && <p role="alert" className="break-words text-sm text-destructive">{startError}</p>}
        {loading ? <p role="status" className="py-6 text-center text-sm text-muted-foreground">{LOADING_LABEL}</p>
          : loadError ? <p role="alert" className="text-sm text-destructive">角色列表暂时没能读出来，请关闭窗口后点击「重新读取」再试。</p>
          : characters.length === 0 ? <div className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">收藏馆里还没有角色卡，先去导入一张心仪的角色卡吧。</p>
            <Button onClick={() => navigate('/library')}>前往角色库导入</Button>
          </div>
          : <div className="grid gap-2.5 sm:grid-cols-2">
            {filteredCharacters.slice(0, characterCount).map(character => {
              const disp = displayCharacterName(character);
              const isBusy = starting === character.id;
              return (
                <div
                  key={character.id}
                  className="flex items-stretch rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] transition-colors hover:border-[color:var(--brand-hairline)] overflow-hidden"
                >
                  <button
                    type="button"
                    disabled={!!starting}
                    aria-label={'与' + disp + '聊天'}
                    onClick={() => { void createChat(character.id); }}
                    className="flex min-w-0 flex-1 items-center gap-3 p-2.5 text-left hover:bg-[var(--hover-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand disabled:opacity-60"
                  >
                    <span className="relative aspect-[2/3] h-14 shrink-0 overflow-hidden rounded-lg bg-chrome">
                      <CharacterPortrait character={character} markFontSize={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-serif text-sm font-semibold text-[color:var(--text-primary)]">{disp}</span>
                      {character.subtitle ? (
                        <span className="mt-0.5 line-clamp-2 text-xs text-[color:var(--text-muted)]">{character.subtitle}</span>
                      ) : (
                        <span className="mt-0.5 block text-[11px] text-[color:var(--text-muted)]">点击以默认开场开聊</span>
                      )}
                    </span>
                    {isBusy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" /> : <ArrowRight className="h-4 w-4 shrink-0 text-[color:var(--text-muted)]" />}
                  </button>
                  <button
                    type="button"
                    disabled={!!starting}
                    title={`去「${disp}」开场白剧场挑选备选开场`}
                    aria-label={`挑选${disp}的开场白`}
                    onClick={() => {
                      setPickerOpen(false);
                      navigate(`/character/${character.id}?tab=greetings`);
                    }}
                    className="tap-target flex shrink-0 flex-col items-center justify-center gap-0.5 border-l border-[color:var(--hairline-inner)] px-2.5 text-[11px] text-[color:var(--text-muted)] hover:bg-[var(--brand-active-bg)] hover:text-brand"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>选开场</span>
                  </button>
                </div>
              );
            })}
            {filteredCharacters.length === 0 && <p className="sm:col-span-2 py-6 text-center text-sm text-muted-foreground">没有找到匹配的角色。</p>}
            {filteredCharacters.length > characterCount && <Button variant="ghost" className="sm:col-span-2" onClick={() => setCharacterCount(count => count + 60)}>显示更多角色</Button>}
          </div>}
      </DialogContent>
    </Dialog>
    <RoleplayGuide open={guideOpen} onOpenChange={setGuideOpen} inChat={false} onModels={openModels} onRuntime={newChat} />
  </AppLayout>;
}
