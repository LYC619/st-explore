import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { captureRecord } from '@/lib/record-capture';
import { getArchiveStory, getBranchLine } from '@/lib/archive-db';
import { getVaultEpoch } from '@/lib/vault/active';
import { generateSummaryId, type SummaryKind } from '@/types/summary';

export function CaptureRecordDialog({ storyId, branchId, messageId, initialContent = '', initialKind = 'volume', beforeSave, onClose, onSaved }: {
  storyId: string; branchId: string | null; messageId?: string; initialContent?: string; initialKind?: SummaryKind;
  beforeSave?: () => Promise<void>; onClose: () => void; onSaved: () => void;
}) {
  const epoch = useRef(getVaultEpoch()), pending = useRef(false), recordId = useRef(generateSummaryId());
  const [kind, setKind] = useState<SummaryKind>(initialKind), [title, setTitle] = useState('');
  const [content, setContent] = useState(initialContent), [volume, setVolume] = useState(''), [owner, setOwner] = useState('');
  const [start, setStart] = useState(''), [end, setEnd] = useState('');
  const [sourceId, setSourceId] = useState(messageId), [source, setSource] = useState<{ floor: number; text: string } | null>(null);
  const [storyTitle, setStoryTitle] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      await beforeSave?.(); const story = await getArchiveStory(storyId);
      if (!story) throw new Error('来源故事不存在');
      const line = getBranchLine(story, branchId); if (!line) throw new Error('来源分支不存在');
      if (!active || getVaultEpoch() !== epoch.current) return;
      setStoryTitle(`${story.title} · ${branchId ? story.branches?.find(branch => branch.id === branchId)?.name : '主线'}`);
      if (sourceId) { const floor = line.session.messages.findIndex(message => message.id === sourceId);
        if (floor < 0) throw new Error('来源消息不存在'); setSource({ floor, text: line.session.messages[floor].content }); }
    })().catch(error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [storyId, branchId, sourceId, beforeSave]);
  const save = async (keepOpen: boolean) => {
    if (pending.current || !content.trim()) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (epoch.current !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开');
      if (sourceId && !source) throw new Error('来源尚未载入');
      await beforeSave?.();
      if ((start.trim() || end.trim()) && (!/^\d+$/.test(start) || !/^\d+$/.test(end))) throw new Error('请填写完整覆盖范围，或两端均留空');
      if (volume && (!/^\d+$/.test(volume) || Number(volume) < 1)) throw new Error('卷号必须是正整数');
      await captureRecord({ recordId: recordId.current, storyId, branchId, messageId: sourceId, expectedSource: source?.text,
        content, kind, title, diaryOwner: owner, volumeNumber: kind === 'volume' && volume ? Number(volume) : undefined,
        range: start.trim() || end.trim() ? { start: Number(start), end: Number(end) } : undefined });
      onSaved();
      if (!keepOpen) onClose();
      else { recordId.current = generateSummaryId(); setContent(''); setTitle(''); setVolume(''); setSourceId(undefined); setSource(null); setStart(''); setEnd(''); }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto">
    <DialogHeader><DialogTitle>{messageId ? '收录为总结/日记' : `手动录入${initialKind === 'diary' ? '日记' : '总结'}`}</DialogTitle>
      <DialogDescription>{storyTitle || '正在读取来源…'}{source ? ` · 收录自第 ${source.floor} 楼` : ''}。覆盖范围可单独指定。</DialogDescription></DialogHeader>
    <label className="space-y-1 text-sm">记录类型<select aria-label="记录类型" value={kind} disabled={busy} className="w-full rounded-md border bg-background p-2" onChange={event => setKind(event.target.value as SummaryKind)}>
      <option value="volume">总结</option><option value="diary">日记</option>
    </select></label>
    <Input aria-label="记录标题" placeholder="标题（留空自动命名）" value={title} disabled={busy} onChange={event => setTitle(event.target.value)} />
    {kind === 'volume' ? <Input aria-label="卷号" inputMode="numeric" placeholder="卷号（留空自动取下一卷）" value={volume} disabled={busy} onChange={event => setVolume(event.target.value)} />
      : <Input aria-label="日记人物" placeholder="日记人物（可留空，不自动指定）" value={owner} disabled={busy} onChange={event => setOwner(event.target.value)} />}
    <Textarea aria-label="记录正文" placeholder="粘贴或输入正文…" rows={8} value={content} disabled={busy} onChange={event => setContent(event.target.value)} />
    <div className="grid grid-cols-2 gap-2"><Input aria-label="覆盖起始楼" inputMode="numeric" placeholder="覆盖起始楼（可选）" value={start} disabled={busy} onChange={event => setStart(event.target.value)} />
      <Input aria-label="覆盖结束楼" inputMode="numeric" placeholder="覆盖结束楼（可选）" value={end} disabled={busy} onChange={event => setEnd(event.target.value)} /></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button variant="outline" disabled={busy || !content.trim()} onClick={() => void save(true)}>保存并继续添加</Button>
      <Button disabled={busy || !content.trim()} onClick={() => void save(false)}>{busy ? '保存中…' : '保存'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
