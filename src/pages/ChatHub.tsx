import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CircleHelp,
  ExternalLink,
  MessageCircle,
  Plus,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import { AppLayout } from '@/components/AppLayout';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StoryListSkeleton } from '@/components/ui/skeleton';
import { RoleplayGuide } from '@/components/roleplay/RoleplayGuide';
import { ChatHubStoryRow } from '@/components/roleplay/ChatHubStoryRow';
import { NewChatPickerDialog } from '@/components/roleplay/NewChatPickerDialog';
import { preloadRoleplayPage } from '@/components/roleplay/RoleplayWorkspace';
import { listCharacterIndex, listStoryIndex, type CharacterIndexEntry, type StoryIndexEntry } from '@/lib/archive-index';
import { listAssetIndex } from '@/lib/asset-index';
import type { AssetIndexEntry } from '@/lib/asset-index-entry';
import { isPlainSingleKeyShortcut } from '@/lib/keyboard-shortcuts';
import { startCharacterStory } from '@/lib/roleplay/start-story';
import {
  closeDetachedTavernWindow,
  focusDetachedTavernWindow,
  getPreferredTavernWindowMode,
  launchRoleplayTarget,
  reserveDetachedWindowForAsyncAction,
  setPreferredTavernWindowMode,
  setRoleplayOpenChat,
  type TavernWindowMode,
  useRoleplaySessionState,
} from '@/lib/roleplay/detached-window';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { subscribeRecordChanges } from '@/lib/repo/changes';
import type { RemoveOptions } from '@/lib/repo';
import { displayCharacterName } from '@/lib/library-query';
import { saveSettingsSection } from '@/lib/settings-navigation';
import { deleteArchiveStory, getLibraryTagPreferences, updateArchiveStory } from '@/lib/archive-db';
import { renameArchiveStory } from '@/lib/story-rename';
import { executeDeleteAction } from '@/lib/destructive-action';
import { characterChatTags, getChatTagOptions, normalizeLibraryTagPreferences } from '@/lib/library-tag-preferences';
import { scopedKey } from '@/lib/vault/vault-scope';
import { buildEditorChatPath, setEditorStoryId } from '@/lib/editor-story-context';
import { useViewport } from '@/hooks/use-viewport';
import { useToast } from '@/hooks/use-toast';

type ChatListFilters = { search: string; tag: string };
const returnFilters = new Map<string, ChatListFilters>();
const defaultFilters: ChatListFilters = { search: '', tag: '' };

