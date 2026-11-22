import { isLLMConfigured } from '@/lib/llm';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronDown, Search, Settings2, Star, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { activateApiModel, normalizeModelNames, profileModels, setProfileModelFavorite, type ApiModelSelection } from './api-profiles';
import { useApiProfileState } from './useApiProfileState';
import { saveSettingsSection } from '@/lib/settings-navigation';

export interface QuickModelSwitcherProps {
  /** Omit for global selection. A supplied value belongs only to the calling workspace. */
  value?: ApiModelSelection;
  onChange?: (selection: ApiModelSelection) => void;
  disabled?: boolean;
  /** Switching affects later requests; the caller retains its running request snapshot. */
  busy?: boolean;
  onManage?: () => void;
  className?: string;
}

export function QuickModelSwitcher({ value, onChange, disabled, busy, onManage, className }: QuickModelSwitcherProps) {
  const navigate = useNavigate();
  const { profiles, activeId } = useApiProfileState();
  const active = profiles.find(profile => profile.id === (value?.profileId ?? activeId));
  const selection = value ?? (active ? { profileId: active.id, model: active.model } : undefined);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [showAll, setShowAll] = useState(false);
  const [customOpen, setCustomOpen] = useState(false), [customProfile, setCustomProfile] = useState(''), [customModel, setCustomModel] = useState('');
  const groups = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return profiles.map(profile => {
      const all = profileModels(profile);
      const options = showAll || term ? all : normalizeModelNames([profile.model, ...normalizeModelNames(profile.favoriteModels)]);
      return { profile, all, models: options.filter(model => !term || `${profile.name}\n${model}`.toLocaleLowerCase().includes(term)) };
    }).filter(group => group.models.length);
  }, [profiles, query, showAll]);
  const choose = (next: ApiModelSelection) => {
    if (!value && !activateApiModel(next)) return;
    onChange?.(next);
    setOpen(false);
  };
  const currentLabel = active ? `${active.name} · ${selection?.model ?? active.model}` : '选择服务与模型';
  const customTarget = profiles.find(profile => profile.id === (customProfile || active?.id)) ?? profiles[0];

  return <Popover open={open} onOpenChange={next => { setOpen(next); if (next) { setQuery(''); setShowAll(false); setCustomOpen(false); setCustomModel(''); } }}>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" disabled={disabled} aria-label={`切换模型，当前 ${currentLabel}`} title={currentLabel}
        className={cn('max-w-full min-w-0 gap-2 justify-between', className)}>
        <span className="min-w-0 truncate">{currentLabel}</span><ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-0" aria-label="服务与模型选择">
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">选择模型</span><span className="text-[11px] text-muted-foreground">{value ? '仅此工作区' : '当前 AI 配置'}</span></div>
        <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input autoFocus aria-label="搜索服务或模型" placeholder="搜索服务或模型" value={query} onChange={event => setQuery(event.target.value)} className="pl-8" /></div>
        {busy && <p className="text-xs text-muted-foreground">正在生成的请求继续使用原模型；切换用于下一次请求。</p>}
      </div>
      <div className="max-h-[min(23rem,50vh)] overflow-y-auto p-2 space-y-2">
        {groups.map(({ profile, models }) => <section key={profile.id} aria-label={profile.name}>
          <div className="px-2 py-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span className="truncate font-medium">{profile.name}</span>{!profile.apiKey && <span className="shrink-0">未填写密钥</span>}</div>
          {models.map(model => {
            const checked = selection?.profileId === profile.id && selection.model === model;
            const favorite = normalizeModelNames(profile.favoriteModels).includes(model);
            return <div key={model} className={cn('flex min-w-0 items-center rounded-md', checked && 'bg-accent')}>
              <button type="button" disabled={!isLLMConfigured({ ...profile, model })} aria-label={`使用 ${profile.name} 的 ${model}`} aria-pressed={checked}
                onClick={() => choose({ profileId: profile.id, model })} className="min-w-0 flex-1 flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent disabled:opacity-45 disabled:cursor-not-allowed">
                <span className="w-4 shrink-0">{checked && <Check className="h-4 w-4 text-primary" />}</span><span className="min-w-0 truncate" title={model}>{model}</span>
              </button>
              <Button variant="ghost" size="icon" className="shrink-0" aria-label={`${favorite ? '取消常用' : '设为常用'} ${profile.name} 的 ${model}`} aria-pressed={favorite}
                onClick={() => setProfileModelFavorite(profile.id, model, !favorite)}><Star className={cn('h-3.5 w-3.5', favorite && 'fill-primary text-primary')} /></Button>
            </div>;
          })}
        </section>)}
        {!groups.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{profiles.length ? '没有匹配的模型，可添加自定义名称。' : '还没有服务配置，请先添加服务。'}</p>}
      </div>
      <div className="border-t border-border p-2 space-y-2">
        {!query && <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowAll(current => !current)}>{showAll ? '只看常用与当前模型' : '查看全部已获取模型'}</Button>}
        <div className="flex items-center gap-2"><Button variant="ghost" size="sm" className="flex-1" disabled={!profiles.length} onClick={() => setCustomOpen(current => !current)}><Plus className="h-3.5 w-3.5 mr-1" />自定义模型</Button>
          <Button variant="ghost" size="sm" className="flex-1" onClick={() => { setOpen(false); if (onManage) onManage(); else { saveSettingsSection('ai'); navigate('/settings'); } }}><Settings2 className="h-3.5 w-3.5 mr-1" />管理服务</Button></div>
        {customOpen && <div className="rounded-md border border-border p-2 space-y-2">
          <select aria-label="自定义模型所属服务" className="ste-select h-8 w-full text-xs" value={customTarget?.id ?? ''} onChange={event => setCustomProfile(event.target.value)}>
            {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
          <Input aria-label="自定义模型名称" value={customModel} onChange={event => setCustomModel(event.target.value)} placeholder="填写服务要求的完整模型 ID" />
          <Button size="sm" className="w-full" disabled={!customModel.trim() || !customTarget || !isLLMConfigured({ ...customTarget, model: customModel })} onClick={() => { if (!customTarget) return; setProfileModelFavorite(customTarget.id, customModel, true); choose({ profileId: customTarget.id, model: customModel.trim() }); }}>加入常用并使用</Button>
        </div>}
      </div>
    </PopoverContent>
  </Popover>;
}
