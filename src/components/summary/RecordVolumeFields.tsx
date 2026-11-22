import { Input } from '@/components/ui/input';
import type { SummaryItem } from '@/types/summary';

export function RecordVolumeFields({ volume, category, onVolumeChange, onCategoryChange, disabled, volumeLabel = '记录卷号', placeholder = '卷号（可留空）' }: {
  volume: string; category: SummaryItem['volumeCategory'];
  onVolumeChange: (value: string) => void; onCategoryChange: (value: SummaryItem['volumeCategory']) => void;
  disabled?: boolean; volumeLabel?: string; placeholder?: string;
}) {
  return <div className="flex flex-wrap items-end gap-3">
    <label className="space-y-1 text-xs text-muted-foreground">卷数类型
      <select aria-label="记录卷数类型" value={category ?? 'numbered'} disabled={disabled}
        className="ste-select block h-8 text-base md:text-sm"
        onChange={event => onCategoryChange(event.target.value === 'other' ? 'other' : undefined)}>
        <option value="numbered">分卷</option><option value="other">其他（番外等）</option>
      </select>
    </label>
    {category !== 'other' && <label className="min-w-32 flex-1 space-y-1 text-xs text-muted-foreground">卷号
      <Input aria-label={volumeLabel} inputMode="numeric" placeholder={placeholder} value={volume} disabled={disabled}
        onChange={event => onVolumeChange(event.target.value)} />
    </label>}
  </div>;
}
