import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getCharacter } from '@/lib/archive-db';
import { getAllWorldBooks } from '@/lib/worldbook-db';
import { getVaultEpoch } from '@/lib/vault/active';
import { recordEntryTitle, saveRecordsToWorldbook, type DuplicateRecordMode } from '@/lib/record-to-worldbook';
import type { WorldBookItem } from '@/types/worldbook';
import type { SummaryItem } from '@/types/summary';

export function RecordsToWorldbookDialog({ characterId, records, onClose, onSaved }: {
  characterId: string; records: SummaryItem[]; onClose: () => void; onSaved: (id: string) => void;
}) {
  const epoch = useRef(getVaultEpoch()), pending = useRef(false), operationId = useRef(crypto.randomUUID()), newId = useRef(crypto.randomUUID());
  const [books, setBooks] = useState<WorldBookItem[]>([]), [target, setTarget] = useState('new'), [title, setTitle] = useState('归档成果');
  const [mode, setMode] = useState<DuplicateRecordMode>('skip'), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void Promise.all([getCharacter(characterId), getAllWorldBooks()]).then(([character, books]) => {
      if (!active || epoch.current !== getVaultEpoch()) return;
      if (!character) throw new Error('角色不存在');
      const own = books.filter(book => character.assets?.some(ref => ref.kind === 'worldbook' && ref.assetId === book.id));
      setBooks(own); setTarget(own[0]?.id ?? 'new'); setTitle(`${character.name}_归档成果`);
    }).catch(error => { if (active) setError(String(error)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [characterId]);
  const book = books.find(book => book.id === target);
  const existing = new Set(Object.values(book?.worldbook.entries ?? {}).map(entry => (entry.steRecordSource as { id?: string } | undefined)?.id));
  const save = async () => {
    if (pending.current || loading) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (epoch.current !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开');
      const saved = await saveRecordsToWorldbook({ characterId, records, targetId: target === 'new' ? undefined : target,
        newBookId: newId.current, newTitle: title, duplicateMode: mode, operationId: operationId.current });
      onSaved(saved.targetId); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto">
    <DialogHeader><DialogTitle>加入世界书</DialogTitle><DialogDescription>预览所选 {records.length} 篇记录，每篇一个条目。新增条目默认禁用，保存后可在世界书中逐项启用。</DialogDescription></DialogHeader>
    <select aria-label="目标世界书" className="w-full rounded-md border bg-background p-2" value={target} disabled={loading || busy} onChange={event => setTarget(event.target.value)}>
      {books.map(book => <option key={book.id} value={book.id}>{book.title}</option>)}<option value="new">新建角色专用世界书</option>
    </select>
    {target === 'new' && <Input aria-label="新世界书标题" value={title} disabled={busy} onChange={event => setTitle(event.target.value)} />}
    <label className="space-y-1 text-sm">已存在记录<select aria-label="重复记录处理" className="w-full rounded-md border bg-background p-2" value={mode} disabled={busy} onChange={event => setMode(event.target.value as DuplicateRecordMode)}>
      <option value="skip">跳过已存在</option><option value="update">更新对应条目（保留启用状态）</option><option value="copy">另存新条目</option>
    </select></label>
    <ul className="max-h-60 overflow-auto space-y-2 text-sm">{records.map(record => <li key={record.id} className="rounded border border-border p-2">
      <p className="font-medium">{recordEntryTitle(record)} {existing.has(record.id) ? '（已存在）' : '（新增，禁用）'}</p><p className="line-clamp-3 whitespace-pre-wrap mt-1">{record.content}</p>
    </li>)}</ul>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button disabled={loading || busy || (target === 'new' && !title.trim())} onClick={() => void save()}>{busy ? '保存中…' : '确认加入并保存'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
