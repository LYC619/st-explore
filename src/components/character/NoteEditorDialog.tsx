import { useEffect, useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { renderNoteMarkdown } from '@/lib/note-markdown';

export function NoteEditorDialog({ open, editing, body, busy = false, error, description, onBodyChange, onClose, onSave }: {
  open: boolean; editing: boolean; body: string; busy?: boolean; error?: string | null; description?: string;
  onBodyChange: (body: string) => void; onClose: () => void; onSave: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const prefix = useId();
  const document = useMemo(() => renderNoteMarkdown(body, `${prefix}-preview`), [body, prefix]);
  useEffect(() => { if (open) setPreview(false); }, [open]);
  return <Dialog open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}>
    <DialogContent className="flex h-[85dvh] max-h-[900px] w-[calc(100vw-2rem)] max-w-4xl flex-col overflow-hidden">
      <DialogHeader><DialogTitle>{editing ? '编辑备注' : '新建备注'}</DialogTitle>
        <DialogDescription>{description && <>{description} · </>}支持 Markdown。用 #、## 标题可生成目录，方便回到长备注中的片段。</DialogDescription>
      </DialogHeader>
      <div className="flex gap-2"><Button variant={!preview ? 'default' : 'outline'} size="sm" onClick={() => setPreview(false)}>编辑</Button><Button variant={preview ? 'default' : 'outline'} size="sm" onClick={() => setPreview(true)}>预览</Button></div>
      {preview ? <div className="chat-markdown min-h-0 flex-1 overflow-y-auto break-words rounded-md border p-4 text-sm" dangerouslySetInnerHTML={{ __html: document.html }} /> : <Textarea
        value={body} onChange={event => onBodyChange(event.target.value)} disabled={busy}
        placeholder="写点玩卡心得…支持 Markdown" aria-label="备注正文" className="min-h-0 flex-1 resize-none text-sm leading-relaxed" rows={14} autoFocus
      />}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button onClick={onSave} disabled={busy || !body.trim()}>{busy ? '保存中…' : '保存'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
