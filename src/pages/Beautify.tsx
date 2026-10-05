import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router-dom';
import { Palette, Save, MessageSquare, FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { listStoryIndex, type StoryIndexEntry } from '@/lib/archive-index';
import { getEditorStoryId, setEditorStoryId } from '@/lib/editor-story-context';
import { subscribeActiveVault, getVaultEpoch } from '@/lib/vault/active';
import { DEFAULT_BEAUTIFY, buildStatusPreview, normalizeBeautifyConfig, type BeautifyConfig } from '@/lib/beautify';
import { loadBeautify, saveBeautify } from '@/lib/beautify-store';
import { importHelperScripts, type HelperScript } from '@/lib/roleplay/helper-settings';
import { prepareStoryPlay } from '@/lib/roleplay/open-story';

const fieldsText = (config: BeautifyConfig) => config.fields.map(field => field.label + ' | ' + field.path).join('\n');
const signature = (config: BeautifyConfig, fields: string, variables: string, imports: HelperScript[]) => JSON.stringify([config, fields, variables, imports]);
const selectClass = 'h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm';

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
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const saveInFlight = useRef(false);
  const allowNavigationRef = useRef(false);
  const dirty = !loading && !loadError && !!savedSignature && signature(config, fields, variables, imports) !== savedSignature;
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
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
        <div><h1 className="text-2xl font-semibold flex items-center gap-2"><Palette className="h-6 w-6 text-primary" />美化</h1>
          <p className="mt-2 text-sm text-muted-foreground">为故事配置状态栏与变量更新，边编辑边预览。</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!storyId || loading || !!loadError || saving} onClick={openChat}><MessageSquare className="h-4 w-4 mr-2" />进入聊天</Button>
          <Button disabled={!storyId || loading || !!loadError || !parsed.config || saving} onClick={() => { void save(); }}><Save className="h-4 w-4 mr-2" />{saving ? '保存中…' : '保存配置'}</Button>
        </div>
      </header>
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1 flex-1 min-w-40"><Label htmlFor="beautify-story">故事</Label>
          <select id="beautify-story" className={selectClass + ' w-full'} value={storyId} disabled={saving}
            onChange={event => { const id = event.target.value; changeContext(() => { setStoryId(id); setBranchId(null); }); }}>
            <option value="">选择故事…</option>{stories.map(story => <option key={story.id} value={story.id}>{story.title}</option>)}
          </select></div>
        <div className="space-y-1 flex-1 min-w-40"><Label htmlFor="beautify-branch">分支</Label>
          <select id="beautify-branch" className={selectClass + ' w-full'} value={branchId ?? ''} disabled={!storyId || saving}
            onChange={event => { const id = event.target.value || null; changeContext(() => setBranchId(id)); }}>
            <option value="">主线</option>{currentStory?.branchIndex?.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select></div>
        <Button variant="ghost" disabled={saving} onClick={() => changeContext(() => setReload(value => value + 1))}>重新载入</Button>
      </div>
      {loadError && <p role="alert" className="text-destructive">{loadError}</p>}
      {!storyId ? <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">选择已归档的故事开始配置。每条分支独立保存美化设置。</div> : loading ? <p>正在读取配置…</p> : !loadError && <>
        <div className="grid gap-6 lg:grid-cols-2">
          <fieldset disabled={saving} className="min-w-0 space-y-5">
            <section className="rounded-xl border p-5 space-y-4">
              <div className="flex items-center justify-between"><h2 className="font-medium">状态栏</h2><Switch aria-label="启用状态栏" checked={config.statusEnabled} onCheckedChange={statusEnabled => setConfig(c => ({ ...c, statusEnabled }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label htmlFor="beautify-mode">显示方式</Label><select id="beautify-mode" className={selectClass + ' w-full'} value={config.mode} onChange={e => setConfig(c => ({ ...c, mode: e.target.value as BeautifyConfig['mode'] }))}><option value="inline">输入框上方</option><option value="floating">悬浮状态栏</option></select></div>
                <div className="space-y-1"><Label htmlFor="beautify-source">变量来源</Label><select id="beautify-source" className={selectClass + ' w-full'} value={config.source} onChange={e => setConfig(c => ({ ...c, source: e.target.value as BeautifyConfig['source'] }))}><option value="message">最近楼层 · stat_data</option><option value="chat">聊天变量</option></select></div>
              </div>
              <div className="flex gap-3"><div className="flex-1 space-y-1"><Label htmlFor="beautify-title">标题</Label><Input id="beautify-title" value={config.title} onChange={e => setConfig(c => ({ ...c, title: e.target.value }))} /></div>
                <div className="space-y-1"><Label htmlFor="beautify-color">强调色</Label><Input id="beautify-color" type="color" className="w-14 p-1" value={config.color} onChange={e => setConfig(c => ({ ...c, color: e.target.value }))} /></div></div>
              <div className="space-y-1"><Label htmlFor="beautify-fields">显示字段</Label><Textarea id="beautify-fields" rows={5} value={fields} onChange={e => setFields(e.target.value)} className="font-mono text-sm" />
                <p className="text-xs text-muted-foreground">每行“名称 | 变量路径”，例如“好感度 | 角色.好感度”。路径从 stat_data 内开始。</p></div>
            </section>
            <section className="rounded-xl border p-5 space-y-3">
              <div className="flex justify-between items-center"><h2 className="font-medium">MVU · JSON Patch 更新</h2><Switch aria-label="启用 MVU 更新" checked={config.mvuEnabled} onCheckedChange={mvuEnabled => setConfig(c => ({ ...c, mvuEnabled }))} /></div>
              <p className="text-sm text-muted-foreground">读取回复中 JSONPatch 标签里的 add / replace / remove 操作，更新当前楼层的 stat_data。各分支、候选回复分别保留变量。</p>
              <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">支持格式与兼容范围</summary><pre className="mt-2 whitespace-pre-wrap break-all rounded bg-muted p-3">{'<JSONPatch>\n[{"op":"replace","path":"/trust","value":10}]\n</JSONPatch>'}</pre><p className="mt-2">需要模型按此格式输出。此内置模块不执行 _.set 等脚本语句；依赖外部模块或完整 Mvu API 的第三方脚本需另行适配。开启时会处理当前最后一条符合格式的回复。</p></details>
            </section>
            <section className="rounded-xl border p-5 space-y-3">
              <Label htmlFor="beautify-variables">初始变量 / 预览样本（JSON 对象）</Label>
              <Textarea id="beautify-variables" value={variables} onChange={e => setVariables(e.target.value)} rows={7} className="font-mono text-sm" />
              <p className="text-xs text-muted-foreground">已有楼层变量优先使用；这里的初始值用于没有变量记录时及右侧预览。</p>
            </section>
          </fieldset>
          <div className="min-w-0 space-y-4">
            <section className="rounded-xl border bg-muted/20 p-5 space-y-4 lg:sticky lg:top-4">
              <div className="flex justify-between items-center"><h2 className="font-medium">预览</h2><span className="text-xs text-muted-foreground">{dirty ? '有未保存修改' : '已载入配置'}</span></div>
              {parsed.error ? <p role="alert" className="text-sm text-destructive">{parsed.error}</p> : <div className={'rounded-lg border overflow-hidden shadow-sm ' + (config.mode === 'floating' ? 'max-w-sm ml-auto' : '')}>
                <iframe title="状态栏预览" sandbox="" srcDoc={parsed.html} className="w-full h-80 border-0" />
              </div>}
              <p className="text-xs text-muted-foreground">预览使用左侧样本。保存并进入聊天后，状态栏读取当前故事的实际变量。</p>
            </section>
            <section className="rounded-xl border p-5 space-y-3">
              <h2 className="font-medium">已有助手脚本</h2>
              <p className="text-sm text-muted-foreground">可导入脚本 JSON；保存后在聊天“脚本”面板查看内容、授权和启用。</p>
              <Label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"><FileUp className="h-4 w-4" />导入脚本 JSON
                <input type="file" accept=".json" className="sr-only" disabled={saving} onChange={e => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = ''; }} /></Label>
              <ul className="space-y-2 text-sm">{[...savedScripts.filter(s => !s.id.startsWith('ste-beautify-')), ...imports].map((script, index) =>
                <li key={script.id + index} className="flex justify-between gap-2 border-b pb-2"><span className="break-all">{script.name}</span><span className="text-xs text-muted-foreground shrink-0">{imports.includes(script) ? '待保存 · 未启用' : script.enabled ? '已启用' : '未启用'}</span></li>)}</ul>
              {!!imports.length && <Button variant="ghost" size="sm" disabled={saving} onClick={() => setImports([])}>撤销本次导入</Button>}
            </section>
          </div>
        </div>
      </>}
      <AlertDialog open={pendingAction !== null || blocker.state === 'blocked'}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>保存美化修改？</AlertDialogTitle><AlertDialogDescription>离开前可以保存当前配置，或放弃这次未保存的修改。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><Button variant="ghost" disabled={saving} onClick={() => { setPendingAction(null); if (blocker.state === 'blocked') blocker.reset(); }}>留在此页</Button>
            <Button variant="outline" disabled={saving} onClick={finishTransition}>放弃修改</Button>
            <Button disabled={saving || !parsed.config} onClick={() => { void save().then(saved => { if (saved) finishTransition(); }); }}>保存并继续</Button></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  </div>;
}
