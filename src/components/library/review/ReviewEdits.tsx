import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ArchiveCharacter } from '@/types/archive';
import { updateCharacter } from '@/lib/archive-db';
import { commitCharacterPatch, type CharacterPatch } from '@/lib/character-write';
import { applyCharacterTagPatch } from '@/lib/character-tag-domain';
import { getVaultEpoch } from '@/lib/vault/active';
import { displayCharacterName } from '@/lib/library-query';
import { NotesBrowser } from '@/components/character/NotesBrowser';
import { NoteEditorDialog } from '@/components/character/NoteEditorDialog';

type Draft = { characterId: string; name: string; epoch: number } & ({ kind: 'note'; noteId?: string; body: string } | { kind: 'metadata'; rating: string; tags: string });
export function ReviewEdits({ character, notesVisible, onCharacterChange }: { character: ArchiveCharacter; notesVisible: boolean; onCharacterChange: (character: ArchiveCharacter) => void }) {
  useI18n();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusNote, setFocusNote] = useState<{ characterId: string; id: string } | null>(null);
  const saving = useRef(false);
  const identity = () => ({ characterId: character.id, name: displayCharacterName(character), epoch: getVaultEpoch() });
  const openNote = (noteId?: string, body = '') => { setError(null); setDraft({ ...identity(), kind: 'note', noteId, body }); };
  const save = async () => {
    if (!draft || saving.current) return;
    const opened = draft;
    if (opened.epoch !== getVaultEpoch()) { setError(tr("文件库已切换，请重新打开编辑")); return; }
    saving.current = true; setBusy(true); setError(null);
    try {
      let patch: CharacterPatch;
      let savedNoteId: string | undefined;
      if (opened.kind === 'note') {
        const body = opened.body.trim(); if (!body) throw new Error(tr("请填写备注"));
        const id = opened.noteId ?? crypto.randomUUID(); const at = Date.now();
        savedNoteId = id;
        patch = current => ({ updatedAt: Date.now(), notes: opened.noteId
          ? (current.notes ?? []).map(note => note.id === id ? { ...note, body } : note)
          : [...(current.notes ?? []), { id, body, at }] });
      } else {
        const rating = opened.rating.trim() === '' ? undefined : Number(opened.rating);
        if (rating !== undefined && (!Number.isFinite(rating) || rating < 0 || rating > 10 || rating % 0.5 !== 0)) throw new Error(tr("评分请使用 0 到 10 之间的 0.5 分档位"));
        const tags = [...new Set(opened.tags.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean))];
        patch = current => ({ ...applyCharacterTagPatch(current, { rating, tags }), updatedAt: Date.now() });
      }
      await commitCharacterPatch(opened.characterId, patch, updateCharacter, saved => {
        if (opened.epoch === getVaultEpoch()) onCharacterChange(saved);
      });
      if (opened.epoch === getVaultEpoch()) {
        if (savedNoteId) setFocusNote({ characterId: opened.characterId, id: savedNoteId });
        setDraft(null);
      }
    } catch (e) { if (opened.epoch === getVaultEpoch()) setError(e instanceof Error ? e.message : tr("保存失败，请重试")); }
    finally { saving.current = false; setBusy(false); }
  };
  return <>
    {!notesVisible ? <Button size="sm" variant="outline" onClick={() => { setError(null); setDraft({ ...identity(), kind: 'metadata', rating: character.rating?.toString() ?? '', tags: character.tags.join(', ') }); }}>{tr("编辑评分和标签")}</Button> : <NotesBrowser
      characterId={character.id} notes={character.notes ?? []} onCreate={() => openNote()} onEdit={note => openNote(note.id, note.body)} focusNoteId={focusNote?.characterId === character.id ? focusNote.id : undefined} />}
    <NoteEditorDialog open={draft?.kind === 'note'} editing={draft?.kind === 'note' && !!draft.noteId} body={draft?.kind === 'note' ? draft.body : ''} busy={busy} error={error} description={draft?.name}
      onBodyChange={body => setDraft(current => current?.kind === 'note' ? { ...current, body } : current)} onClose={() => setDraft(null)} onSave={() => void save()} />
    <Dialog open={draft?.kind === 'metadata'} onOpenChange={open => { if (!open && !busy) setDraft(null); }}>
      <DialogContent><DialogHeader><DialogTitle>{tr("编辑评分和标签")}</DialogTitle><DialogDescription>{draft?.name}</DialogDescription></DialogHeader>
        {draft?.kind === 'metadata' && <div className="space-y-3">
          <label className="block space-y-1 text-sm"><span>{tr("评分（0–10，留空清除）")}</span><Input aria-label={tr("评分")} type="number" min="0" max="10" step="0.5" value={draft.rating} disabled={busy} onChange={e => setDraft({ ...draft, rating: e.target.value })} /></label>
          <label className="block space-y-1 text-sm"><span>{tr("标签（逗号或换行分隔）")}</span><Textarea aria-label={tr("标签")} value={draft.tags} disabled={busy} onChange={e => setDraft({ ...draft, tags: e.target.value })} /></label>
        </div>}
        {error && <p role="alert" className="text-sm text-[color:var(--status-danger)]">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDraft(null)}>{tr("取消")}</Button><Button disabled={busy} onClick={() => void save()}>{busy ? tr("保存中…") : tr("保存评分和标签")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
