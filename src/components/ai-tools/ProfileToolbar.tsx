import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
// 提供商切换/新增/复制/删除的顶部工具行。纯展示，事件回调由 APIConfigCard 透传。
import { Plus, CopyPlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ApiProfile } from './api-profiles';

interface ProfileToolbarProps {
  profiles: ApiProfile[];
  activeId: string;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onDeleteClick: () => void;
}

export function ProfileToolbar({ profiles, activeId, onSwitch, onAdd, onDuplicate, onDeleteClick }: ProfileToolbarProps) {
  useI18n();
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select value={activeId} onValueChange={onSwitch}>
        <SelectTrigger className="h-9 w-56" aria-label={tr("选择提供商")} disabled={!profiles.length}>
          <SelectValue placeholder={tr("选择提供商")} />
        </SelectTrigger>
        <SelectContent>
          {profiles.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}{p.apiKey ? '' : tr("（未配置）")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" className="h-9 gap-1" onClick={onAdd}>
        <Plus className="w-4 h-4" />{tr("新增")}</Button>
      <Button variant="ghost" size="sm" className="h-9 gap-1" onClick={onDuplicate}>
        <CopyPlus className="w-4 h-4" />{tr("复制")}</Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-9 gap-1 text-destructive"
        onClick={onDeleteClick}
        disabled={!activeId}
      >
        <Trash2 className="w-4 h-4" />{tr("删除")}</Button>
    </div>
  );
}
