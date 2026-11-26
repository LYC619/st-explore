import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useMemo, useState  } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { variableChanges, variableRows, variableText } from '@/lib/variable-inspector';

export function VariableInspector({ value, before, label = tr("当前变量"), beforeLabel = tr("对照变量") }: { value: unknown; before?: unknown; label?: string; beforeLabel?: string }) {
  useI18n();
  const [query, setQuery] = useState(''), [mode, setMode] = useState<'tree' | 'diff'>('tree');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['', '/stat_data']));
  const tree = useMemo(() => variableRows(value), [value]);
  const diff = useMemo(() => before === undefined ? null : variableChanges(before, value), [before, value]);
  const search = query.trim().toLocaleLowerCase();
  const shown = tree.rows.filter(row => {
    if (search) return row.path.toLocaleLowerCase().includes(search) || !row.container && variableText(row.value, 2000).toLocaleLowerCase().includes(search);
    let parent = row.path;
    while (parent.includes('/')) { parent = parent.slice(0, parent.lastIndexOf('/')); if (!expanded.has(parent)) return false; }
    return true;
  });
  const changes = diff?.changes.filter(row => !search || [row.path, variableText(row.before, 2000), variableText(row.after, 2000)].some(v => v.toLocaleLowerCase().includes(search))) ?? [];
  return <div className="space-y-2 min-w-0" data-variable-inspector>
    <div className="flex flex-wrap gap-2 items-center"><span className="text-xs text-muted-foreground">{label}</span><Button size="sm" variant={mode === 'tree' ? 'secondary' : 'ghost'} onClick={() => setMode('tree')}>{tr("变量树")}</Button><Button size="sm" disabled={!diff} variant={mode === 'diff' ? 'secondary' : 'ghost'} onClick={() => setMode('diff')}>{tr("差异")}{diff ? ` (${diff.changes.length}${diff.truncated ? '+' : ''})` : ''}</Button></div>
    <Input aria-label={tr("搜索变量路径或值")} placeholder={tr("搜索变量路径或值")} value={query} onChange={e => setQuery(e.target.value)} />
    {(mode === 'tree' ? tree.truncated : diff?.truncated) && <p className="text-xs text-muted-foreground">{tr("变量较大，仅展示前 2500 个节点及 40 层深度。")}</p>}
    <div className="max-h-80 overflow-auto rounded border p-2 text-xs" aria-label={mode === 'tree' ? tr("变量树内容") : tr("变量差异内容")}>
      {mode === 'tree' ? shown.map(row => <div key={row.path} className="py-1 break-all" style={{ paddingLeft: search ? 0 : Math.min(row.depth, 8) * 12 }}>
        {row.container ? <button type="button" className="text-left font-medium" onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(row.path)) next.delete(row.path); else next.add(row.path); return next; })} aria-expanded={expanded.has(row.path)}>{expanded.has(row.path) ? '▾' : '▸'} {search ? row.path || '$' : row.key} <span className="text-muted-foreground">{Array.isArray(row.value) ? tr("数组 [{{v0}}]", { v0: row.value.length }) : tr("对象 {{{v0}}}", { v0: Object.keys(row.value as object).length })}</span></button>
          : <span title={row.path}><span className="font-medium">{search ? row.path : row.key}</span>: {variableText(row.value)}</span>}
      </div>) : <><p className="mb-2 text-muted-foreground">{beforeLabel} → {label}</p>{changes.map(row => <div key={row.path} className="border-t py-2 break-all"><p className="font-medium">{({ added: tr("新增"), removed: tr("已移除"), changed: tr("改变") })[row.kind]} · {row.path || '$'}</p><p className="text-muted-foreground">{tr("前：")}{variableText(row.before)}</p><p>{tr("后：")}{variableText(row.after)}</p></div>)}</>}
      {!(mode === 'tree' ? shown.length : changes.length) && <p className="text-muted-foreground">{search ? tr("没有匹配变量") : tr("未发现差异")}</p>}
    </div>
  </div>;
}
