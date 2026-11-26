import { tr, getLocale } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { captureRecord, captureCharacterNote } from '@/lib/record-capture';
import { getArchiveStory, getBranchLine } from '@/lib/archive-db';
import { getVaultEpoch } from '@/lib/vault/active';
import { generateSummaryId, type SummaryKind, type SummaryItem } from '@/types/summary';
import { RecordVolumeFields } from './RecordVolumeFields';

export function CaptureRecordDialog({ storyId, branchId, messageId, initialContent = '', initialKind = 'volume', beforeSave, onClose, onSaved }: {
  storyId: string; branchId: string | null; messageId?: string; initialContent?: string; initialKind?: SummaryKind;
  beforeSave?: () => Promise<void>; onClose: () => void; onSaved: (destination?: SummaryKind | 'note') => void;
}) {
  useI18n();
  const epoch = useRef(getVaultEpoch()), pending = useRef(false), recordId = useRef(generateSummaryId());
  const [kind, setKind] = useState<SummaryKind | 'note'>(initialKind), [title, setTitle] = useState('');
  const [content, setContent] = useState(initialContent), [volume, setVolume] = useState(''), [owner, setOwner] = useState('');
  const [start, setStart] = useState(''), [end, setEnd] = useState('');
  const [category, setCategory] = useState<SummaryItem['volumeCategory']>();
  const [sourceId, setSourceId] = useState(messageId), [source, setSource] = useState<{ floor: number; text: string } | null>(null);
  const [hasCharacter, setHasCharacter] = useState(false);
  const [storyTitle, setStoryTitle] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      await beforeSave?.(); const story = await getArchiveStory(storyId);
      if (!story) throw new Error(tr("找不到对应的故事（可能已被移动或删除），请关闭窗口后刷新页面重试"));
      const line = getBranchLine(story, branchId); if (!line) throw new Error(tr("找不到对应的故事支线，请关闭窗口后重新打开主线或有效支线"));
      if (!active || getVaultEpoch() !== epoch.current) return;
      setHasCharacter(!!story.characterId);
      setStoryTitle(`${story.title} · ${branchId ? story.branches?.find(branch => branch.id === branchId)?.name : tr("主线")}`);
      if (sourceId) { const floor = line.session.messages.findIndex(message => message.id === sourceId);
        if (floor < 0) throw new Error(tr("找不到要收录的那一楼消息，请关闭窗口后重新选择楼层")); setSource({ floor, text: line.session.messages[floor].content }); }
    })().catch(error => { if (active) setError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [storyId, branchId, sourceId, beforeSave]);
  const save = async (keepOpen: boolean) => {
    if (pending.current || !content.trim()) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (epoch.current !== getVaultEpoch()) throw new Error(tr("资料库已切换，请重新打开"));
      if (sourceId && !source) throw new Error(tr("故事内容还在读取中，请稍候片刻再点保存"));
      await beforeSave?.();
      if (epoch.current !== getVaultEpoch()) throw new Error(tr("资料库已切换，请重新打开"));
      if (kind !== 'note' && (start.trim() || end.trim()) && (!/^\d+$/.test(start) || !/^\d+$/.test(end))) throw new Error(tr("请填写完整覆盖范围，或两端均留空"));
      if (kind !== 'note' && category !== 'other' && volume && (!/^\d+$/.test(volume) || Number(volume) < 1)) throw new Error(tr("卷号必须是正整数"));
      if (kind === 'note') await captureCharacterNote({ recordId: recordId.current, storyId, branchId, messageId: sourceId, expectedSource: source?.text, content, title });
      else await captureRecord({ recordId: recordId.current, storyId, branchId, messageId: sourceId, expectedSource: source?.text,
        content, kind, title, diaryOwner: owner, volumeNumber: category !== 'other' && volume ? Number(volume) : undefined, volumeCategory: category,
        range: start.trim() || end.trim() ? { start: Number(start), end: Number(end) } : undefined });
      onSaved(kind);
      if (!keepOpen) onClose();
      else { recordId.current = generateSummaryId(); setContent(''); setTitle(''); setVolume(''); setSourceId(undefined); setSource(null); setStart(''); setEnd(''); }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose(); }}><DialogContent className="w-[calc(100vw-2rem)] max-w-4xl max-h-[90dvh] overflow-y-auto">
    <DialogHeader><DialogTitle>{messageId ? tr("收录") : (initialKind === 'diary' ? tr("手动录入日记") : tr("手动录入总结"))}</DialogTitle>
      <DialogDescription>{tr("{{v0}}{{v1}}。", { v0: storyTitle || tr("正在读取来源…"), v1: source ? tr(" · 收录自第 {{v0}} 楼", { v0: source.floor }) : '' })}{getLocale() === 'en' ? ' ' : ''}{kind === 'note' ? tr("保存到当前绑定角色的备注。") : tr("覆盖范围可单独指定。")}</DialogDescription></DialogHeader>
    <label className="space-y-1 text-sm">{tr("记录类型")}<select aria-label={tr("记录类型")} value={kind} disabled={busy} className="ste-select h-9 w-full text-sm" onChange={event => setKind(event.target.value as SummaryKind | 'note')}>
      <option value="volume">{tr("总结")}</option><option value="diary">{tr("日记")}</option><option value="note" disabled={!hasCharacter}>{!hasCharacter ? tr("备注（需先绑定角色）") : tr("备注")}</option>
    </select></label>
    <Input aria-label={tr("记录标题")} placeholder={tr("标题（留空自动命名）")} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} />
    {kind !== 'note' && <RecordVolumeFields volume={volume} category={category} disabled={busy} volumeLabel={tr("卷号")}
      placeholder={kind === 'volume' ? tr("卷号（留空自动取下一卷）") : tr("卷号（可留空）")} onVolumeChange={setVolume} onCategoryChange={setCategory} />}
    {kind === 'diary' && <Input aria-label={tr("日记人物")} placeholder={tr("日记人物（可留空，不自动指定）")} value={owner} disabled={busy} onChange={event => setOwner(event.target.value)} />}
    <Textarea aria-label={tr("记录正文")} placeholder={tr("粘贴或输入正文…")} rows={14} className="min-h-[35dvh]" value={content} disabled={busy} onChange={event => setContent(event.target.value)} />
    {kind !== 'note' && <><div className="grid grid-cols-2 gap-2"><Input aria-label={tr("覆盖起始楼")} inputMode="numeric" placeholder={tr("覆盖起始楼（可选）")} value={start} disabled={busy} onChange={event => setStart(event.target.value)} />
      <Input aria-label={tr("覆盖结束楼")} inputMode="numeric" placeholder={tr("覆盖结束楼（可选）")} value={end} disabled={busy} onChange={event => setEnd(event.target.value)} /></div>
    <p className="text-xs text-muted-foreground">{sourceId ? tr("两端留空时不关联覆盖范围；来源楼层单独保留。") : tr("两端留空时覆盖当前主线或分支的全部楼层。楼层号从 0 开始。")}</p></>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{tr("取消")}</Button><Button variant="outline" disabled={busy || !content.trim()} onClick={() => void save(true)}>{tr("保存并继续添加")}</Button>
      <Button disabled={busy || !content.trim()} onClick={() => void save(false)}>{busy ? tr("保存中…") : tr("保存")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
