import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ArchiveStory } from '@/types/archive';
import type { SummaryItem } from '@/types/summary';
import type { StoryTree } from '@/types/story-tree';
import { moveStoryTreeToStory, moveSummaryToStory } from '@/lib/story-maintenance';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';

export function MoveStoryRecordDialog({ record, kind, stories, characterId, onClose, onMoved }: {
  record: SummaryItem | StoryTree; kind: 'summary' | 'tree'; stories: ArchiveStory[]; characterId: string;
  onClose: () => void; onMoved: () => void;
}) {
  useI18n();
  const epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch, getVaultEpoch);
  const capturedEpoch = useRef(epoch);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [targetId, setTargetId] = useState(''), [branchId, setBranchId] = useState('');
  const stale = epoch !== capturedEpoch.current;
  const targets = stories.filter(story => story.characterId === characterId && story.id !== record.bookId);
  const target = targets.find(story => story.id === targetId);
  useEffect(() => { setTargetId(''); setBranchId(''); setError(''); }, [record.id]);
  const move = async () => {
    if (pending.current || stale || !target) return;
    pending.current = true; setBusy(true); setError('');
    try {
      await (kind === 'tree' ? moveStoryTreeToStory : moveSummaryToStory)(record.id, target.id, branchId || undefined, { characterId });
      if (getVaultEpoch() === capturedEpoch.current) { onMoved(); onClose(); }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Dialog open onOpenChange={value => { if (!value && !pending.current) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>{tr("移动到其他故事")}</DialogTitle>
      <DialogDescription>{tr("移动“")}{record.title}{tr("”。只列当前角色的其他故事；正文与原始来源保留，目标脉络需重新选择。")}</DialogDescription></DialogHeader>
    <label className="space-y-1 text-sm">{tr("目标故事")}<select aria-label={tr("目标故事")} className="ste-select h-9 w-full text-sm" value={targetId} disabled={busy || stale}
      onChange={event => { setTargetId(event.target.value); setBranchId(''); }}>
      <option value="">{tr("请选择故事")}</option>{targets.map(story => <option key={story.id} value={story.id}>{story.title}</option>)}
    </select></label>
    {target && <label className="space-y-1 text-sm">{tr("目标脉络")}<select aria-label={tr("目标脉络")} className="ste-select h-9 w-full text-sm" value={branchId} disabled={busy || stale} onChange={event => setBranchId(event.target.value)}>
      <option value="">{tr("主线")}</option>{target.branches?.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
    </select></label>}
    {!targets.length && <p className="text-sm text-muted-foreground">{tr("当前角色还没有其他故事。")}</p>}
    {(stale || error) && <p role="alert" className="text-sm text-destructive">{stale ? tr("资料库已切换，请重新打开。") : error}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{tr("取消")}</Button><Button disabled={!target || busy || stale} onClick={() => void move()}>{busy ? tr("正在移动…") : tr("移动")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
