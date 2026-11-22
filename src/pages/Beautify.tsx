import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router-dom';
import { Palette, Save, MessageSquare, FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { PanelSkeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { listStoryIndex, type StoryIndexEntry } from '@/lib/archive-index';
import { getEditorStoryId, setEditorStoryId } from '@/lib/editor-story-context';
import { subscribeActiveVault, getVaultEpoch } from '@/lib/vault/active';
import { DEFAULT_BEAUTIFY, buildStatusPreview, normalizeBeautifyConfig, type BeautifyConfig } from '@/lib/beautify';
import { loadBeautify, saveBeautify } from '@/lib/beautify-store';
import { importHelperScripts, type HelperScript } from '@/lib/roleplay/helper-settings';
import { FrontendWorkbench, type FrontendWorkbenchHandle } from '@/components/FrontendWorkbench';
import { prepareStoryPlay } from '@/lib/roleplay/open-story';

const fieldsText = (config: BeautifyConfig) => config.fields.map(field => field.label + ' | ' + field.path).join('\n');
const signature = (config: BeautifyConfig, fields: string, variables: string, imports: HelperScript[]) => JSON.stringify([config, fields, variables, imports]);
const selectClass = 'ste-select h-10 min-w-0 text-sm';

export default function Beautify() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [stories, setStories] = useState<StoryIndexEntry[]>([]);
  const [storyId, setStoryId] = useState(getEditorStoryId() ?? '');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [config, setConfig] = useState<BeautifyConfig>(structuredClone(DEFAULT_BEAUTIFY));
  const [fields, setFields] = useState(fieldsText(DEFAULT_BEAUTIFY));
  const [variables, setVariables] = useState(JSON.stringify(DEFAULT_BEAUTIFY.initialData, null, 2));
  const [imports, setImports] = useState<HelperScript[]>([]);
  const [savedScripts, setSavedScripts] = useState<HelperScript[]>([]);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [savedSignature, setSavedSignature] = useState('');
  const [loading, setLoading] = useState(true);
  const [templateSaving, setSaving] = useState(false);
  const [mode, setMode] = useState<'frontend' | 'template'>('frontend');
  const [frontendDirty, setFrontendDirty] = useState(false);
  const [frontendBusy, setFrontendBusy] = useState(false);
  const frontendRef = useRef<FrontendWorkbenchHandle>(null);
  const saving = templateSaving || frontendBusy;
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const saveInFlight = useRef(false);
  const allowNavigationRef = useRef(false);
  const templateDirty = !loading && !loadError && !!savedSignature && signature(config, fields, variables, imports) !== savedSignature;
  const dirty = templateDirty || frontendDirty;
  const blocker = useBlocker(() => (dirty || saving) && !allowNavigationRef.current);
  const currentStory = stories.find(story => story.id === storyId);
  const showError = (error: unknown) => toast({ title: '操作未完成', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });

  useEffect(() => subscribeActiveVault(() => {
    setSavedSignature('');
    setStoryId('');
    setBranchId(null);
    setReload(value => value + 1);
  }), []);
  useEffect(() => {
    let active = true;
    const epoch = getVaultEpoch();
    void listStoryIndex().then(items => {
      if (!active || epoch !== getVaultEpoch()) return;
      setStories(items);
      setStoryId(id => items.some(item => item.id === id) ? id : '');
      if (!items.length) setLoading(false);
    }).catch(error => { if (active) { setLoadError(String(error)); setLoading(false); } });
    return () => { active = false; };
  }, [reload]);
  useEffect(() => {
    let active = true;
    const epoch = getVaultEpoch();
    setLoading(true); setLoadError(''); setSavedSignature('');
    allowNavigationRef.current = false;
    if (!storyId) { setLoading(false); return; }
    void loadBeautify(storyId, branchId).then(result => {
      if (!active || epoch !== getVaultEpoch()) return;
      const nextFields = fieldsText(result.config), nextVariables = JSON.stringify(result.config.initialData, null, 2);
      setConfig(result.config); setFields(nextFields); setVariables(nextVariables);
      setBaseline(result.text); setImports([]); setSavedScripts(result.settings.scripts);
      setSavedSignature(signature(result.config, nextFields, nextVariables, []));
      setEditorStoryId(storyId); setLoading(false);
    }).catch(error => { if (active) { setLoadError(error.message); setLoading(false); } });
    return () => { active = false; };
  }, [storyId, branchId, reload]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const parsed = useMemo(() => {
    try {
      const next = normalizeBeautifyConfig({ ...config, initialData: JSON.parse(variables),
        fields: fields.split('\n').filter(line => line.trim()).map(line => {
          const split = line.indexOf('|');
          return { label: (split < 0 ? line : line.slice(0, split)).trim(), path: (split < 0 ? line : line.slice(split + 1)).trim() };
        }) });
      return { config: next, error: '', html: buildStatusPreview(next, next.initialData) };
    } catch (error) { return { config: null, error: (error as Error).message, html: '' }; }
  }, [config, fields, variables]);

  const changeContext = (action: () => void) => {
    if (saving) return;
    if (dirty) setPendingAction(() => action);
    else action();
  };
  const save = async (): Promise<boolean> => {
    if (mode === 'frontend') return frontendRef.current?.save() ?? false;
    if (!parsed.config || !storyId || loading || loadError || saveInFlight.current) return false;
    saveInFlight.current = true; setSaving(true);
    const epoch = getVaultEpoch();
    try {
      const text = await saveBeautify(storyId, branchId, parsed.config, baseline, imports);
      if (epoch !== getVaultEpoch()) return false;
      setBaseline(text); setImports([]); setSavedScripts(JSON.parse(text).scripts);
      setSavedSignature(signature(config, fields, variables, []));
      toast({ title: '美化配置已保存', description: '进入当前故事聊天后生效；已打开的聊天需重新打开。' });
      return true;
    } catch (error) { showError(error); return false; }
    finally { saveInFlight.current = false; setSaving(false); }
  };
  const openChat = () => changeContext(() => {
    void prepareStoryPlay(storyId, branchId).then(target => navigate(target.path)).catch(showError);
  });
  const finishTransition = () => {
    const action = pendingAction;
    allowNavigationRef.current = true;
    setPendingAction(null);
    if (blocker.state === 'blocked') blocker.proceed();
    else action?.();
  };
  const importFile = async (file: File) => {
    const epoch = getVaultEpoch(), target = storyId + ':' + branchId;
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('脚本文件不能超过 4 MiB');
      const scripts = importHelperScripts(JSON.parse(await file.text()));
      if (epoch !== getVaultEpoch() || target !== contextRef.current) return;
      if (scripts.some(script => ['ste-beautify-status', 'ste-beautify-mvu'].includes(script.id))) throw new Error('脚本 ID 与内置美化模板冲突');
      setImports(previous => [...previous, ...scripts]);
    } catch (error) { showError(error); }
  };
  const contextRef = useRef(storyId + ':' + branchId);
  contextRef.current = storyId + ':' + branchId;

  return <div className="h-full overflow-y-auto" data-beautify-page>
    <div className="mx-auto max-w-6xl p-4 md:p-8 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--border-subtle)] pb-5">
        <div><h1 className="font-serif text-2xl font-semibold flex items-center gap-2 text-[color:var(--text-primary)]"><Palette className="h-6 w-6 text-brand" />状态栏与前端美化</h1>
          <p className="mt-1.5 text-sm text-[color:var(--text-muted)]">调试角色卡自带或自制的 HTML 状态栏、读取楼层变量实时预览，并按故事分支独立应用。</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!storyId || loading || !!loadError || saving} onClick={openChat}><MessageSquare className="h-4 w-4 mr-2" />进入聊天</Button>
          <Button disabled={!storyId || loading || !!loadError || (mode === 'template' && !parsed.config) || saving} onClick={() => { void save(); }}><Save className="h-4 w-4 mr-2" />{saving ? '保存中…' : mode === 'frontend' ? '保存草稿' : '保存配置'}</Button>
        </div>
      </header>
      <div className="flex flex-wrap gap-3 items-end rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
        <div className="space-y-1.5 flex-1 min-w-44"><Label htmlFor="beautify-story">选择故事</Label>
          <select id="beautify-story" className={selectClass + ' w-full'} value={storyId} disabled={saving}
            onChange={event => { const id = event.target.value; changeContext(() => { setStoryId(id); setBranchId(null); }); }}>
            <option value="">选择一篇已归档的故事…</option>{stories.map(story => <option key={story.id} value={story.id}>{story.title}</option>)}
          </select></div>
        <div className="space-y-1.5 flex-1 min-w-40"><Label htmlFor="beautify-branch">故事脉络</Label>
          <select id="beautify-branch" className={selectClass + ' w-full'} value={branchId ?? ''} disabled={!storyId || saving}
            onChange={event => { const id = event.target.value || null; changeContext(() => setBranchId(id)); }}>
            <option value="">主线</option>{currentStory?.branchIndex?.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select></div>
        <Button variant="ghost" disabled={saving} onClick={() => changeContext(() => setReload(value => value + 1))}>重新载入</Button>
      </div>
      <div className="flex gap-2 border-b border-[color:var(--border-subtle)] pb-3"><Button aria-pressed={mode === 'frontend'} variant={mode === 'frontend' ? 'secondary' : 'ghost'} disabled={saving} onClick={() => { if (mode === 'frontend') return; changeContext(() => { setMode('frontend'); setReload(value => value + 1); }); }}>成品前端</Button><Button aria-pressed={mode === 'template'} variant={mode === 'template' ? 'secondary' : 'ghost'} disabled={saving} onClick={() => { if (mode === 'template') return; changeContext(() => { setMode('template'); setReload(value => value + 1); }); }}>快捷状态栏模板</Button></div>
      {loadError && <p role="alert" className="text-destructive">{loadError}</p>}
      {!storyId ? <div className="rounded-xl border border-dashed border-[color:var(--border-normal)] bg-[var(--bg-elevated)] p-12 text-center text-[color:var(--text-muted)]">先在上方挑一篇已归档的故事开始调配；每条平行支线都会独立保存各自的状态栏与前端美化设置。</div> : loading ? <PanelSkeleton /> : !loadError && <>
        {mode === 'frontend' ? <FrontendWorkbench key={storyId + ':' + branchId + ':' + reload} ref={frontendRef} storyId={storyId} branchId={branchId} onDirty={setFrontendDirty} onBusy={setFrontendBusy} /> : <div className="grid gap-6 lg:grid-cols-2">
          <fieldset disabled={saving} className="min-w-0 space-y-5">
            <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-5 space-y-4">
              <div className="flex items-center justify-between"><h2 className="font-serif font-medium text-[color:var(--text-primary)]">简易状态栏</h2><Switch aria-label="启用状态栏" checked={config.statusEnabled} onCheckedChange={statusEnabled => setConfig(c => ({ ...c, statusEnabled }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label htmlFor="beautify-mode">展示位置</Label><select id="beautify-mode" className={selectClass + ' w-full'} value={config.mode} onChange={e => setConfig(c => ({ ...c, mode: e.target.value as BeautifyConfig['mode'] }))}><option value="inline">输入框上方</option><option value="floating">右上悬浮小窗</option></select></div>
                <div className="space-y-1.5"><Label htmlFor="beautify-source">数值读取来源</Label><select id="beautify-source" className={selectClass + ' w-full'} value={config.source} onChange={e => setConfig(c => ({ ...c, source: e.target.value as BeautifyConfig['source'] }))}><option value="message">最近一楼角色状态（stat_data）</option><option value="chat">整场聊天全局变量</option></select></div>
              </div>
              <div className="flex gap-3"><div className="flex-1 space-y-1.5"><Label htmlFor="beautify-title">面板标题</Label><Input id="beautify-title" value={config.title} onChange={e => setConfig(c => ({ ...c, title: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label htmlFor="beautify-color">点缀色</Label><Input id="beautify-color" type="color" className="h-10 w-16 cursor-pointer rounded-lg border-[color:var(--border-normal)] bg-[var(--bg-elevated)] p-1" value={config.color} onChange={e => setConfig(c => ({ ...c, color: e.target.value }))} /></div></div>
              <div className="space-y-1.5"><Label htmlFor="beautify-fields">状态栏条目</Label><Textarea id="beautify-fields" rows={5} value={fields} onChange={e => setFields(e.target.value)} className="font-mono text-sm" />
                <p className="text-xs text-[color:var(--text-muted)]">每行写一条“显示名称 | 变量路径”，例如“好感度 | 角色.好感度”。</p></div>
            </section>
            <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-5 space-y-3">
              <div className="flex justify-between items-center"><h2 className="font-serif font-medium text-[color:var(--text-primary)]">回复变量自动更新（MVU）</h2><Switch aria-label="启用 MVU 更新" checked={config.mvuEnabled} onCheckedChange={mvuEnabled => setConfig(c => ({ ...c, mvuEnabled }))} /></div>
              <p className="text-sm text-[color:var(--text-muted)]">自动识别模型回复末尾附带的数值变更块，按楼层与支线独立记录好感度、背包等角色状态。</p>
              <details className="text-xs text-[color:var(--text-muted)]"><summary className="cursor-pointer hover:text-[color:var(--text-body)]">查看支持的标签格式与说明</summary><pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-chrome p-3">{'<JSONPatch>\n[{"op":"replace","path":"/trust","value":10}]\n</JSONPatch>'}</pre><p className="mt-2">需配合预设或世界书提示模型输出 JSONPatch 标签；依赖完整原版助手脚本的复杂卡请在「成品前端」页签载入。</p></details>
            </section>
            <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-5 space-y-3">
              <Label htmlFor="beautify-variables">初始状态 / 预览样本（JSON）</Label>
              <Textarea id="beautify-variables" value={variables} onChange={e => setVariables(e.target.value)} rows={7} className="font-mono text-sm" />
              <p className="text-xs text-[color:var(--text-muted)]">故事已有楼层状态时优先使用实际进度；这里的初始值用于新开局兜底与右侧实时预览。</p>
            </section>
          </fieldset>
          <div className="min-w-0 space-y-4">
            <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-5 space-y-4 lg:sticky lg:top-4">
              <div className="flex justify-between items-center"><h2 className="font-serif font-medium text-[color:var(--text-primary)]">实时效果预览</h2><span className="text-xs text-[color:var(--text-muted)]">{dirty ? '有未保存修改' : '已载入配置'}</span></div>
              {parsed.error ? <p role="alert" className="text-sm text-destructive">{parsed.error}</p> : <div className={'rounded-lg border border-[color:var(--border-subtle)] overflow-hidden shadow-sm ' + (config.mode === 'floating' ? 'max-w-sm ml-auto' : '')}>
                <iframe title="状态栏预览" sandbox="" srcDoc={parsed.html} className="w-full h-80 border-0" />
              </div>}
              <p className="text-xs text-[color:var(--text-muted)]">当前使用左侧预览样本渲染；保存并进入酒馆聊天后，会自动读取故事的真实状态数值。</p>
            </section>
            <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-5 space-y-3">
              <h2 className="font-serif font-medium text-[color:var(--text-primary)]">已挂载助手脚本</h2>
              <p className="text-sm text-[color:var(--text-muted)]">可导入酒馆助手脚本 JSON；保存后可在酒馆聊天顶部的「脚本」面板查看授权与开关。</p>
              <Label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[color:var(--border-normal)] bg-chrome px-3 py-2 text-sm hover:border-[color:var(--brand-hairline)]"><FileUp className="h-4 w-4 text-brand" />导入脚本 JSON
                <input type="file" accept=".json" className="sr-only" disabled={saving} onChange={e => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = ''; }} /></Label>
              {[...savedScripts.filter(s => !s.id.startsWith('ste-beautify-')), ...imports].length === 0 ? (
                <p className="text-xs text-[color:var(--text-muted)]">当前分支暂未挂载额外助手脚本。</p>
              ) : (
                <ul className="space-y-2 text-sm">{[...savedScripts.filter(s => !s.id.startsWith('ste-beautify-')), ...imports].map((script, index) =>
                  <li key={script.id + index} className="flex justify-between gap-2 border-b border-[color:var(--hairline-inner)] pb-2"><span className="break-all">{script.name}</span><span className="text-xs text-muted-foreground shrink-0">{imports.includes(script) ? '待保存 · 未启用' : script.enabled ? '已启用' : '未启用'}</span></li>)}</ul>
              )}
              {!!imports.length && <Button variant="ghost" size="sm" disabled={saving} onClick={() => setImports([])}>撤销本次导入</Button>}
            </section>
          </div>
        </div>}
      </>}
      <AlertDialog open={pendingAction !== null || blocker.state === 'blocked'}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>保存当前修改？</AlertDialogTitle><AlertDialogDescription>离开前可以保存草稿或配置，或放弃这次未保存的修改。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><Button variant="ghost" disabled={saving} onClick={() => { setPendingAction(null); if (blocker.state === 'blocked') blocker.reset(); }}>留在此页</Button>
            <Button variant="outline" disabled={saving} onClick={finishTransition}>放弃修改</Button>
            <Button disabled={saving || (mode === 'template' && !parsed.config)} onClick={() => { void save().then(saved => { if (saved) finishTransition(); }); }}>保存并继续</Button></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  </div>;
}
