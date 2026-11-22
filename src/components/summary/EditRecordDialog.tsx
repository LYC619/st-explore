import { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownLite } from '@/components/MarkdownLite';
import { RecordVolumeFields } from './RecordVolumeFields';
import { editSummary } from '@/lib/summary-db';
import { getVaultEpoch } from '@/lib/vault/active';
import type { SummaryItem } from '@/types/summary';

export function EditRecordDialog({ record, onClose, onSaved }: { record: SummaryItem; onClose: () => void; onSaved: () => void }) {
  const epoch = useRef(getVaultEpoch()), pending = useRef(false);
  const [title, setTitle] = useState(record.title), [content, setContent] = useState(record.content);
  const [volume, setVolume] = useState(record.volumeNumber?.toString() ?? '');
  const [category, setCategory] = useState(record.volumeCategory);
  const [owner, setOwner] = useState(record.diaryOwner ?? record.genParams?.diaryOwner ?? '');
  const [floorStartStr, setFloorStartStr] = useState(String(record.floorStart ?? 0));
  const [floorEndStr, setFloorEndStr] = useState(String(record.floorEnd ?? 0));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [preview, setPreview] = useState(false), [confirmClose, setConfirmClose] = useState(false);

  const rangeChanged = floorStartStr !== String(record.floorStart ?? 0) || floorEndStr !== String(record.floorEnd ?? 0);
  const dirty =
    title !== record.title ||
    content !== record.content ||
    volume !== (record.volumeNumber?.toString() ?? '') ||
    category !== record.volumeCategory ||
    owner !== (record.diaryOwner ?? record.genParams?.diaryOwner ?? '') ||
    rangeChanged;

  const close = () => {
    if (pending.current) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  async function save() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (category !== 'other' && volume && !/^\d+$/.test(volume)) throw new Error('卷号必须是正整数');
      let floorPatch: { floorStart?: number; floorEnd?: number; rangeDetached?: boolean } = {};
      if (rangeChanged) {
        if (!/^\d+$/.test(floorStartStr.trim()) || !/^\d+$/.test(floorEndStr.trim())) {
          throw new Error('覆盖起始与结束楼层需填写非负整数');
        }
        const start = Number(floorStartStr.trim());
        const end = Number(floorEndStr.trim());
        if (end < start) throw new Error('结束楼层不能小于起始楼层');
        floorPatch = { floorStart: start, floorEnd: end, rangeDetached: false };
      }
      await editSummary(record, {
        title,
        content,
        volumeNumber: category !== 'other' && volume ? Number(volume) : undefined,
        volumeCategory: category,
        diaryOwner: owner || undefined,
        ...floorPatch,
      }, epoch.current);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试');
    } finally {
      pending.current = false; setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto font-sans">
        <DialogHeader>
          <DialogTitle>编辑记录</DialogTitle>
          <DialogDescription>可修改标题、覆盖楼层范围和正文，保存后直接更新这条记录。</DialogDescription>
        </DialogHeader>
        <label className="space-y-1 text-sm">
          标题
          <Input aria-label="记录标题" value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <details>
          <summary className="cursor-pointer py-2 text-sm">卷号、覆盖楼层与归属</summary>
          <div className="space-y-3 pt-1">
            {record.kind !== 'diy' && (
              <RecordVolumeFields
                volume={volume}
                category={category}
                onVolumeChange={setVolume}
                onCategoryChange={setCategory}
                disabled={busy}
              />
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-xs text-muted-foreground">
                覆盖起始楼层（0 起算）
                <Input
                  aria-label="覆盖起始楼层"
                  inputMode="numeric"
                  value={floorStartStr}
                  disabled={busy}
                  onChange={(e) => setFloorStartStr(e.target.value.replace(/[^0-9]/g, ''))}
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                覆盖结束楼层
                <Input
                  aria-label="覆盖结束楼层"
                  inputMode="numeric"
                  value={floorEndStr}
                  disabled={busy}
                  onChange={(e) => setFloorEndStr(e.target.value.replace(/[^0-9]/g, ''))}
                />
              </label>
            </div>
            {record.kind === 'diary' && (
              <label className="space-y-1 text-xs text-muted-foreground block">
                日记署名角色
                <Input aria-label="日记归属" value={owner} disabled={busy} onChange={(e) => setOwner(e.target.value)} />
              </label>
            )}
          </div>
        </details>
        <div className="flex items-center justify-between">
          <span className="text-sm">正文</span>
          <Button variant="ghost" size="sm" onClick={() => setPreview(!preview)}>{preview ? '继续编辑' : '阅读预览'}</Button>
        </div>
        {preview ? (
          <MarkdownLite text={content} className="record-reading min-h-48" />
        ) : (
          <Textarea aria-label="记录正文" value={content} disabled={busy} onChange={(e) => setContent(e.target.value)} className="min-h-[35dvh] text-base leading-7" />
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {confirmClose && (
          <div role="alert" className="rounded-lg border p-3 text-sm">
            有未保存的修改。
            <div className="mt-2 flex gap-2">
              <Button variant="outline" autoFocus onClick={() => setConfirmClose(false)}>继续编辑记录</Button>
              <Button variant="destructive" onClick={onClose}>放弃修改</Button>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={close}>取消</Button>
          <Button className="min-h-11" disabled={busy || !title.trim() || !content.trim()} onClick={() => void save()}>
            {busy ? '正在保存…' : '保存修改'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
