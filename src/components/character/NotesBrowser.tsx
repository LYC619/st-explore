import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useMemo, useEffect, useId, useLayoutEffect, useRef, useState  } from 'react';
import { PenLine, Plus, StickyNote, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { CharacterNote } from '@/types/archive';
import { renderNoteMarkdown } from '@/lib/note-markdown';
import { formatFullTime, formatListTime } from '@/lib/time-display';
import { scopedGet, scopedKey, scopedSet } from '@/lib/vault/vault-scope';

interface NotesBrowserProps {
  characterId?: string;
  notes: CharacterNote[];
  onCreate: () => void;
  onEdit: (note: CharacterNote) => void;
  onDelete?: (note: CharacterNote) => void;
  focusNoteId?: string | null;
}

/** Both character detail and library review use the same note reader and navigation. */
export function NotesBrowser(props: NotesBrowserProps) {
  return <NotesBrowserContent key={scopedKey(`notes:${props.characterId ?? ''}`)} {...props} />;
}

function NotesBrowserContent({ characterId, notes, onCreate, onEdit, onDelete, focusNoteId }: NotesBrowserProps) {
  useI18n();
  const selectionKey = characterId ? `ste-character-note:${characterId}` : undefined;
  const [selectedId, setSelectedId] = useState<string | null>(() => selectionKey ? scopedGet(selectionKey) : null);
  const [selectedHeading, setSelectedHeading] = useState<string | null>(null);
  const lastFocusRequest = useRef(focusNoteId);
  const pendingJump = useRef(false);
  const prefix = useId();
  const sorted = useMemo(() => [...notes].sort((a, b) => b.at - a.at).map(note => ({
    ...note, anchor: `${prefix}-${encodeURIComponent(note.id)}`, document: renderNoteMarkdown(note.body, `${prefix}-${encodeURIComponent(note.id)}`),
  })), [notes, prefix]);
  const activeNote = sorted.find(note => note.id === selectedId) ?? sorted[0];
  const activeId = activeNote?.id;
  const activeAnchor = activeNote?.anchor;

  useEffect(() => {
    if (selectionKey && activeId) scopedSet(selectionKey, activeId);
  }, [selectionKey, activeId]);
  useEffect(() => { setSelectedHeading(null); }, [activeId]);
  useLayoutEffect(() => {
    if (focusNoteId && focusNoteId !== lastFocusRequest.current) { pendingJump.current = true; setSelectedId(focusNoteId); }
    lastFocusRequest.current = focusNoteId;
  }, [focusNoteId]);
  useLayoutEffect(() => {
    if (!pendingJump.current || !activeAnchor) return;
    pendingJump.current = false;
    const target = document.getElementById(activeAnchor);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'start' });
  }, [activeAnchor, selectedId]);
  const jump = (id: string) => {
    setSelectedHeading(id);
    const target = document.getElementById(id);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return <div className="min-w-0 space-y-3" data-notes-browser>
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{tr("角色级速记（玩卡心得），不写入角色卡文件")}</span>
      <Button variant="outline" size="sm" className="shrink-0" onClick={onCreate}><Plus className="mr-1 h-3.5 w-3.5" />{tr("新建备注")}</Button>
    </div>
    {!sorted.length ? <Card><CardContent className="flex flex-col items-center gap-2 py-10 text-center">
      <StickyNote className="h-8 w-8 text-muted-foreground/40" /><p className="text-sm text-muted-foreground">{tr("还没有备注")}</p>
    </CardContent></Card> : (sorted.length === 1 && !activeNote?.document.headings.length) ? (
      activeNote && (
        <Card key={activeNote.id} id={activeNote.anchor} tabIndex={-1} className="group scroll-mt-4">
          <CardContent className="px-4 py-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground" title={formatFullTime(activeNote.at)}>{formatFullTime(activeNote.at)} · {formatListTime(activeNote.at)}</span>
              <div className="hover-reveal ml-auto flex shrink-0 gap-1">
                <Button variant="ghost" size="icon" aria-label={tr("编辑备注")} onClick={() => onEdit(activeNote)}><PenLine className="h-3.5 w-3.5" /></Button>
                {onDelete && <Button variant="ghost" size="icon" aria-label={tr("删除备注")} className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(activeNote)}><Trash2 className="h-3.5 w-3.5" /></Button>}
              </div>
            </div>
            <div className="chat-markdown break-words text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: activeNote.document.html }} />
          </CardContent>
        </Card>
      )
    ) : <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1fr)_12rem] xl:grid-cols-[minmax(0,1fr)_14rem]">
      {activeNote && <div className="min-w-0">
        <Card key={activeNote.id} id={activeNote.anchor} tabIndex={-1} className="group scroll-mt-4">
          <CardContent className="px-4 py-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground" title={formatFullTime(activeNote.at)}>{formatFullTime(activeNote.at)} · {formatListTime(activeNote.at)}</span>
              <div className="hover-reveal ml-auto flex shrink-0 gap-1">
                <Button variant="ghost" size="icon" aria-label={tr("编辑备注")} onClick={() => onEdit(activeNote)}><PenLine className="h-3.5 w-3.5" /></Button>
                {onDelete && <Button variant="ghost" size="icon" aria-label={tr("删除备注")} className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(activeNote)}><Trash2 className="h-3.5 w-3.5" /></Button>}
              </div>
            </div>
            <div className="chat-markdown break-words text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: activeNote.document.html }} />
          </CardContent>
        </Card>
      </div>}
      <aside aria-label={tr("备注导航")} className="order-first min-w-0 rounded-lg border bg-background md:sticky md:top-3 md:order-last">
        <nav aria-label={tr("切换备注")} className="border-b p-3">
          <p className="mb-2 text-sm font-medium">{tr("备注 · ")}{sorted.length}{tr(" 条")}</p>
          <div className="max-h-32 space-y-1 overflow-y-auto md:max-h-[24vh]">
            {sorted.map(note => <button key={note.id} type="button" aria-current={note.id === activeId ? 'true' : undefined}
              className={`tap-target min-h-8 w-full rounded px-2 py-1.5 text-left text-sm ${note.id === activeId ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-accent'}`}
              onClick={() => {
                if (note.id === activeId) { jump(note.anchor); return; }
                pendingJump.current = true; setSelectedHeading(null); setSelectedId(note.id);
              }}>
              <span className="block truncate" title={note.document.title}>{note.document.title}</span>
              <span className="block text-xs text-muted-foreground">{formatListTime(note.at)}</span>
            </button>)}
          </div>
        </nav>
        <nav aria-label={tr("备注目录")} className="p-3">
          <p className="mb-2 text-sm font-medium">{tr("当前备注目录")}</p>
          <div className="max-h-40 overflow-y-auto md:max-h-[36vh]">
            <button type="button" className="tap-target min-h-8 w-full rounded px-2 text-left text-xs text-muted-foreground hover:bg-accent" onClick={() => activeNote && jump(activeNote.anchor)}>{tr("回到开头")}</button>
            {activeNote?.document.headings.map(heading => <button key={heading.id} type="button" title={heading.title}
              aria-current={selectedHeading === heading.id ? 'location' : undefined}
              className={`tap-target block min-h-8 w-full truncate rounded py-1 pr-2 text-left text-xs ${selectedHeading === heading.id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent'}`}
              style={{ paddingLeft: `${Math.min(heading.level, 4) * 0.5 + 0.5}rem` }} onClick={() => jump(heading.id)}>{heading.title}</button>)}
            {!activeNote?.document.headings.length && <p className="px-2 py-2 text-xs text-muted-foreground">{tr("这条备注没有小标题；编辑时用 # 或 ## 添加。")}</p>}
          </div>
        </nav>
      </aside>
    </div>}
  </div>;
}
