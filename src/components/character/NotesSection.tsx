import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
/** Character-detail note mutations; presentation is shared with library review. */
import { useRef, useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import type { CharacterNote } from '@/types/archive';
import { NotesBrowser } from './NotesBrowser';
import { NoteEditorDialog } from './NoteEditorDialog';

interface NotesSectionProps {
  characterId?: string;
  notes: CharacterNote[];
  onChange: (notes: CharacterNote[]) => Promise<void>;
}

export function NotesSection({ characterId, notes, onChange }: NotesSectionProps) {
  useI18n();
  const [editor, setEditor] = useState<{ id?: string; body: string } | null>(null);
  const [toDelete, setToDelete] = useState<CharacterNote | null>(null);
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const openEditor = (value: { id?: string; body: string }) => { setError(null); setEditor(value); };
  const handleSave = async () => {
    if (!editor || !editor.body.trim() || saving.current) return;
    const body = editor.body.trim(), id = editor.id ?? crypto.randomUUID();
    saving.current = true; setBusy(true); setError(null);
    try {
      await onChange(editor.id ? notes.map(note => note.id === editor.id ? { ...note, body } : note) : [...notes, { id, body, at: Date.now() }]);
      setFocusNoteId(id); setEditor(null);
    } catch (e) { setError(e instanceof Error ? e.message : tr("保存失败，请重试")); }
    finally { saving.current = false; setBusy(false); }
  };
  const handleDelete = async () => {
    if (!toDelete || saving.current) return;
    saving.current = true; setBusy(true); setError(null);
    try {
      await onChange(notes.filter(note => note.id !== toDelete.id));
      setToDelete(null); setFocusNoteId(null);
    } catch (e) { setError(e instanceof Error ? e.message : tr("删除失败，请重试")); }
    finally { saving.current = false; setBusy(false); }
  };
  return <>
    <NotesBrowser characterId={characterId} notes={notes} focusNoteId={focusNoteId} onCreate={() => openEditor({ body: '' })}
      onEdit={note => openEditor({ id: note.id, body: note.body })} onDelete={note => { setError(null); setToDelete(note); }} />
    <NoteEditorDialog open={!!editor} editing={!!editor?.id} body={editor?.body ?? ''} busy={busy} error={error}
      onBodyChange={body => setEditor(current => current ? { ...current, body } : current)} onClose={() => setEditor(null)} onSave={() => void handleSave()} />
    <AlertDialog open={!!toDelete} onOpenChange={value => { if (!value && !busy) setToDelete(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{tr("删除这条备注？")}</AlertDialogTitle>
        <AlertDialogDescription className="line-clamp-3 whitespace-pre-wrap" title={toDelete?.body}>{toDelete?.body}</AlertDialogDescription>
      </AlertDialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>{tr("取消")}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={event => { event.preventDefault(); void handleDelete(); }}>{busy ? tr("删除中…") : tr("删除")}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
