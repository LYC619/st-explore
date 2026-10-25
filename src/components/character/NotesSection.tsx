/**
 * 角色页 · 备注 tab：正文与右侧导航，上方切换备注，下方定位当前备注标题。
 * CRUD 全在本组件；变更通过 onChange 回写角色档案（notes 字段）。
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StickyNote, Plus, PenLine, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { CharacterNote } from '@/types/archive';
import { formatListTime, formatFullTime } from '@/lib/time-display';
import { renderNoteMarkdown } from '@/lib/note-markdown';
import { scopedGet, scopedSet } from '@/lib/vault/vault-scope';

interface NotesSectionProps {
  characterId?: string;
  notes: CharacterNote[];
  onChange: (notes: CharacterNote[]) => Promise<void>;
}

export function NotesSection({ characterId, notes, onChange }: NotesSectionProps) {
  /** 编辑器：null=关闭；id 空=新建 */
  const [editor, setEditor] = useState<{ id?: string; body: string } | null>(null);
  const [toDelete, setToDelete] = useState<CharacterNote | null>(null);
  const [preview, setPreview] = useState(false);
  const selectionKey = characterId ? `ste-character-note:${characterId}` : undefined;
  const [selectedId, setSelectedId] = useState<string | null>(() => selectionKey ? scopedGet(selectionKey) : null);
  const [selectedHeading, setSelectedHeading] = useState<string | null>(null);
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

  useLayoutEffect(() => {
    if (!pendingJump.current || !activeAnchor) return;
    pendingJump.current = false;
    const target = document.getElementById(activeAnchor);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'start' });
  }, [activeAnchor, selectedId]);
  const previewDocument = useMemo(() => renderNoteMarkdown(editor?.body ?? '', `${prefix}-preview`), [editor?.body, prefix]);
  const openEditor = (value: { id?: string; body: string }) => { setPreview(false); setEditor(value); };
  const jump = (id: string) => {
    setSelectedHeading(id);
    const target = document.getElementById(id);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSave = async () => {
    if (!editor || !editor.body.trim()) return;
    const body = editor.body.trim();
    const id = editor.id ?? crypto.randomUUID();
    try {
      await onChange(
        editor.id
          ? notes.map((n) => (n.id === editor.id ? { ...n, body } : n))
          : [...notes, { id, body, at: Date.now() }],
      );
      pendingJump.current = id !== activeId;
      setSelectedId(id);
      setSelectedHeading(null);
      setEditor(null);
    } catch {
      // 父层已提示失败；保留编辑器和输入内容。
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">角色级速记（玩卡心得），不写入角色卡文件</span>
        <Button variant="outline" size="sm" onClick={() => openEditor({ body: '' })}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          新建备注
        </Button>
      </div>

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-2 text-center">
            <StickyNote className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">还没有备注</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1fr)_14rem]">
        {activeNote && <div className="min-w-0">
          <Card key={activeNote.id} id={activeNote.anchor} tabIndex={-1} className="group scroll-mt-4">
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs text-muted-foreground" title={formatFullTime(activeNote.at)}>
                  {formatFullTime(activeNote.at)} · {formatListTime(activeNote.at)}
                </span>
                <div className="hover-reveal ml-auto flex gap-1">
                  <Button
                    variant="ghost" size="icon" aria-label="编辑备注"
                    onClick={() => openEditor({ id: activeNote.id, body: activeNote.body })}
                  >
                    <PenLine className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" aria-label="删除备注"
                    onClick={() => setToDelete(activeNote)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <div className="chat-markdown break-words text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: activeNote.document.html }} />
            </CardContent>
          </Card>
        </div>}
        <aside aria-label="备注导航" className="order-first min-w-0 rounded-lg border bg-background md:sticky md:top-3 md:order-last">
          <nav aria-label="切换备注" className="border-b p-3">
            <p className="mb-2 text-sm font-medium">备注 · {sorted.length} 条</p>
            <div className="max-h-32 space-y-1 overflow-y-auto md:max-h-[24vh]">
              {sorted.map(note => <button key={note.id} type="button"
                aria-current={note.id === activeId ? 'true' : undefined}
                className={`tap-target min-h-8 w-full rounded px-2 py-1.5 text-left text-sm ${note.id === activeId ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                onClick={() => {
                  if (note.id === activeId) { jump(note.anchor); return; }
                  pendingJump.current = true;
                  setSelectedHeading(null);
                  setSelectedId(note.id);
                }}>
                <span className="block truncate" title={note.document.title}>{note.document.title}</span>
                <span className="block text-xs text-muted-foreground">{formatListTime(note.at)}</span>
              </button>)}
            </div>
          </nav>
          <nav aria-label="备注目录" className="p-3">
            <p className="mb-2 text-sm font-medium">当前备注目录</p>
            <div className="max-h-40 overflow-y-auto md:max-h-[36vh]">
              <button type="button" className="tap-target min-h-8 w-full rounded px-2 text-left text-xs text-muted-foreground hover:bg-accent"
                onClick={() => activeNote && jump(activeNote.anchor)}>回到开头</button>
              {activeNote?.document.headings.map(heading => <button key={heading.id} type="button"
                title={heading.title}
                aria-current={selectedHeading === heading.id ? 'location' : undefined}
                className={`tap-target block min-h-8 w-full truncate rounded py-1 pr-2 text-left text-xs ${selectedHeading === heading.id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                style={{ paddingLeft: `${Math.min(heading.level, 4) * 0.5 + 0.5}rem` }} onClick={() => jump(heading.id)}>{heading.title}</button>)}
              {!activeNote?.document.headings.length && <p className="px-2 py-2 text-xs text-muted-foreground">这条备注没有小标题；编辑时用 # 或 ## 添加。</p>}
            </div>
          </nav>
        </aside>
        </div>
      )}

      <Dialog open={!!editor} onOpenChange={(v) => !v && setEditor(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-4xl h-[85dvh] max-h-[900px] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{editor?.id ? '编辑备注' : '新建备注'}</DialogTitle>
            <DialogDescription>支持 Markdown。用 #、## 标题可生成目录，方便回到长备注中的片段。</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2"><Button variant={!preview ? 'default' : 'outline'} size="sm" onClick={() => setPreview(false)}>编辑</Button>
            <Button variant={preview ? 'default' : 'outline'} size="sm" onClick={() => setPreview(true)}>预览</Button></div>
          {preview ? <div className="chat-markdown min-h-0 flex-1 overflow-y-auto break-words rounded-md border p-4 text-sm" dangerouslySetInnerHTML={{ __html: previewDocument.html }} /> : <Textarea
            value={editor?.body ?? ''}
            onChange={(e) => setEditor((cur) => (cur ? { ...cur, body: e.target.value } : cur))}
            placeholder="写点玩卡心得…支持 Markdown"
            aria-label="备注正文"
            className="min-h-0 flex-1 resize-none text-sm leading-relaxed"
            rows={14}
            autoFocus
          />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>取消</Button>
            <Button onClick={() => void handleSave()} disabled={!editor?.body.trim()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(v) => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条备注？</AlertDialogTitle>
            <AlertDialogDescription className="line-clamp-3 whitespace-pre-wrap" title={toDelete?.body}>
              {toDelete?.body}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!toDelete) return;
                void onChange(notes.filter((n) => n.id !== toDelete.id))
                  .then(() => {
                    setToDelete(null);
                    setSelectedHeading(null);
                    if (toDelete.id === activeId) {
                      pendingJump.current = true;
                      setSelectedId(sorted.find(note => note.id !== toDelete.id)?.id ?? null);
                    }
                  })
                  .catch(() => {});
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
