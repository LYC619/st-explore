import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Keep the default tag strip at one line; expand explicitly without opening the character. */
export function CollapsibleTags({ children, count }: { children: ReactNode; count: number }) {
  useI18n();
  const [expanded, setExpanded] = useState(false);
  if (!count) return null;
  return <div className="flex min-w-0 flex-1 items-start gap-1" data-collapsible-tags>
    <div className={cn('flex min-w-0 flex-1 gap-1.5', expanded ? 'flex-wrap' : 'max-h-8 flex-nowrap overflow-hidden')}>{children}</div>
    <button type="button" aria-expanded={expanded} aria-label={expanded ? tr("收起标签") : tr("展开全部 {{v0}} 个标签", { v0: count })}
      className="flex h-8 shrink-0 items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:bg-muted"
      onClick={event => { event.stopPropagation(); setExpanded(value => !value); }}>
      {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}{count}
    </button>
  </div>;
}
