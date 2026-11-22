import { ArrowRight, Loader2, Sparkles, X } from 'lucide-react';
import { CharacterPortrait } from '@/components/library/CharacterPortrait';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { CharacterIndexEntry } from '@/lib/archive-index';
import { displayCharacterName } from '@/lib/library-query';
import { LOADING_LABEL } from '@/lib/ui-copy';

export interface NewChatPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  loadError?: string;
  characters: CharacterIndexEntry[];
  filteredCharacters: CharacterIndexEntry[];
  characterSearch: string;
  onCharacterSearchChange: (value: string) => void;
  characterCount: number;
  onShowMoreCharacters: () => void;
  starting?: string;
  startError?: string;
  onCreateChat: (characterId: string) => void;
  onPickGreetings: (characterId: string) => void;
  onGoToLibrary: () => void;
}

export function NewChatPickerDialog({
  open,
  onOpenChange,
  loading,
  loadError,
  characters,
  filteredCharacters,
  characterSearch,
  onCharacterSearchChange,
  characterCount,
  onShowMoreCharacters,
  starting,
  startError,
  onCreateChat,
  onPickGreetings,
  onGoToLibrary,
}: NewChatPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!starting) onOpenChange(next); }}>
      <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif">选择角色，展开新对话</DialogTitle>
          <DialogDescription>点角色立绘直接以默认开场白进入酒馆；想挑备选开场白可点右侧「选开场」。</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Input
            aria-label="搜索角色"
            placeholder="搜索角色名或副标题…"
            className="pr-8"
            value={characterSearch}
            onChange={(event) => onCharacterSearchChange(event.target.value)}
          />
          {characterSearch && (
            <button
              type="button"
              aria-label="清空角色搜索"
              onClick={() => onCharacterSearchChange('')}
              className="tap-target absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {startError && <p role="alert" className="break-words text-sm text-destructive">{startError}</p>}
        {loading ? (
          <p role="status" className="py-6 text-center text-sm text-muted-foreground">{LOADING_LABEL}</p>
        ) : loadError ? (
          <p role="alert" className="text-sm text-destructive">角色列表暂时没能读出来，请关闭窗口后点击「重新读取」再试。</p>
        ) : characters.length === 0 ? (
          <div className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">收藏馆里还没有角色卡，先去导入一张心仪的角色卡吧。</p>
            <Button onClick={onGoToLibrary}>前往角色库导入</Button>
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {filteredCharacters.slice(0, characterCount).map((character) => {
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
                    onClick={() => onCreateChat(character.id)}
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
                    onClick={() => onPickGreetings(character.id)}
                    className="tap-target flex shrink-0 flex-col items-center justify-center gap-0.5 border-l border-[color:var(--hairline-inner)] px-2.5 text-[11px] text-[color:var(--text-muted)] hover:bg-[var(--brand-active-bg)] hover:text-brand"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>选开场</span>
                  </button>
                </div>
              );
            })}
            {filteredCharacters.length === 0 && <p className="sm:col-span-2 py-6 text-center text-sm text-muted-foreground">没有找到匹配的角色。</p>}
            {filteredCharacters.length > characterCount && (
              <Button variant="ghost" className="sm:col-span-2" onClick={onShowMoreCharacters}>显示更多角色</Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
