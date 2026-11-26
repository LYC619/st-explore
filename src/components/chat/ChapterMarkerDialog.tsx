import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ChapterMarker } from '@/types/chat';

interface ChapterMarkerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageIndex: number;
  messageId: string;
  existingMarker?: ChapterMarker;
  onSave: (marker: ChapterMarker) => void;
  onDelete?: () => void;
}

export function ChapterMarkerDialog({
  open,
  onOpenChange,
  messageIndex,
  messageId,
  existingMarker,
  onSave,
  onDelete,
}: ChapterMarkerDialogProps) {
  useI18n();
  const [title, setTitle] = useState('');
  const [volume, setVolume] = useState('');
  const [summary, setSummary] = useState('');

  useEffect(() => {
    if (existingMarker) {
      setTitle(existingMarker.title);
      setVolume(existingMarker.volume || '');
      setSummary(existingMarker.summary || '');
    } else {
      setTitle(tr("第 #{{v0}} 楼", { v0: messageIndex }));
      setVolume('');
      setSummary('');
    }
  }, [existingMarker, messageIndex, open]);

  const handleSave = () => {
    onSave({
      messageId,
      messageIndex,
      title,
      volume: volume || undefined,
      summary: summary || undefined,
      createdAt: existingMarker?.createdAt || Date.now(),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">
            {existingMarker ? tr("编辑章节标记") : tr("添加章节标记")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="text-sm text-muted-foreground">{tr("标记位置：第 #{{v0}} 楼", { v0: messageIndex })}</div>

          <div className="space-y-2">
            <Label htmlFor="volume">{tr("卷名（可选）")}</Label>
            <Input
              id="volume"
              placeholder={tr("例：第一卷 - 初遇")}
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">{tr("章节标题")}</Label>
            <Input
              id="title"
              placeholder={tr("例：命运的相遇")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="summary">{tr("章节概要（可选）")}</Label>
            <Textarea
              id="summary"
              placeholder={tr("简要描述这一章节的内容...")}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          {existingMarker && onDelete && (
            <Button
              variant="destructive"
              onClick={() => {
                onDelete();
                onOpenChange(false);
              }}
              className="mr-auto"
            >{tr("删除标记")}</Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tr("取消")}</Button>
          <Button onClick={handleSave} disabled={!title.trim()}>{tr("保存")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}