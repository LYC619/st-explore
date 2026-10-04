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
import { formatFullTime } from '@/lib/time-display';
import { displayCharacterName } from '@/lib/library-query';

type Draft = { characterId: string; name: string; epoch: number } & ({ kind: 'note'; noteId?: string; body: string } | { kind: 'metadata'; rating: string; tags: string });
export function ReviewEdits({ character, notesVisible, onCharacterChange }: { character: ArchiveCharacter; notesVisible: boolean; onCharacterChange: (character: ArchiveCharacter) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const identity = () => ({ characterId: character.id, name: displayCharacterName(character), epoch: getVaultEpoch() });
  const openNote = (noteId?: string, body = '') => { setError(null); setDraft({ ...identity(), kind: 'note', noteId, body }); };
  const save = async () => {
    if (!draft || saving.current) return;
    const opened = draft;
    if (opened.epoch !== getVaultEpoch()) { setError('文件库已切换，请重新打开编辑'); return; }
    saving.current = true; setBusy(true); setError(null);
    try {
      let patch: CharacterPatch;
      if (opened.kind === 'note') {
        const body = opened.body.trim(); if (!body) throw new Error('请填写备注');
        const id = opened.noteId ?? crypto.randomUUID(); const at = Date.now();
        patch = current => ({ updatedAt: Date.now(), notes: opened.noteId
          ? (current.notes ?? []).map(note => note.id === id ? { ...note, body } : note)
          : [...(current.notes ?? []), { id, body, at }] });
      } else {
        const rating = opened.rating.trim() === '' ? undefined : Number(opened.rating);
        if (rating !== undefined && (!Number.isFinite(rating) || rating < 0 || rating > 10 || rating % 0.5 !== 0)) throw new Error('评分请使用 0 到 10 之间的 0.5 分档位');
        const tags = [...new Set(opened.tags.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean))];
        patch = current => ({ ...applyCharacterTagPatch(current, { rating, tags }), updatedAt: Date.now() });
      }
      await commitCharacterPatch(opened.characterId, patch, updateCharacter, saved => {
        if (opened.epoch === getVaultEpoch()) onCharacterChange(saved);
      });
      if (opened.epoch === getVaultEpoch()) setDraft(null);
    } catch (e) { if (opened.epoch === getVaultEpoch()) setError(e instanceof Error ? e.message : '保存失败，请重试'); }
    finally { saving.current = false; setBusy(false); }
  };
  return <>
    {!notesVisible ? <Button size="sm" variant="outline" onClick={() => { setError(null); setDraft({ ...identity(), kind: 'metadata', rating: character.rating?.toString() ?? '', tags: character.tags.join(', ') }); }}>编辑评分和标签</Button> : <div className="space-y-4">
      <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">玩卡心得与速记</p><Button size="sm" variant="outline" onClick={() => openNote()}>新建备注</Button></div>
      {!(character.notes?.length) && <p className="py-10 text-center text-sm text-muted-foreground">还没有备注</p>}
      {[...(character.notes ?? [])].sort((a, b) => b.at - a.at).map(note => <article key={note.id} className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2"><time className="text-xs text-muted-foreground">{formatFullTime(note.at)}</time><Button variant="ghost" size="sm" onClick={() => openNote(note.id, note.body)}>编辑备注</Button></div>
        <p className="whitespace-pre-wrap text-sm leading-7">{note.body}</p>
      </article>)}
    </div>}
    <Dialog open={!!draft} onOpenChange={open => { if (!open && !busy) setDraft(null); }}>
      <DialogContent><DialogHeader><DialogTitle>{draft?.kind === 'note' ? '编辑备注' : '编辑评分和标签'}</DialogTitle><DialogDescription>{draft?.name}</DialogDescription></DialogHeader>
        {draft?.kind === 'note' ? <Textarea aria-label="备注内容" value={draft.body} disabled={busy} onChange={e => setDraft({ ...draft, body: e.target.value })} rows={6} /> : draft?.kind === 'metadata' && <div className="space-y-3">
          <label className="block space-y-1 text-sm"><span>评分（0–10，留空清除）</span><Input aria-label="评分" type="number" min="0" max="10" step="0.5" value={draft.rating} disabled={busy} onChange={e => setDraft({ ...draft, rating: e.target.value })} /></label>
          <label className="block space-y-1 text-sm"><span>标签（逗号或换行分隔）</span><Textarea aria-label="标签" value={draft.tags} disabled={busy} onChange={e => setDraft({ ...draft, tags: e.target.value })} /></label>
        </div>}
        {error && <p role="alert" className="text-sm text-[color:var(--status-danger)]">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDraft(null)}>取消</Button><Button disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : draft?.kind === 'note' ? '保存备注' : '保存评分和标签'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
