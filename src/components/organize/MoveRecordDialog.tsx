import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listStoryIndex, listCharacterIndex, type StoryIndexEntry } from '@/lib/archive-index';
import { moveSummaryToStory } from '@/lib/story-maintenance';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import type { SummaryItem } from '@/types/summary';

interface Props {
  open: boolean;
  record: SummaryItem | null;
  onOpenChange: (open: boolean) => void;
  onMoved: (record: SummaryItem) => void | Promise<void>;
}

export function MoveRecordDialog({ open, record, onOpenChange, onMoved }: Props) {
  const epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch, getVaultEpoch);
  const [stories, setStories] = useState<StoryIndexEntry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState('');
  const [branch, setBranch] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const capturedEpoch = useRef(epoch);
  const pendingRef = useRef(false);
  const stale = capturedEpoch.current !== epoch;

  useEffect(() => {
    if (!open) return;
    capturedEpoch.current = getVaultEpoch();
    setLoading(true); setError(''); setTarget(''); setBranch(''); setSearch('');
    let cancelled = false;
    void Promise.all([listStoryIndex(), listCharacterIndex()]).then(([items, characters]) => {
      if (cancelled || capturedEpoch.current !== getVaultEpoch()) return;
      setStories(items.filter(story => story.id !== record?.bookId));
      setNames(Object.fromEntries(characters.map(character => [character.id, character.displayMeta?.name || character.name])));
    }).catch(e => { if (!cancelled) setError(String(e)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, record?.id, record?.bookId]);

  const selected = stories.find(story => story.id === target);
  const query = search.trim().toLocaleLowerCase();
  const filtered = stories.filter(story => story.id === target || `${story.title} ${names[story.characterId ?? ''] ?? ''}`.toLocaleLowerCase().includes(query));
  const move = async () => {
    if (!record || !selected || pendingRef.current || stale) return;
    pendingRef.current = true; setPending(true); setError('');
    try {
      const moved = await moveSummaryToStory(record.id, selected.id, branch || undefined);
      await onMoved(moved); onOpenChange(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { pendingRef.current = false; setPending(false); }
  };

  return <Dialog open={open} onOpenChange={value => { if (!pendingRef.current) onOpenChange(value); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>移动到其他故事</DialogTitle>
        <DialogDescription>移动“{record?.title}”。正文和原始来源会保留；移动后可重新指定目标故事的楼层范围。</DialogDescription>
      </DialogHeader>
      <Input aria-label="搜索目标故事" placeholder="搜索故事或角色" value={search} disabled={pending || stale} onChange={event => setSearch(event.target.value)} />
      <label className="space-y-1 text-sm">目标故事
        <select aria-label="目标故事" className="ste-select h-9 w-full text-sm" value={target} disabled={pending || loading || stale}
          onChange={event => { setTarget(event.target.value); setBranch(''); }}>
          <option value="">{loading ? '正在加载…' : '请选择故事'}</option>
          {filtered.map(story => <option key={story.id} value={story.id}>{names[story.characterId ?? ''] ?? '未绑定'} · {story.title}</option>)}
        </select>
      </label>
      {selected && <label className="space-y-1 text-sm">目标脉络
        <select aria-label="目标脉络" className="ste-select h-9 w-full text-sm" value={branch} disabled={pending || stale} onChange={event => setBranch(event.target.value)}>
          <option value="">主线</option>
          {(selected.branchIndex ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>}
      {!loading && !stories.length && !error && <p className="text-sm text-muted-foreground">还没有其他故事。</p>}
      {(error || stale) && <p role="alert" className="text-sm text-destructive">{stale ? '文件库已切换，请关闭后重新打开。' : error}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>取消</Button>
        <Button disabled={!selected || loading || pending || stale} onClick={() => void move()}>{pending ? '正在移动…' : '移动'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
