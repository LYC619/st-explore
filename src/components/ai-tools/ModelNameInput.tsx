import { useState } from 'react';
import { RefreshCw, Loader2, Star, List, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DEFAULT_MODEL, normalizeModelNames } from './api-profiles';
import { cn } from '@/lib/utils';

interface ModelNameInputProps {
  model: string;
  modelList: string[];
  favoriteModels: string[];
  fetching: boolean;
  /** 改动模型名（含手输/选中下拉项）；父层据此置 dirty */
  onModelChange: (value: string) => void;
  onFavoriteToggle: (value: string) => void;
  /** 点刷新：取模型列表；成功返回 true 时自动展开下拉 */
  onFetch: () => Promise<boolean>;
}

export function ModelNameInput({ model, modelList, favoriteModels, fetching, onModelChange, onFavoriteToggle, onFetch }: ModelNameInputProps) {
  const [showList, setShowList] = useState(false), [query, setQuery] = useState('');
  const favorites = normalizeModelNames(favoriteModels);
  const models = normalizeModelNames([...favorites, ...modelList]);
  const filtered = models.filter(value => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const current = model.trim();
  return <div className="space-y-2">
    <Label htmlFor="api-model-name">模型名称</Label>
    <div className="flex flex-wrap gap-2">
      <Input id="api-model-name" className="min-w-40 flex-1" value={model} onChange={event => onModelChange(event.target.value)} placeholder={DEFAULT_MODEL} />
      <Button variant="outline" disabled={!current} aria-label={favorites.includes(current) ? '取消当前模型常用' : '当前模型加入常用'} title="保留为常用模型"
        onClick={() => onFavoriteToggle(current)}><Star className={cn('h-4 w-4', favorites.includes(current) && 'fill-primary text-primary')} /></Button>
      <Button variant="outline" onClick={() => setShowList(value => !value)} aria-expanded={showList}><List className="h-4 w-4 mr-1.5" />选择模型</Button>
      <Button variant="outline" onClick={async () => { if (await onFetch()) { setQuery(''); setShowList(true); } }} disabled={fetching}>
        {fetching ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}获取模型
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">可以直接填写模型 ID；星标模型会出现在各工作区的快速切换列表。修改后保存配置。</p>
    {favorites.length > 0 && <div className="flex flex-wrap gap-1.5" aria-label="常用模型">
      {favorites.map(value => <span key={value} className="max-w-full inline-flex items-center rounded-md border border-border text-xs">
        <button type="button" className="truncate px-2 py-1.5 hover:text-primary" title={value} onClick={() => onModelChange(value)}>{value}</button>
        <button type="button" className="shrink-0 px-1.5 py-1.5 text-muted-foreground hover:text-foreground" aria-label={`移除常用模型 ${value}`} onClick={() => onFavoriteToggle(value)}><X className="h-3 w-3" /></button>
      </span>)}
    </div>}
    {showList && <section aria-label="服务模型列表" className="rounded-lg border border-border bg-popover p-3 space-y-2">
      <div className="flex items-center gap-2"><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索已获取的模型" aria-label="搜索服务模型" /><span className="shrink-0 text-xs text-muted-foreground">{filtered.length} 个</span></div>
      <div className="max-h-64 overflow-y-auto">
        {filtered.slice(0, 200).map(value => <div key={value} className="flex items-center gap-1 rounded hover:bg-accent">
          <button type="button" aria-label={`选择模型 ${value}`} aria-pressed={current === value} onClick={() => onModelChange(value)} className="min-w-0 flex-1 flex items-center gap-2 px-2 py-2 text-left text-sm">
            <span className="w-4 shrink-0">{current === value && <Check className="h-4 w-4" />}</span><span className="truncate" title={value}>{value}</span>
          </button>
          <Button variant="ghost" size="icon" className="shrink-0" aria-label={`${favorites.includes(value) ? '取消常用模型' : '收藏模型'} ${value}`} onClick={() => onFavoriteToggle(value)}><Star className={cn('h-3.5 w-3.5', favorites.includes(value) && 'fill-primary text-primary')} /></Button>
        </div>)}
        {!filtered.length && <p className="py-5 text-center text-xs text-muted-foreground">{models.length ? '没有匹配的模型，可在上方填写自定义 ID。' : '先获取模型列表，或在上方填写自定义 ID。'}</p>}
        {filtered.length > 200 && <p className="py-2 text-center text-xs text-muted-foreground">已显示前 200 个，输入关键词继续筛选。</p>}
      </div>
    </section>}
  </div>;
}
