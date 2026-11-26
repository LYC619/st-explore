import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useMemo, useId, useState  } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { renderNoteMarkdown } from '@/lib/note-markdown';

export function PresetNotes({ value, onChange, onSave, busy, dirty }: { value: string; onChange: (value: string) => void; onSave: () => void; busy: boolean; dirty: boolean }) {
  useI18n();
  const [editing, setEditing] = useState(false);
  const prefix = useId();
  const [heading, setHeading] = useState('');
  const rendered = useMemo(() => renderNoteMarkdown(value, `preset-note-${prefix}`), [value, prefix]);
  return <section className="space-y-3" aria-label={tr("预设笔记")}>
    <div className="flex items-center gap-2"><h3 className="text-sm font-medium flex-1">{tr("我的使用笔记")}</h3><Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(v => !v)}>{editing ? tr("预览笔记") : tr("编辑笔记")}</Button><Button size="sm" disabled={!dirty || busy} onClick={onSave}>{tr("保存笔记")}</Button></div>
    {editing ? <Textarea aria-label={tr("预设笔记正文")} className="min-h-64 leading-relaxed" value={value} onChange={e => onChange(e.target.value)} placeholder={tr("记录用法、测试感受和待办；支持 Markdown 标题。")} disabled={busy} />
      : value.trim() ? <div className="flex flex-col sm:flex-row gap-3 min-w-0"><div className="note-markdown prose prose-sm max-w-none flex-1 min-w-0 text-sm break-words leading-relaxed" dangerouslySetInnerHTML={{ __html: rendered.html }} />{!!rendered.headings.length && <nav className="sm:w-36 shrink-0 space-y-1 sm:sticky sm:top-0 self-start max-h-64 overflow-y-auto" aria-label={tr("笔记目录")}>{rendered.headings.map(item => <button key={item.id} type="button" aria-current={heading === item.id ? 'location' : undefined} className={`tap-target block min-h-8 w-full rounded px-2 py-1 text-left text-xs truncate ${heading === item.id ? 'bg-[var(--brand-active-bg)] text-brand' : 'text-muted-foreground hover:bg-[var(--hover-overlay)]'}`} style={{ paddingLeft: `${Math.min(item.level, 4) * 0.5}rem` }} title={item.title} onClick={() => { setHeading(item.id); const target = document.getElementById(item.id); target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}>{item.title}</button>)}</nav>}</div> : <p className="text-sm text-muted-foreground py-8 text-center">{tr("还没有笔记，点击“编辑笔记”开始记录。")}</p>}
  </section>;
}
