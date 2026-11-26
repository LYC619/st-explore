import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2 } from 'lucide-react';
import type { ChatMessage } from '@/types/chat';

interface MessageEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: ChatMessage | null;
  floorNumber?: number;
  onSave: (updatedMessage: ChatMessage) => void;
  onDelete?: () => void;
}

export const MessageEditDialog = ({
  open,
  onOpenChange,
  message,
  floorNumber,
  onSave,
  onDelete,
}: MessageEditDialogProps) => {
  useI18n();
  const [content, setContent] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'user' | 'assistant'>('assistant');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (message) {
      setContent(message.content);
      setName(message.name || '');
      setRole(message.role === 'user' ? 'user' : 'assistant');
      setConfirmDelete(false);
    }
  }, [message, open]);

  const handleSave = () => {
    if (!message) return;

    onSave({
      ...message,
      content,
      name: name || undefined,
      role,
    });
    onOpenChange(false);
  };

  if (!message) return null;

  const titleLabel = typeof floorNumber === 'number'
    ? tr("编辑第 #{{v0}} 楼", { v0: floorNumber })
    : tr("编辑本楼内容");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display">{titleLabel}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">{tr("说话人名称")}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={tr("留空则跟随当前角色或玩家默认名")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">{tr("发言归属")}</Label>
              <Select value={role} onValueChange={(v) => setRole(v as 'user' | 'assistant')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">{tr("玩家发言")}</SelectItem>
                  <SelectItem value="assistant">{tr("角色回复")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">{tr("楼层正文")}</Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[300px] text-sm leading-relaxed"
              placeholder={tr("输入这一楼的正文内容…")}
            />
          </div>
        </div>

        <DialogFooter className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {onDelete && !confirmDelete && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" />{tr("删除本楼")}</Button>
            )}
            {onDelete && confirmDelete && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs">
                <span className="text-destructive">{tr("确认删除这一楼？")}</span>
                <Button
                  size="sm"
                  variant="outline"
                  autoFocus
                  onClick={() => setConfirmDelete(false)}
                >{tr("取消")}</Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    setConfirmDelete(false);
                    onDelete();
                    onOpenChange(false);
                  }}
                >{tr("确认删除")}</Button>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{tr("取消")}</Button>
            <Button onClick={handleSave} disabled={!content.trim()}>{tr("保存修改")}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
