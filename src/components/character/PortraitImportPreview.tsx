import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import type { ArchiveCharacter } from '@/types/archive';
import type { PortraitPreviewRow } from '@/lib/portrait-import-preferences';
import { portraitPreviewCache } from '@/lib/portrait-preview-cache';

function Thumbnail({ url, name }: { url: string; name: string }) {
  const host = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(false), [source, setSource] = useState(''), [error, setError] = useState('');
  const latestName = useRef(name); latestName.current = name;
  useEffect(() => {
    if (!host.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '120px' });
    observer.observe(host.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return; let active = true; setError(''); setSource('');
    const acquired = portraitPreviewCache.acquire({ url, name: latestName.current });
    acquired.promise.then(source => { if (active) setSource(source); }).catch(error => { if (active && error?.name !== 'AbortError') setError(String(error.message ?? error)); });
    return () => { active = false; acquired.release(); };
  }, [url, visible]);
  return <div ref={host} className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted text-[11px] text-muted-foreground">
    {error ? <span className="p-1 break-words">{error}</span> : source ? <img src={source} alt={name} className="h-full w-full object-contain" onError={() => setError('此环境无法解码预览，可尝试保存原文件')} /> : <span>缩略图</span>}
  </div>;
}

export function PortraitImportPreview({ rows, character, disabled, onChange }: { rows: PortraitPreviewRow[]; character: ArchiveCharacter; disabled?: boolean;
  onChange: (id: string, patch: Partial<PortraitPreviewRow>, validate?: boolean) => void }) {
  return <div className="max-h-[45vh] overflow-auto rounded border border-border divide-y">{rows.map(row => <div key={row.id} className="p-3 space-y-2" data-portrait-line={row.line}>
    <div className="flex gap-3"><input type="checkbox" aria-label={`选择第 ${row.line} 行`} disabled={disabled || !row.url || !!row.issue || !row.name.trim()} checked={row.selected}
      onChange={event => onChange(row.id, { selected: event.target.checked })} />
      {row.url && <Thumbnail url={row.url} name={row.name} />}
      <div className="min-w-0 flex-1 space-y-2"><p className="text-xs text-muted-foreground">第 {row.line} 行 · {row.issue ? '待修正' : row.alreadySaved && !row.force ? '已保存，默认跳过' : '可导入'}</p>
        <Input aria-label={`第 ${row.line} 行名称`} value={row.name} disabled={disabled} placeholder="填写名称" onChange={event => onChange(row.id, { name: event.target.value, manualName: true })} />
        <Input aria-label={`第 ${row.line} 行链接或文件码`} value={row.input} disabled={disabled} placeholder="完整 URL 或文件码，如 abcd.png"
          onChange={event => onChange(row.id, { input: event.target.value, manualUrl: true, issue: '待校验', selected: false })} onBlur={() => onChange(row.id, {}, true)}
          onKeyDown={event => { if (event.key === 'Enter') onChange(row.id, {}, true); }} />
      </div>
    </div>
    <label className="flex items-center gap-2 text-xs">目标分行<select aria-label={`第 ${row.line} 行目标分行`} className="ste-select h-8 min-w-0 text-xs" value={row.rowId ?? ''} disabled={disabled}
      onChange={event => onChange(row.id, { rowId: event.target.value || null, manualRow: true })}><option value="">未分行</option>
      {row.rowId && !character.portraitRows?.some(item => item.id === row.rowId) && <option value={row.rowId}>原目标已删除</option>}
      {character.portraitRows?.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
    </select></label>
    {row.alreadySaved && <label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={disabled} checked={!!row.force} onChange={event => onChange(row.id, { force: event.target.checked, selected: event.target.checked })} />重新导入此链接（允许内容已更新）</label>}
    {row.issue && <p role="alert" className="text-xs text-destructive">{row.issue}</p>}
    <details className="text-xs text-muted-foreground"><summary>原始行</summary><p className="break-all whitespace-pre-wrap">{row.raw}</p></details>
  </div>)}</div>;
}