export default function ChatHub() {
  const navigate = useNavigate();
  const { isMobile } = useViewport();
  const { toast } = useToast();
  const roleplaySession = useRoleplaySessionState();
  const [windowMode, setWindowMode] = useState<TavernWindowMode>(getPreferredTavernWindowMode);

  const [stories, setStories] = useState<StoryIndexEntry[]>([]);
  const [characters, setCharacters] = useState<CharacterIndexEntry[]>([]);
  const [presets, setPresets] = useState<AssetIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [tagPreferences, setTagPreferences] = useState(() => normalizeLibraryTagPreferences(undefined));
  const scope = scopedKey('chat-list-filters');
  const [filterState, setFilterState] = useState(() => ({ scope, ...(returnFilters.get(scope) ?? defaultFilters) }));
  const filters = filterState.scope === scope ? filterState : returnFilters.get(scope) ?? defaultFilters;
  const { search } = filters;
  const tagOptions = getChatTagOptions(tagPreferences);
  const selectedTag = tagOptions.some((option) => option.raw === filters.tag) ? filters.tag : '';
  const [visibleCount, setVisibleCount] = useState(60);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [characterSearch, setCharacterSearch] = useState('');
  const [characterCount, setCharacterCount] = useState(60);
  const [starting, setStarting] = useState<string>();
  const [startError, setStartError] = useState<string>();
  const [guideOpen, setGuideOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StoryIndexEntry | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let requestId = 0;
    const refresh = async (silent = false) => {
      const currentRequest = ++requestId;
      const epoch = getVaultEpoch();
      if (!silent) {
        setLoading(true);
        setLoadError(undefined);
      }
      try {
        const [chats, cards, preferences, presetIdx] = await Promise.all([
          listStoryIndex(),
          listCharacterIndex(),
          getLibraryTagPreferences(),
          listAssetIndex('presets'),
        ]);
        if (disposed || currentRequest !== requestId || epoch !== getVaultEpoch()) return;
        setStories(chats.sort((a, b) => b.updatedAt - a.updatedAt));
        setCharacters(cards.sort((a, b) => b.updatedAt - a.updatedAt));
        setPresets(presetIdx);
        setTagPreferences(preferences);
        const key = scopedKey('chat-list-filters');
        const remembered = returnFilters.get(key);
        if (remembered?.tag && !getChatTagOptions(preferences).some((option) => option.raw === remembered.tag)) {
          const cleared = { ...remembered, tag: '' };
          returnFilters.set(key, cleared);
          setFilterState({ scope: key, ...cleared });
        }
      } catch (reason) {
        if (!disposed && currentRequest === requestId && !silent) {
          setLoadError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        if (!disposed && currentRequest === requestId && !silent) setLoading(false);
      }
    };
    void refresh(false);
    const stopVault = subscribeActiveVault(() => { void refresh(false); });
    const stopRecords = subscribeRecordChanges((change) => {
      if (change.store === 'archiveStories' || change.store === 'characters' || change.store === 'presets') {
        void refresh(true);
      }
    });
    return () => {
      disposed = true;
      mounted.current = false;
      stopVault();
      stopRecords();
    };
  }, [revision]);

  useEffect(() => {
    if (pickerOpen || guideOpen || !!deleteTarget) return undefined;
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
  }, [deleteTarget, guideOpen, pickerOpen]);

  const characterMap = new Map(characters.map((c) => [c.id, c]));
  const names = new Map(characters.map((character) => [character.id, displayCharacterName(character)]));
  const taggedCharacters = new Set(characters.filter((character) => characterChatTags(character).includes(selectedTag)).map((character) => character.id));
  const characterName = (story: StoryIndexEntry) => (story.characterId ? names.get(story.characterId) ?? '角色已移除' : '未绑定角色');
  const query = search.trim().toLocaleLowerCase();
  const filtered = stories.filter((story) => (!selectedTag || (!!story.characterId && taggedCharacters.has(story.characterId)))
    && `${story.title} ${characterName(story)}`.toLocaleLowerCase().includes(query));
  const hasFilters = !!query || !!selectedTag;
  const changeFilters = (patch: Partial<ChatListFilters>) => {
    const next = { ...filters, ...patch };
    returnFilters.set(scope, next);
    setFilterState({ ...next, scope });
    setVisibleCount(60);
  };
  const cardQuery = characterSearch.trim().toLocaleLowerCase();
  const filteredCharacters = characters.filter((character) => [displayCharacterName(character), character.name, character.subtitle ?? '']
    .some((value) => value.toLocaleLowerCase().includes(cardQuery)));

  useEffect(() => {
    void preloadRoleplayPage();
  }, []);

  const toggleWindowMode = () => {
    const next: TavernWindowMode = windowMode === 'detached' ? 'inline' : 'detached';
    setPreferredTavernWindowMode(next);
    setWindowMode(next);
  };

  const openChat = (storyId: string, forceMode?: TavernWindowMode) => {
    void preloadRoleplayPage();
    launchRoleplayTarget({
      storyId,
      fromChats: true,
      navigate,
      forceMode,
    });
  };

  const openReader = (storyId: string) => {
    setEditorStoryId(storyId);
    navigate(buildEditorChatPath(storyId));
  };

  const openModels = () => {
    saveSettingsSection('ai');
    navigate('/settings');
  };

  const newChat = () => {
    setCharacterSearch('');
    setCharacterCount(60);
    setStartError(undefined);
    setPickerOpen(true);
  };

  const createChat = async (characterId: string) => {
    if (starting) return;
    setStarting(characterId);
    setStartError(undefined);
    const reservation = reserveDetachedWindowForAsyncAction();
    try {
      const [storyId] = await Promise.all([startCharacterStory(characterId), preloadRoleplayPage()]);
      if (mounted.current) {
        setPickerOpen(false);
        launchRoleplayTarget({ storyId, fromChats: true, navigate, reservation });
      } else {
        reservation?.cancelIfUnused();
      }
    } catch (reason) {
      reservation?.cancelIfUnused();
      if (mounted.current) setStartError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mounted.current) setStarting(undefined);
    }
  };

  const enterTavern = () => {
    if (roleplaySession.detached && roleplaySession.openChat) {
      focusDetachedTavernWindow();
      return;
    }
    if (filtered[0]) openChat(filtered[0].id);
    else newChat();
  };

  const handleChangeStoryPreset = async (storyId: string, presetId: string | null) => {
    try {
      await updateArchiveStory(storyId, (current) => {
        const otherAssets = (current.assets ?? []).filter((ref) => ref.kind !== 'preset');
        return {
          assets: presetId ? [...otherAssets, { kind: 'preset' as const, assetId: presetId }] : otherAssets,
        };
      });
      toast({ title: presetId ? '已切换本场对话的挂载预设' : '已恢复跟随角色或默认预设' });
    } catch (error) {
      toast({
        title: '切换预设失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const handleRenameStory = async (storyId: string, nextTitle: string) => {
    try {
      await renameArchiveStory(storyId, nextTitle);
      toast({ title: '对话已重命名', description: `「${nextTitle}」` });
    } catch (error) {
      toast({
        title: '重命名失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
      throw error;
    }
  };

  const handleConfirmDeleteStory = async (options: RemoveOptions) => {
    if (!deleteTarget) return false;
    const target = deleteTarget;
    if (roleplaySession.openChat?.id === target.id) {
      if (roleplaySession.generating) {
        toast({
          title: '无法删除正在生成的对话',
          description: '请先在酒馆窗口停止本轮生成或关闭该对话后再删除。',
          variant: 'destructive',
        });
        return false;
      }
      closeDetachedTavernWindow();
      setRoleplayOpenChat(null);
    }
    const ok = await executeDeleteAction(
      () => deleteArchiveStory(target.id, options),
      {
        onSuccess: () => toast({ title: `已删除对话「${target.title}」` }),
        onFailure: () => toast({ title: '删除对话失败', variant: 'destructive' }),
      },
    );
    if (ok && mounted.current) setDeleteTarget(null);
    return ok;
  };

  return (
    <AppLayout titleBarContent="聊天">
      <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-2xl font-semibold tracking-wide text-[color:var(--text-primary)]">聊天</h1>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="tap-target text-[color:var(--text-muted)] hover:text-brand"
                aria-label="续聊使用帮助"
                title="查看主模型、记忆管家与柏宝书指南"
                onClick={() => setGuideOpen(true)}
              >
                <CircleHelp className="h-4 w-4" />
              </Button>
              {!isMobile && (
                <button
                  type="button"
                  aria-pressed={windowMode === 'detached'}
                  onClick={toggleWindowMode}
                  className="tap-target hidden sm:inline-flex items-center gap-1 rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-0.5 text-[11px] text-[color:var(--text-muted)] hover:border-[color:var(--brand-hairline)] hover:text-foreground transition-colors"
                  title="切换桌面端点击对话时的打开方式（独立窗口方便左右分屏边看记录边聊）"
                >
                  <ExternalLink className="h-3 w-3 text-brand" />
                  <span>默认：{windowMode === 'detached' ? '独立窗口分屏' : '页内打开'}</span>
                </button>
              )}
            </div>
            <p className="mt-0.5 text-xs sm:text-sm text-[color:var(--text-muted)]">
              接着上次的楼层继续聊，或挑一张角色卡展开新故事。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || !!loadError || (hasFilters && !filtered.length && !roleplaySession.detached)}
              onClick={enterTavern}
            >
              <MessageCircle className="mr-1.5 h-4 w-4" />
              {roleplaySession.detached && roleplaySession.openChat ? '聚焦酒馆窗口' : '进入酒馆'}
            </Button>
            <Button variant="outline" size="sm" onClick={openModels}>
              <Settings2 className="mr-1.5 h-4 w-4" />模型设置
            </Button>
            <Button size="sm" onClick={newChat}>
              <Plus className="mr-1.5 h-4 w-4" />新建聊天
            </Button>
          </div>
        </header>

        <button
          type="button"
          onClick={() => navigate('/worlds')}
          className="group flex min-h-28 w-full items-center justify-between gap-4 rounded-xl border border-[color:var(--brand-hairline)] bg-gradient-to-r from-[var(--brand-active-bg-strong)] to-[var(--bg-elevated)] px-6 py-5 text-left text-[color:var(--text-primary)] transition-colors hover:border-brand"
        >
          <span>
            <span className="mb-1 block text-xs tracking-[0.2em] text-brand">原生世界 · 无需配置模型</span>
            <span className="block font-serif text-2xl">山海之间</span>
            <span className="mt-1 block text-sm text-[color:var(--text-muted)]">走进地图，追踪十二位行旅。下一场雨，会改变谁的路？</span>
          </span>
          <ArrowRight className="h-6 w-6 shrink-0 text-brand transition-transform group-hover:translate-x-1" />
        </button>

        <section aria-label="已有聊天" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-1 font-serif text-base font-semibold text-[color:var(--text-primary)] shrink-0">
              已有聊天
              {!loading && !loadError && (
                <span className="ml-1.5 font-sans text-xs font-normal text-[color:var(--text-muted)]">
                  {hasFilters ? `${filtered.length} / ${stories.length}` : `${stories.length} 篇`}
                </span>
              )}
            </h2>

            <div className="relative min-w-48 flex-1 sm:max-w-xs ml-auto">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                size="lg"
                aria-label="搜索聊天"
                placeholder="搜索对话标题或角色名"
                className="pl-8 pr-8"
                value={search}
                onChange={(event) => changeFilters({ search: event.target.value })}
                onKeyDown={(event) => {
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

            <select
              id="chat-organizing-tag"
              aria-label="标签筛选"
              value={selectedTag}
              disabled={loading || !!loadError}
              className="ste-select h-11 min-w-36 text-xs sm:text-sm"
              onChange={(event) => changeFilters({ tag: event.target.value })}
            >
              <option value="">全部标签</option>
              {tagOptions.map((tag) => (
                <option key={tag.raw} value={tag.raw}>{tag.label}</option>
              ))}
            </select>

            {hasFilters && (
              <Button variant="ghost" size="sm" className="h-9 px-2.5 text-xs" onClick={() => changeFilters(defaultFilters)}>
                清除筛选
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-9 px-2.5 text-xs text-muted-foreground" onClick={() => navigate('/library?manageTags=1')}>
              设置显示的标签
            </Button>
          </div>

          {selectedTag && <p className="text-xs text-[color:var(--text-muted)]">当前按角色标签筛选，列出所选角色名下的全部对话。</p>}

          {loading ? (
            <StoryListSkeleton count={5} />
          ) : loadError ? (
            <div role="alert" className="rounded-xl border border-[color:var(--border-normal)] bg-[var(--bg-elevated)] p-5">
              <p className="font-medium text-[color:var(--text-primary)]">聊天列表暂时没能读出来，库里的原记录未受影响。</p>
              <p className="mt-1 break-words text-sm text-[color:var(--text-muted)]">{loadError}</p>
              <Button variant="outline" className="mt-3" onClick={() => setRevision((value) => value + 1)}>重新读取</Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-[color:var(--border-normal)] bg-[var(--bg-elevated)] px-4 py-14 text-center">
              <MessageCircle className="mb-3 h-9 w-9 text-[color:var(--text-muted)]" />
              <h3 className="font-serif text-base font-medium text-[color:var(--text-primary)]">{hasFilters ? '没有找到匹配的聊天' : '还没有开启过对话'}</h3>
              <p className="mt-1 text-sm text-[color:var(--text-muted)]">{hasFilters ? '试试换个关键词、切换标签，或清除筛选条件。' : '挑一张收藏馆里的角色卡，就能直接进入酒馆展开初遇。'}</p>
              <Button className="mt-4" variant="outline" onClick={() => (hasFilters ? changeFilters(defaultFilters) : newChat())}>
                {hasFilters ? '显示全部聊天' : '选择角色开始'}
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-[color:var(--hairline-inner)] rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)]">
              {filtered.slice(0, visibleCount).map((story) => (
                <ChatHubStoryRow
                  key={story.id}
                  story={story}
                  charEntry={story.characterId ? characterMap.get(story.characterId) : undefined}
                  charName={characterName(story)}
                  presets={presets}
                  isLiveDetached={Boolean(roleplaySession.detached && roleplaySession.openChat?.id === story.id)}
                  isMobile={isMobile}
                  onOpenChat={(storyId) => openChat(storyId)}
                  onOpenDetached={(storyId) => openChat(storyId, 'detached')}
                  onOpenReader={openReader}
                  onChangeStoryPreset={handleChangeStoryPreset}
                  onRenameStory={handleRenameStory}
                  onRequestDelete={setDeleteTarget}
                />
              ))}
            </div>
          )}

          {!loading && !loadError && filtered.length > visibleCount && (
            <Button variant="ghost" onClick={() => setVisibleCount((count) => count + 60)}>显示更多聊天</Button>
          )}
        </section>
      </div>

      <NewChatPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        loading={loading}
        loadError={loadError}
        characters={characters}
        filteredCharacters={filteredCharacters}
        characterSearch={characterSearch}
        onCharacterSearchChange={(value) => {
          setCharacterSearch(value);
          setCharacterCount(60);
        }}
        characterCount={characterCount}
        onShowMoreCharacters={() => setCharacterCount((count) => count + 60)}
        starting={starting}
        startError={startError}
        onCreateChat={(characterId) => { void createChat(characterId); }}
        onPickGreetings={(characterId) => {
          setPickerOpen(false);
          navigate(`/character/${characterId}?tab=greetings`);
        }}
        onGoToLibrary={() => navigate('/library')}
      />

      <DeleteConfirmDialog
        open={!!deleteTarget}
        title={`删除对话「${deleteTarget?.title ?? ''}」？`}
        description="删除后这篇对话及其名下支线记录将无法恢复；角色卡本身不会受影响。"
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        fileTarget={deleteTarget ? { store: 'archiveStories', id: deleteTarget.id } : undefined}
        onConfirm={handleConfirmDeleteStory}
      />

      <RoleplayGuide open={guideOpen} onOpenChange={setGuideOpen} inChat={false} onModels={openModels} onRuntime={newChat} />
    </AppLayout>
  );
}
