import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { ManagedTagOption } from '@/lib/library-tag-preferences';

interface ManagedTagRowProps {
  option: ManagedTagOption;
  index: number;
  total: number;
  busy: boolean;
  selected: boolean;
  chatVisible: boolean;
  onChatVisibilityChange: (raw: string, visible: boolean) => void;
  dropEdge?: 'before' | 'after';
  onVisibilityChange: (raw: string, visible: boolean) => void;
  onMove: (raw: string, targetIndex: number) => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onSelect: (raw: string) => void;
  onDelete: (option: ManagedTagOption) => void;
}

export function ManagedTagRow({
  option,
  index,
  total,
  busy,
  selected,
  chatVisible,
  onChatVisibilityChange,
  dropEdge,
  onVisibilityChange,
  onMove,
  onPointerDown,
  onSelect,
  onDelete,
}: ManagedTagRowProps) {
  useI18n();
  const displayLabel = option.builtIn ? tr(option.label) : option.label;
  const displayRaw = option.category === '未分类'
    ? displayLabel
    : `${tr(option.category)}/${displayLabel}`;
  return (
    <div
      data-managed-tag={option.raw}
      data-pointer-drop-edge={dropEdge}
      className={cn(
        'group relative min-h-11 flex flex-wrap items-center gap-2 rounded-lg border bg-[var(--bg-elevated)] px-2 py-1.5 transition-[border-color,background-color,transform] duration-150',
        selected ? 'border-[color:var(--brand)]' : 'border-[color:var(--border-normal)]',
      )}
    >
      {dropEdge && (
        <span
          data-managed-tag-insertion-line
          className={cn(
            'pointer-events-none absolute left-1 right-1 z-10 h-0.5 rounded-full bg-[var(--brand)] shadow-[0_0_0_2px_var(--bg-canvas)]',
            dropEdge === 'before' ? '-top-[5px]' : '-bottom-[5px]',
          )}
        />
      )}
      <span
        data-managed-tag-drag-handle={option.raw}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!busy) onPointerDown(event);
        }}
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
        className="flex h-8 w-7 shrink-0 touch-none select-none cursor-grab items-center justify-center text-[color:var(--text-faint)] active:cursor-grabbing"
        title={tr("拖拽调整侧栏顺序")}
      >
        <GripVertical className="h-4 w-4" />
      </span>
      <Checkbox
        checked={option.visible}
        disabled={busy}
        onCheckedChange={(checked) => onVisibilityChange(option.raw, checked === true)}
        aria-label={option.visible ? tr("隐藏标签 {{v0}}", { v0: displayRaw }) : tr("显示标签 {{v0}}", { v0: displayRaw })}
      />
      <button
        type="button"
        disabled={busy}
        aria-label={tr("选择标签 {{v0}}", { v0: displayRaw })}
        aria-pressed={selected}
        onClick={() => onSelect(option.raw)}
        className="min-w-0 flex-1 rounded-md px-1 py-0.5 text-left hover:bg-[var(--hover-overlay)]"
      >
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm text-[color:var(--text-body)]" title={displayRaw}>{displayLabel}</span>
          <span className={cn(
            'shrink-0 rounded-full px-1.5 py-0.5 text-[11px]',
            option.builtIn
              ? 'bg-[var(--hover-overlay)] text-[color:var(--text-muted)]'
              : 'border border-dashed border-[color:var(--border-normal)] text-[color:var(--text-muted)]',
          )}>
            {option.builtIn ? tr("内置") : tr("自定义")}
          </span>
        </div>
        <span className="text-[11px] text-[color:var(--text-faint)]">{tr("{{v0}} 张角色卡", { v0: option.count })}</span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          disabled={busy || index === 0}
          onClick={() => onMove(option.raw, index - 1)}
          aria-label={tr("上移标签 {{v0}}", { v0: displayRaw })}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--text-muted)] hover:bg-[var(--hover-overlay)] hover:text-[color:var(--text-body)] disabled:pointer-events-none disabled:opacity-30"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={busy || index === total - 1}
          onClick={() => onMove(option.raw, index + 1)}
          aria-label={tr("下移标签 {{v0}}", { v0: displayRaw })}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--text-muted)] hover:bg-[var(--hover-overlay)] hover:text-[color:var(--text-body)] disabled:pointer-events-none disabled:opacity-30"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <button
            type="button"
            disabled={busy}
            onClick={() => onDelete(option)}
            aria-label={tr("删除标签 {{v0}}", { v0: displayRaw })}
            className="flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--text-faint)] hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <label className="flex min-h-11 basis-full items-center justify-between gap-2 border-t border-[color:var(--border-normal)] px-1 text-xs text-[color:var(--text-muted)]">{tr("在聊天中显示")}<Switch aria-label={tr("在聊天中显示 {{v0}}", { v0: displayRaw })} checked={chatVisible} disabled={busy}
          onCheckedChange={visible => onChatVisibilityChange(option.raw, visible)} />
      </label>
    </div>
  );
}
