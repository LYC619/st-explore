import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { FileUp, Play, Save, Download, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PanelSkeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { emptyFrontend, frontendPreview, frontendSnapshot, importFrontendFile, newHtmlRule, type FrontendDraft, type FrontendDiagnostic } from '@/lib/frontend-workbench';
import { VariableInspector } from '@/components/VariableInspector';
import { previewSample, type PreviewSample } from '@/lib/variable-inspector';
import { loadFrontend, saveFrontend } from '@/lib/frontend-workbench-store';
import { getVaultEpoch } from '@/lib/vault/active';

export interface FrontendWorkbenchHandle { save(): Promise<boolean> }
interface Props { storyId: string; branchId: string | null; onDirty(value: boolean): void; onBusy(value: boolean): void }
const selectClass = 'ste-select h-10 w-full min-w-0 text-sm';
export const FrontendWorkbench = forwardRef<FrontendWorkbenchHandle, Props>(function FrontendWorkbench({ storyId, branchId, onDirty, onBusy }, ref) {
  useI18n();
  const { toast } = useToast();
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof loadFrontend>>>();
  const [draft, setDraft] = useState<FrontendDraft>(emptyFrontend);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'html' | 'scripts' | 'variables' | 'notes'>('html');
  const [mobile, setMobile] = useState<'edit' | 'preview'>('edit');
  const [preview, setPreview] = useState('');
  const [previewLabel, setPreviewLabel] = useState('');
  const [diagnostics, setDiagnostics] = useState<FrontendDiagnostic[]>([]);
  const [viewport, setViewport] = useState('fit');
  const [sample, setSample] = useState<PreviewSample>('original');
  const [compareFloor, setCompareFloor] = useState<number | null>(null);
  const [compareCandidate, setCompareCandidate] = useState(0);
  const [inspectorSource, setInspectorSource] = useState<'floor' | 'sample'>('floor');
  const htmlEditor = useRef<HTMLTextAreaElement>(null);
  const frame = useRef<HTMLIFrameElement>(null), token = useRef(''), inFlight = useRef(false), alive = useRef(true);
  const dirty = !!loaded && JSON.stringify(draft) !== saved;
  const rule = draft.rules[draft.selectedRule];
  const showError = (e: unknown) => { const message = e instanceof Error ? e.message : String(e); setError(message); toast({ title: tr("操作未完成"), description: message, variant: 'destructive' }); };
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  useEffect(() => {
    alive.current = true; const epoch = getVaultEpoch();
    void loadFrontend(storyId, branchId).then(result => {
      if (!alive.current || epoch !== getVaultEpoch()) return;
      setLoaded(result); setDraft(result.state.draft); setSaved(JSON.stringify(result.state.draft));
    }).catch(e => { if (alive.current) showError(e); });
    return () => { alive.current = false; };
    // The parent remounts this editor on story, branch or explicit reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, branchId]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.token !== token.current || event.data?.type !== 'ste-frontend-preview') return;
      const diagnostic = event.data.diagnostic;
      if (!diagnostic || !['ready', 'error', 'resource', 'variables', 'console'].includes(diagnostic.kind)) return;
      setDiagnostics(items => [...items.slice(-49), { kind: diagnostic.kind, message: String(diagnostic.message).slice(0, 1500),
        source: typeof diagnostic.source === 'string' ? diagnostic.source.slice(0, 1000) : undefined,
        line: Number.isSafeInteger(diagnostic.line) && diagnostic.line > 0 ? diagnostic.line : undefined,
        column: Number.isSafeInteger(diagnostic.column) && diagnostic.column > 0 ? diagnostic.column : undefined }]);
    };
    window.addEventListener('message', listener); return () => window.removeEventListener('message', listener);
  }, []);
  const patch = (value: Partial<FrontendDraft>) => setDraft(current => ({ ...current, ...value }));
  const updateRule = (value: Partial<FrontendDraft['rules'][number]['script']>) => setDraft(current => ({ ...current,
    rules: current.rules.map((item, index) => index === current.selectedRule ? { ...item, script: { ...item.script, ...value } } : item) }));
  async function save(operation: 'draft' | 'apply' | 'remove' = 'draft') {
    if (!loaded || inFlight.current) return false;
    inFlight.current = true; setBusy(true); setError(''); const epoch = getVaultEpoch();
    try {
      const text = await saveFrontend(storyId, branchId, draft, loaded.text, loaded.revision, operation);
      if (!alive.current || epoch !== getVaultEpoch()) return false;
      setLoaded({ ...loaded, text, state: JSON.parse(text) }); setSaved(JSON.stringify(draft));
      toast({ title: operation === 'draft' ? tr("草稿已保存") : operation === 'apply' ? tr("已应用到当前故事／分支") : tr("已撤下本分支成品前端"), description: operation === 'draft' ? tr("聊天仍使用上一次应用内容。") : tr("重新进入聊天后生效。") });
      return true;
    } catch (e) { if (alive.current) showError(e); return false; }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  useImperativeHandle(ref, () => ({ save: () => save() }));
  async function importFiles(files: File[]) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); const epoch = getVaultEpoch();
    try {
      let next = draft;
      for (const file of files) {
        if (file.size > 2 * 1024 * 1024) throw new Error(tr("单份材料不能超过 2 MiB"));
        next = importFrontendFile(next, file.name, await file.text());
      }
      if (alive.current && epoch === getVaultEpoch()) { setDraft(next); setError(''); }
    } catch (e) { if (alive.current) showError(e); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  function runPreview(fromStory: boolean) {
    try {
      if (!rule) throw new Error(tr("请先读取或添加 HTML 正则"));
      const snapshot = fromStory && loaded ? frontendSnapshot(loaded.session, draft.floor, draft.candidate) : undefined;
      token.current = crypto.randomUUID(); setDiagnostics([]);
      const data = snapshot?.data ?? JSON.parse(draft.variables);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(tr("预览变量必须是 JSON 对象"));
      setPreview(frontendPreview(rule.script.replaceString, JSON.stringify(previewSample(data, sample)), snapshot, token.current));
      setPreviewLabel((snapshot ? tr("楼层 {{v0}} · 候选 {{v1}}", { v0: snapshot.index, v1: snapshot.candidate + 1 }) : tr("示例变量副本")) + ' · ' + ({ original: tr("原始值"), empty: tr("空对象"), long: tr("长文本"), extreme: tr("极端数值／开关反转") })[sample]);
      setMobile('preview'); setError('');
    } catch (e) { showError(e); }
  }
  function exportDraft() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = tr("成品前端工作副本.json"); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!loaded) return error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <PanelSkeleton />;
  const floor = draft.floor < 0 ? loaded.session.messages.length - 1 : draft.floor;
  const message = loaded.session.messages[floor];
  const comparisonFloor = compareFloor ?? Math.max(0, floor - 1);
  const comparisonMessage = loaded.session.messages[comparisonFloor];
  const currentSnapshot = frontendSnapshot(loaded.session, floor, draft.candidate);
  const comparisonSnapshot = frontendSnapshot(loaded.session, comparisonFloor, compareFloor === null ? comparisonMessage?.rawData?.swipe_id ?? 0 : compareCandidate);
  let inspected: unknown = currentSnapshot.data, variableError = '';
  if (inspectorSource === 'sample') { try { inspected = JSON.parse(draft.variables); } catch { variableError = tr("示例 JSON 无效，请先修正编辑内容。"); } }
  function locate(diagnostic: FrontendDiagnostic) {
    setTab('html'); setMobile('edit');
    requestAnimationFrame(() => { const editor = htmlEditor.current; if (!editor || !diagnostic.line) return;
      const lines = editor.value.split('\n'); const offset = lines.slice(0, diagnostic.line - 1).reduce((n, line) => n + line.length + 1, 0) + (diagnostic.column ?? 1) - 1;
      editor.focus(); editor.setSelectionRange(offset, Math.min(editor.value.length, offset + 1)); editor.scrollTop = Math.max(0, (diagnostic.line - 5) * 20); });
  }
  return <section className="space-y-4" data-frontend-workbench>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3">
      <div className="min-w-0 text-sm"><p>{tr("主绑定世界书：")}{loaded.primaryWorldbook} <span className="ml-3 text-muted-foreground">{loaded.helperVersion ? tr("原版助手 {{v0}}", { v0: loaded.helperVersion }) : tr("内置助手 · 完整脚本请先安装原版助手")}</span></p>
        <p className="mt-1 text-xs text-muted-foreground break-all">{tr("来源：")}{draft.source || tr("尚未读取")} · {dirty ? tr("有未保存修改") : tr("草稿已保存")} · {loaded.state.applied ? tr("已有应用内容") : tr("尚未应用")}</p></div>
      <div className="flex gap-2"><Button size="sm" variant="outline" onClick={exportDraft}><Download className="h-4 w-4 mr-1" />{tr("导出工作副本")}</Button>
        <Button size="sm" disabled={busy} onClick={() => void save()}><Save className="h-4 w-4 mr-1" />{tr("保存草稿")}</Button></div>
    </div>
    <fieldset disabled={busy} className="space-y-4 min-w-0">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setDraft(current => ({ ...current, source: loaded.source.source, rules: loaded.source.rules, scripts: loaded.source.scripts }))} disabled={dirty || busy}>{tr("读取角色现有正则／脚本")}</Button>
        <Label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[color:var(--border-normal)] bg-[var(--bg-elevated)] px-3 py-2 text-sm hover:border-[color:var(--brand-hairline)]"><FileUp className="h-4 w-4 text-brand" />{tr("添加本地材料")}<input aria-label={tr("添加本地前端材料")} type="file" multiple accept=".html,.htm,.json,.js,.yaml,.yml,.txt" className="sr-only" onChange={e => { void importFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} /></Label>
        <Button variant="ghost" onClick={() => setDraft(current => ({ ...current, rules: [...current.rules, newHtmlRule('<div>状态栏</div>', tr("新状态栏"))], selectedRule: current.rules.length }))}>{tr("新建 HTML")}</Button>
      </div>
      <div className="flex gap-2 lg:hidden"><Button size="sm" variant={mobile === 'edit' ? 'secondary' : 'ghost'} onClick={() => setMobile('edit')}>{tr("编辑")}</Button><Button size="sm" variant={mobile === 'preview' ? 'secondary' : 'ghost'} onClick={() => setMobile('preview')}>{tr("预览")}</Button></div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <div className={(mobile === 'edit' ? '' : 'hidden lg:block ') + 'min-w-0 space-y-3'}>
          <div className="flex flex-wrap border-b border-[color:var(--border-subtle)] pb-1" role="tablist" aria-label={tr("成品材料")}>{(['html', 'scripts', 'variables', 'notes'] as const).map((item, i) => <Button key={item} role="tab" aria-selected={tab === item} variant={tab === item ? 'secondary' : 'ghost'} onClick={() => setTab(item)}>{[tr("HTML／正则"), tr("配套脚本"), tr("示例变量"), tr("更新规则／说明")][i]}</Button>)}</div>
          {tab === 'html' && <>
            <select className={selectClass} aria-label={tr("显示正则")} value={draft.selectedRule} onChange={e => patch({ selectedRule: Number(e.target.value) })}>{!draft.rules.length && <option value={0}>{tr("先读取成品或新建 HTML")}</option>}{draft.rules.map((item, index) => <option key={index} value={index}>{index + 1}. {item.script.scriptName}</option>)}</select>
            {rule && <><div className="grid grid-cols-2 gap-3"><div><Label htmlFor="frontend-rule-name">{tr("正则名称")}</Label><Input id="frontend-rule-name" value={rule.script.scriptName} onChange={e => updateRule({ scriptName: e.target.value })} /></div><div><Label htmlFor="frontend-find">{tr("匹配内容")}</Label><Input id="frontend-find" className="font-mono" value={rule.script.findRegex} onChange={e => updateRule({ findRegex: e.target.value })} /></div></div>
              <Label htmlFor="frontend-html">{tr("HTML／替换内容")}</Label><Textarea ref={htmlEditor} id="frontend-html" spellCheck={false} className="min-h-[390px] font-mono text-xs leading-5" value={rule.script.replaceString} onChange={e => updateRule({ replaceString: e.target.value })} />
              <details className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 text-sm"><summary className="cursor-pointer font-medium">{tr("正则生效范围与高级参数")}</summary><div className="mt-3 flex flex-wrap gap-4"><label className="tap-target inline-flex cursor-pointer items-center gap-2"><input type="checkbox" className="h-4 w-4 rounded accent-[var(--brand)]" checked={!rule.script.disabled} onChange={e => updateRule({ disabled: !e.target.checked })} />{tr(" 启用")}</label><label className="tap-target inline-flex cursor-pointer items-center gap-2"><input type="checkbox" className="h-4 w-4 rounded accent-[var(--brand)]" checked={!!rule.script.markdownOnly} onChange={e => updateRule({ markdownOnly: e.target.checked })} />{tr(" 仅显示")}</label><label className="tap-target inline-flex cursor-pointer items-center gap-2"><input type="checkbox" className="h-4 w-4 rounded accent-[var(--brand)]" checked={!!rule.script.promptOnly} onChange={e => updateRule({ promptOnly: e.target.checked })} />{tr(" 仅提示词")}</label></div><div className="grid grid-cols-2 gap-3 mt-3">{(['minDepth', 'maxDepth'] as const).map((key, i) => <label key={key} className="text-xs space-y-1 block">{i ? tr("最大楼层深度") : tr("最小楼层深度")}<Input type="number" min={0} value={rule.script[key] ?? ''} onChange={e => updateRule({ [key]: e.target.value === '' ? null : Number(e.target.value) })} /></label>)}</div><p className="mt-2 text-xs text-muted-foreground">{tr("生效对象：")}{rule.script.placement.join(', ')}{tr("；规则顺序与其他原始字段自动保留。")}</p></details></>}
          </>}
          {tab === 'scripts' && <div className="space-y-4"><p className="text-sm text-muted-foreground">{tr("配套脚本在原版助手中执行。读取后默认停用；勾选后随本分支前端一起应用。")}</p>{draft.scripts.map((script, index) => <div className="space-y-2 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5" key={script.id}><label className="tap-target flex gap-2 items-center cursor-pointer font-medium text-sm"><input type="checkbox" className="h-4 w-4 rounded accent-[var(--brand)]" checked={script.enabled} onChange={e => patch({ scripts: draft.scripts.map((s, i) => i === index ? { ...s, enabled: e.target.checked } : s) })} />{script.name}</label><Textarea aria-label={script.name + tr(" 源码")} className="font-mono text-xs" rows={10} value={script.content} onChange={e => patch({ scripts: draft.scripts.map((s, i) => i === index ? { ...s, content: e.target.value } : s) })} /></div>)}{!draft.scripts.length && <p className="text-muted-foreground text-sm">{tr("可添加 JavaScript 或助手脚本 JSON。")}</p>}</div>}
          {tab === 'variables' && <>
            <div className="grid grid-cols-2 gap-2"><label className="text-xs">{tr("观察来源")}<select aria-label={tr("变量观察来源")} className={selectClass} value={inspectorSource} onChange={e => setInspectorSource(e.target.value as 'floor' | 'sample')}><option value="floor">{tr("预览所选楼层／候选")}</option><option value="sample">{tr("示例变量")}</option></select></label>
              <label className="text-xs">{tr("对照楼层")}<select aria-label={tr("变量对照楼层")} className={selectClass} value={compareFloor ?? 'previous'} onChange={e => { setCompareFloor(e.target.value === 'previous' ? null : Number(e.target.value)); setCompareCandidate(0); }}><option value="previous">{tr("前一楼（当前候选）")}</option>{loaded.session.messages.map((m, i) => <option key={m.id} value={i}>{i} · {m.name ?? m.role}</option>)}</select></label></div>
            {compareFloor !== null && <select aria-label={tr("变量对照候选")} className={selectClass} value={compareCandidate} onChange={e => setCompareCandidate(Number(e.target.value))}>{Array.from({ length: Math.max(1, comparisonMessage?.rawData?.swipes?.length ?? 0) }, (_, i) => <option key={i} value={i}>{tr("对照候选 {{v0}}", { v0: i + 1 })}</option>)}</select>}
            {variableError ? <p role="alert" className="text-sm text-destructive">{variableError}</p> : <VariableInspector value={inspected} before={comparisonSnapshot.data} label={inspectorSource === 'sample' ? tr("示例变量") : tr("楼层 {{v0}} · 候选 {{v1}}", { v0: floor, v1: draft.candidate + 1 })} beforeLabel={tr("楼层 {{v0}} · 候选 {{v1}}", { v0: comparisonSnapshot.index, v1: comparisonSnapshot.candidate + 1 })} />}
            <details><summary className="cursor-pointer text-sm">{tr("编辑示例变量 JSON")}</summary><Label htmlFor="frontend-variables">{tr("示例变量 JSON")}</Label><Textarea id="frontend-variables" className="min-h-[260px] font-mono text-xs" value={draft.variables} onChange={e => patch({ variables: e.target.value })} /></details><p className="text-xs text-muted-foreground">{tr("读取已保存的楼层／候选快照。示例和边界数据只用于预览，不写回故事。生成、变量更新和保存顺序可在聊天「过程」查看。")}</p></>}
          {tab === 'notes' && <><Label htmlFor="frontend-notes">{tr("更新规则／说明材料")}</Label><Textarea id="frontend-notes" className="min-h-[420px] font-mono text-xs" value={draft.notes} onChange={e => patch({ notes: e.target.value })} /><p className="text-xs text-muted-foreground">{tr("保留为工作材料；世界书条目继续在世界书编辑器管理。")}</p></>}
        </div>
        <div className={(mobile === 'preview' ? '' : 'hidden lg:block ') + 'min-w-0 space-y-3'}>
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{tr("预览")}</h3><Button variant="outline" size="sm" onClick={() => runPreview(false)}><Play className="h-4 w-4 mr-1" />{tr("使用示例变量")}</Button></div>
          <div className="flex flex-wrap gap-2"><select aria-label={tr("预览楼层")} className={selectClass + ' flex-1 !w-auto'} value={draft.floor} onChange={e => { const index = Number(e.target.value); patch({ floor: index, candidate: loaded.session.messages[index < 0 ? loaded.session.messages.length - 1 : index]?.rawData?.swipe_id ?? 0 }); }}><option value={-1}>{tr("最后一楼")}</option>{loaded.session.messages.map((m, i) => <option key={m.id} value={i}>{i} · {m.name ?? m.role}</option>)}</select><select aria-label={tr("预览候选")} className={selectClass + ' flex-1 !w-auto'} value={draft.candidate} onChange={e => patch({ candidate: Number(e.target.value) })}>{Array.from({ length: Math.max(1, message?.rawData?.swipes?.length ?? 0) }, (_, i) => <option key={i} value={i}>{tr("候选 {{v0}}", { v0: i + 1 })}</option>)}</select><Button size="sm" variant="outline" onClick={() => runPreview(true)}>{tr("读取楼层快照")}</Button></div>
          <div className="grid grid-cols-2 gap-2"><label className="text-xs">{tr("预览尺寸")}<select aria-label={tr("预览尺寸")} className={selectClass} value={viewport} onChange={e => setViewport(e.target.value)}><option value="fit">{tr("适应面板")}</option><option value="desktop">{tr("桌面 · 960 × 600")}</option><option value="mobile">{tr("手机 · 390 × 700")}</option></select></label><label className="text-xs">{tr("下次预览数据")}<select aria-label={tr("预览测试数据")} className={selectClass} value={sample} onChange={e => setSample(e.target.value as PreviewSample)}><option value="original">{tr("原始值")}</option><option value="empty">{tr("空对象")}</option><option value="long">{tr("长文本")}</option><option value="extreme">{tr("极端数值／开关反转")}</option></select></label></div>
          <div className="overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)]"><div className="border-b border-[color:var(--hairline-inner)] px-3 py-2 text-xs text-[color:var(--text-muted)]">{previewLabel || tr("示例变量")}</div><div className="overflow-auto bg-chrome">{preview ? <iframe ref={frame} title={tr("成品前端预览")} sandbox="allow-scripts" srcDoc={preview} className="mx-auto border-0 bg-background" style={{ width: viewport === 'desktop' ? 960 : viewport === 'mobile' ? 390 : '100%', height: viewport === 'mobile' ? 700 : viewport === 'desktop' ? 600 : 480 }} /> : <div className="flex h-[480px] items-center justify-center px-8 text-center text-sm text-[color:var(--text-muted)]">{tr("读取或新建 HTML 后，选择示例变量或楼层快照开始预览。")}</div>}</div></div>
          <p className="text-xs leading-5 text-muted-foreground">{tr("此处检查布局和字段显示；使用变量读取的兼容接口，配套脚本不在此执行。完整 MVU 和外部模块效果请应用后进入聊天查看。")}</p>
          {!!diagnostics.length && <details open={diagnostics.some(d => d.kind === 'error' || d.kind === 'resource')} className="text-xs text-muted-foreground"><summary>{tr("预览诊断（最近 {{v0}} 条）", { v0: diagnostics.length })}</summary><ul className="mt-2 max-h-52 overflow-auto space-y-2 break-all">{diagnostics.map((item, i) => <li key={i} className={item.kind === 'error' || item.kind === 'resource' ? 'text-destructive' : ''}>{item.message}{item.source && <span> · {item.source === '当前 HTML' ? tr("当前 HTML") : item.source}</span>}{item.line && <span>:{item.line}:{item.column ?? 1}</span>}{item.source === '当前 HTML' && item.line && <button type="button" className="ml-2 underline" onClick={() => locate(item)}>{tr("定位源码")}</button>}</li>)}</ul></details>}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-sm text-muted-foreground">{tr("应用 {{v0}} 条正则、{{v1}} 个启用脚本。楼层变量保持当前进度。", { v0: draft.rules.length, v1: draft.scripts.filter(s => s.enabled).length })}</p><div className="flex gap-2"><Button variant="ghost" disabled={!loaded.state.applied || busy} onClick={() => void save('remove')}><Undo2 className="h-4 w-4 mr-1" />{tr("撤下应用")}</Button><Button disabled={busy || !draft.rules.length && !draft.scripts.length} onClick={() => void save('apply')}>{tr("应用到当前故事／分支")}</Button></div></div>
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
});
