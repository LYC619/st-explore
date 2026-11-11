import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CircleHelp, Loader2, MessageCircle, Plus, Search, Settings2 } from 'lucide-react';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RoleplayGuide } from '@/components/roleplay/RoleplayGuide';
import { listCharacterIndex, listStoryIndex, type CharacterIndexEntry, type StoryIndexEntry } from '@/lib/archive-index';
import { startCharacterStory } from '@/lib/roleplay/start-story';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { displayCharacterName } from '@/lib/library-query';
import { saveSettingsSection } from '@/lib/settings-navigation';
import { formatFullTime, formatListTime } from '@/lib/time-display';
import { LOADING_LABEL } from '@/lib/ui-copy';
import { getLibraryTagPreferences } from '@/lib/archive-db';
import { characterChatTags, getChatTagOptions, normalizeLibraryTagPreferences } from '@/lib/library-tag-preferences';
import { scopedKey } from '@/lib/vault/vault-scope';

// Keep only list controls during this app session, scoped to the selected library.
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
          <h1 className="text-2xl font-semibold tracking-tight">聊天</h1>
          <p className="mt-1 text-sm text-muted-foreground">继续已有的对话，或选一个角色，开始新的故事。</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={loading || !!loadError || hasFilters && !filtered.length} onClick={enterTavern}><MessageCircle className="mr-2 h-4 w-4" />进入酒馆</Button>
          <Button variant="outline" onClick={openModels}><Settings2 className="mr-2 h-4 w-4" />模型设置</Button>
          <Button onClick={newChat}><Plus className="mr-2 h-4 w-4" />新建聊天</Button>
        </div>
      </header>
      <button onClick={() => navigate('/worlds')} className="group flex min-h-28 w-full items-center justify-between gap-4 rounded-xl border border-primary/30 bg-gradient-to-r from-primary/15 to-card px-6 py-5 text-left text-card-foreground">
        <span><span className="mb-1 block text-xs tracking-[0.2em] text-primary">原生世界 · 无需模型</span><span className="block font-serif text-2xl">山海之间</span><span className="mt-1 block text-sm text-muted-foreground">走进地图，追踪十二位行旅。下一场雨，会改变谁的路？</span></span><ArrowRight className="h-6 w-6 shrink-0 transition-transform group-hover:translate-x-1" />
      </button>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
        <CircleHelp className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">第一次在 STE 聊天？</p>
          <p className="mt-0.5 text-sm text-muted-foreground">先配置主模型即可开聊。STE Agent 和柏宝书可按需要开启。</p>
        </div>
        <Button variant="ghost" onClick={() => setGuideOpen(true)}>使用帮助<ArrowRight className="ml-2 h-4 w-4" /></Button>
      </div>
      <section aria-label="已有聊天" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">已有聊天{!loading && !loadError && <span className="ml-2 text-sm font-normal text-muted-foreground">{hasFilters ? `${filtered.length} / ${stories.length}` : stories.length}</span>}</h2>
          <div className="relative w-full sm:w-72">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input aria-label="搜索聊天" placeholder="搜索聊天或角色" className="pl-9" value={search} onChange={event => changeFilters({ search: event.target.value })} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="chat-organizing-tag" className="text-sm text-muted-foreground">标签筛选</label>
          <select id="chat-organizing-tag" value={selectedTag} disabled={loading || !!loadError}
            className="h-11 min-w-36 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={event => changeFilters({ tag: event.target.value })}>
            <option value="">全部标签</option>
            {tagOptions.map(tag => <option key={tag.raw} value={tag.raw}>{tag.label}</option>)}
          </select>
          {hasFilters && <Button variant="ghost" className="min-h-11" onClick={() => changeFilters(defaultFilters)}>清除筛选</Button>}
          <Button variant="ghost" className="min-h-11" onClick={() => navigate('/library?manageTags=1')}>设置显示的标签</Button>
        </div>
        {selectedTag && <p className="text-xs text-muted-foreground">按当前库的角色标签筛选，显示该角色的全部故事。</p>}
        {loading ? <div role="status" className="flex items-center justify-center gap-2 py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />{LOADING_LABEL}</div>
          : loadError ? <div role="alert" className="rounded-lg border p-5">
            <p className="font-medium">聊天列表暂时无法读取，文件库里的原记录未改动。</p>
            <p className="mt-1 break-words text-sm text-muted-foreground">{loadError}</p>
            <Button variant="outline" className="mt-3" onClick={() => setRevision(value => value + 1)}>重新读取</Button>
          </div>
          : filtered.length === 0 ? <div className="flex flex-col items-center rounded-xl border border-dashed px-4 py-14 text-center">
            <MessageCircle className="mb-3 h-8 w-8 text-muted-foreground" />
            <h3 className="font-medium">{hasFilters ? '没有找到匹配的聊天' : '还没有聊天'}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{hasFilters ? '试试其他标签、关键词，或清除筛选。' : '选择库里的角色，就能直接进入酒馆开始对话。'}</p>
            {!hasFilters && <Button className="mt-4" variant="outline" onClick={newChat}>选择角色开始</Button>}
          </div>
          : <div className="divide-y rounded-xl border bg-card">
            {filtered.slice(0, visibleCount).map(story => <button key={story.id} type="button" aria-label={'继续 ' + story.title}
              className="group flex w-full items-center gap-3 p-4 text-left transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => openChat(story.id)}>
              <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-medium">{Array.from(characterName(story))[0]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{story.title}</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">{characterName(story)} · {story.floorCount} 楼</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground" title={formatFullTime(story.updatedAt)}>{formatListTime(story.updatedAt)}</span>
              <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
            </button>)}
          </div>}
        {!loading && !loadError && filtered.length > visibleCount && <Button variant="ghost" onClick={() => setVisibleCount(count => count + 60)}>显示更多聊天</Button>}
      </section>
    </div>
    <Dialog open={pickerOpen} onOpenChange={open => { if (!starting) setPickerOpen(open); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>选择角色，开始聊天</DialogTitle>
          <DialogDescription>新聊天使用角色卡的开场白，原有故事会保留。</DialogDescription>
        </DialogHeader>
        <Input aria-label="搜索角色" placeholder="搜索角色" value={characterSearch} onChange={event => { setCharacterSearch(event.target.value); setCharacterCount(60); }} />
        {startError && <p role="alert" className="break-words text-sm text-destructive">{startError}</p>}
        {loading ? <p role="status" className="py-6 text-center text-sm text-muted-foreground">{LOADING_LABEL}</p>
          : loadError ? <p role="alert" className="text-sm text-destructive">角色列表未能读取。请关闭此窗口后重试读取。</p>
          : characters.length === 0 ? <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">还没有角色卡，先到角色库导入一张。</p>
            <Button onClick={() => navigate('/library')}>打开角色库</Button>
          </div>
          : <div className="space-y-2">
            {filteredCharacters.slice(0, characterCount).map(character => <Button key={character.id} variant="outline" className="h-auto min-h-14 w-full justify-start gap-3 whitespace-normal py-3 text-left"
              disabled={!!starting} aria-label={'与' + displayCharacterName(character) + '聊天'} onClick={() => { void createChat(character.id); }}>
              {starting === character.id ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <MessageCircle className="h-5 w-5 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1"><span className="block truncate">{displayCharacterName(character)}</span>
                {character.subtitle && <span className="mt-1 line-clamp-2 text-xs font-normal text-muted-foreground">{character.subtitle}</span>}</span>
              <ArrowRight className="h-4 w-4 shrink-0" />
            </Button>)}
            {filteredCharacters.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">没有找到匹配的角色。</p>}
            {filteredCharacters.length > characterCount && <Button variant="ghost" onClick={() => setCharacterCount(count => count + 60)}>显示更多角色</Button>}
          </div>}
      </DialogContent>
    </Dialog>
    <RoleplayGuide open={guideOpen} onOpenChange={setGuideOpen} inChat={false} onModels={openModels} onRuntime={newChat} />
  </AppLayout>;
}
