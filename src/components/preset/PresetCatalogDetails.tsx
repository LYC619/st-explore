import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, Upload, Save, Star, PenSquare, Download, SlidersHorizontal, Paperclip, Link, Trash2, X } from 'lucide-react';
import type { PresetCatalog, PresetItem, PresetPackageFile } from '@/types/preset';
import { getPreset, savePresetDetails, updatePreset } from '@/lib/preset-db';
import { inspectPresetScripts, normalizePresetCatalog } from '@/lib/preset-catalog';
import { exportPresetPackage, openPresetLocation, PACKAGE_KIND_LABELS, readPresetPackage } from '@/lib/preset-package';
import { getActiveVault, getVaultEpoch } from '@/lib/vault/active';
import { Button } from '@/components/ui/button';
import { renderNoteMarkdown } from '@/lib/note-markdown';
import { getPresetPresentation } from '@/lib/preset-presentation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PresetNotes } from './PresetNotes';
import { embedPresetAttachment } from '@/lib/preset-attachments';
import { presetContentFingerprint } from '@/lib/preset-catalog';
import { PresetCatalogFields } from './PresetCatalogFields';
import { PresetDiscardDialog } from './PresetDraftBoundary';
import type { AssetIndexEntry } from '@/lib/asset-index-entry';
import { PresetPlayground } from './PresetPlayground';
import { openExternalUrl } from '@/lib/roleplay/external-url';
import { LOADING_LABEL } from '@/lib/ui-copy';

export function PresetCatalogDetails({ id, onDirty, onEdit, onImport, onSaved, onDelete, full = false, versions = [], onVersion, onOpenFull, onClose }: {
  onOpenFull?: () => void; onClose?: () => void;
  full?: boolean; versions?: AssetIndexEntry[]; onVersion?: (id: string) => void;
  id: string; onDirty: (value: boolean) => void; onEdit: (id: string) => void;
  onImport: (seed: PresetCatalog) => void; onSaved: () => void; onDelete: () => void;
}) {
  const epoch = useRef(getVaultEpoch()).current;
  const live = useRef(true);
  const inFlight = useRef(false);
  const [editing, setEditing] = useState(false);
  const [trialOpened, setTrialOpened] = useState(false);
  const [trialVisible, setTrialVisible] = useState(false);
  const [opened, setOpened] = useState('');
  const [base, setBase] = useState<PresetItem | null>(null);
  const [catalog, setCatalog] = useState<PresetCatalog>({});
  const [files, setFiles] = useState<PresetPackageFile[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [reload, setReload] = useState(0), [confirmReload, setConfirmReload] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const dirty = !!base && (JSON.stringify(catalog) !== JSON.stringify(normalizePresetCatalog(base.catalog)) || JSON.stringify(files) !== JSON.stringify(base.packageFiles ?? []));
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    live.current = true;
    let active = true;
    setError('');
    void getPreset(id).then(item => {
      if (!active || epoch !== getVaultEpoch()) return;
      if (!item) throw new Error('预设已不存在，请刷新列表');
      setBase(item); setCatalog(normalizePresetCatalog(item.catalog)); setFiles(item.packageFiles ?? []);
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; live.current = false; };
  }, [id, epoch, reload]);
  const scripts = useMemo(() => base ? inspectPresetScripts(base.preset.originalData) : [], [base]);
  const newest = [...versions].sort((a, b) => (getPresetPresentation(b).version || '').localeCompare(getPresetPresentation(a).version || '', 'zh-CN', { numeric: true }) || b.createdAt - a.createdAt)[0];
  const latestId = newest?.id || id;
  const [latestNotes, setLatestNotes] = useState<{ id: string; text: string } | null>(null), [latestError, setLatestError] = useState('');
  useEffect(() => {
    let valid = true; setLatestNotes(null); setLatestError('');
    if (latestId !== id) void getPreset(latestId).then(item => {
      if (!item) throw new Error('最新版本已不存在');
      if (valid && epoch === getVaultEpoch()) setLatestNotes({ id: latestId, text: item.catalog?.releaseNotes || '' });
    }).catch(() => { if (valid) setLatestError('最新版本说明读取失败，请重新打开。'); });
    return () => { valid = false; };
  }, [latestId, id, epoch, reload]);
  const latestLoading = latestId !== id && latestNotes?.id !== latestId && !latestError;
  const authorNotes = latestId === id ? catalog.releaseNotes || '' : latestNotes?.text || '';
  const notesMarkup = useMemo(() => renderNoteMarkdown(authorNotes, `preset-${id}`), [authorNotes, id]);
  const act = async (action: () => Promise<string | void | null>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setMessage('');
    try {
      if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开预设');
      const result = await action();
      if (live.current && epoch === getVaultEpoch() && result) setMessage(result);
    } catch (e) { if (live.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; if (live.current) setBusy(false); }
  };
  const save = () => act(async () => {
    if (!base) return;
    const saved = await savePresetDetails(base, catalog, files);
    if (!live.current || epoch !== getVaultEpoch()) return;
    setBase(saved); setCatalog(normalizePresetCatalog(saved.catalog)); setFiles(saved.packageFiles ?? []); setEditing(false); onSaved();
    return '管理资料和附件已保存';
  });
  if (!base) return <div className="p-4 text-sm">{error || '正在读取预设…'}{error && <Button variant="outline" onClick={() => setReload(n => n + 1)}>重试</Button>}</div>;
  const identity = getPresetPresentation(base);
  const startEditing = () => {
    setCatalog(value => normalizePresetCatalog({ ...value, name: value.name ?? identity.displayName, author: value.author ?? identity.author, series: value.series ?? identity.series, version: value.version ?? identity.version, models: value.models ?? identity.models }));
    setEditing(true);
  };
  const resource = (key: string, title: string, content: string) => <div key={key} className="border-b border-[color:var(--border-subtle)]">
    <button className="w-full min-h-10 py-2 text-left text-sm flex items-center gap-2" aria-expanded={opened === key} onClick={() => setOpened(opened === key ? '' : key)}><span className="text-muted-foreground">{opened === key ? '−' : '+'}</span><span className="break-words min-w-0">{title}</span></button>
    {opened === key && <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed max-h-80 overflow-y-auto rounded-md bg-[var(--hover-overlay)] p-3 mb-3">{content || '系统占位块'}</pre>}
  </div>;
  const toggleFavorite = () => void act(async () => {
    const saved = await savePresetDetails(base, { ...catalog, favorite: !catalog.favorite }, files);
    if (!live.current || epoch !== getVaultEpoch()) return;
    setBase(saved); setCatalog(normalizePresetCatalog(saved.catalog)); onSaved();
  });
  return <div className={`flex-1 flex min-h-0 min-w-0 ${full ? 'flex-col md:flex-row' : 'flex-col'}`} data-preset-details={id}>
    {full && <aside aria-label="预设信息与版本" className="shrink-0 md:w-60 xl:w-72 border-b md:border-b-0 md:border-r border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-3 md:p-5 overflow-y-auto max-h-32 md:max-h-none md:space-y-5">
      <div className="hidden md:flex h-28 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--hover-overlay)] items-center justify-center text-brand"><SlidersHorizontal className="w-10 h-10" /></div>
      <dl className="hidden md:block text-xs space-y-3">{[['名称', identity.displayName], ['系列', identity.series || '未分系列'], ['作者', identity.author || '未注明'], ['适配模型', identity.models.join(' / ') || '未标记']].map(([label, value]) => <div key={label} className="flex gap-3 border-b border-[color:var(--border-subtle)] pb-2"><dt className="text-muted-foreground shrink-0">{label}</dt><dd className="flex-1 min-w-0 text-right break-words">{value}</dd></div>)}</dl>
      <section><h2 className="text-xs text-muted-foreground mb-3">同系列版本 · {versions.length}<span className="md:hidden ml-2">{identity.series}</span></h2><div className="flex flex-wrap md:flex-col gap-2">{[...versions].sort((a,b) => (getPresetPresentation(b).version || '').localeCompare(getPresetPresentation(a).version || '', 'zh-CN', { numeric: true })).map(version => { const p = getPresetPresentation(version); return <button key={version.id} aria-label={`切换版本 ${p.version || p.displayName} ${version.title}`} aria-current={version.id === id ? 'page' : undefined} onClick={() => onVersion?.(version.id)} className={`min-w-0 text-left p-2 md:p-3 rounded-lg border ${version.id === id ? 'border-[color:var(--brand)] bg-[var(--brand-active-bg)]' : 'border-[color:var(--border-subtle)] hover:bg-[var(--hover-overlay)]'}`}><div className="flex gap-2 text-sm"><span className="font-medium flex-1">{p.version || '未标版本'}</span>{version.id === id && <span className="text-xs text-brand">当前</span>}</div><p className="hidden md:block text-xs text-muted-foreground truncate mt-1" title={version.title}>{p.displayName}{version.catalog?.variant ? ` · ${version.catalog.variant}` : ''}</p><p className="hidden md:block text-xs text-muted-foreground mt-1">{version.entryCount} 个提示词 · {new Date(version.createdAt).toLocaleDateString()}</p></button>; })}</div></section>
    </aside>}
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
    <header className="shrink-0 px-5 py-3 border-b border-[color:var(--border-subtle)]">
        <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><h2 className="text-lg font-serif font-semibold leading-snug break-words" title={base.title}>{identity.displayName}</h2><p className="text-xs text-muted-foreground mt-2">{[identity.author, identity.version, base.catalog?.variant].filter(Boolean).join(' · ') || '原始预设'}</p></div>
          {!editing && <Button size="icon" variant="ghost" disabled={busy || dirty} title={dirty ? '请先保存当前修改' : undefined} aria-label={catalog.favorite ? '取消收藏' : '收藏预设'} aria-pressed={!!catalog.favorite} onClick={toggleFavorite}><Star className={`w-4 h-4 ${catalog.favorite ? 'text-brand fill-current' : ''}`} /></Button>}
          {onClose && <Button size="icon" variant="ghost" aria-label="关闭预设资料" onClick={onClose}><X className="w-4 h-4" /></Button>}
        </div>
        <div className="flex gap-1.5 flex-wrap mt-3">{identity.models.map(model => <span key={model} className="text-xs rounded-full bg-[var(--brand-active-bg)] text-brand px-2.5 py-1">{model}</span>)}</div>
        {(identity.inferred.models || identity.inferred.version) && <p className="text-xs text-muted-foreground mt-2">模型／版本含文件名或配置中的线索，尚未确认适配。</p>}
      </header>
    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
      {!editing && <>
        <div className="space-y-2" aria-label="预设操作">
          <div className="flex gap-2 flex-wrap">
            {!full && <Button disabled={busy} onClick={onOpenFull}>查看详情</Button>}
            <Button variant="outline" disabled={busy || !getActiveVault()?.fs.openPath} title={!getActiveVault()?.fs.openPath ? '桌面文件库可定位原文件' : undefined} onClick={() => void act(() => openPresetLocation(id))}><FolderOpen className="w-4 h-4 mr-1" />打开所在文件夹</Button>
            <Button variant="outline" disabled={busy} onClick={() => onEdit(id)}><PenSquare className="w-4 h-4 mr-1" />DIY</Button>
            {full && <Button variant="outline" disabled={busy} onClick={() => { setTrialOpened(true); setTrialVisible(true); }}>临时试用</Button>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" disabled={busy} onClick={() => onImport({ ...catalog, series: identity.series, models: identity.models })}><Download className="w-4 h-4 mr-1" />导入同系列</Button>
            <Button variant="outline" disabled={busy} onClick={() => void act(() => exportPresetPackage(id, 'json'))}><Upload className="w-4 h-4 mr-1" />导出预设</Button>
            <Button variant="ghost" size="icon" aria-label="打开发布网址" title={catalog.sourceUrl || '请在整理资料中填写发布网址'} disabled={busy || !catalog.sourceUrl} onClick={() => void act(() => openExternalUrl(catalog.sourceUrl!))}><Link className="w-4 h-4" /></Button>
            <Button variant="ghost" size="icon" aria-label="删除预设" title="删除预设" className="text-destructive" disabled={busy} onClick={onDelete}><Trash2 className="w-4 h-4" /></Button>
          </div>
        </div>
        <Tabs defaultValue="about" className={trialVisible ? 'hidden' : undefined}>
          <TabsList className="w-full flex-wrap h-auto"><TabsTrigger value="about" className="flex-1">作者说明</TabsTrigger><TabsTrigger value="notes" className="flex-1">笔记</TabsTrigger><TabsTrigger value="content" className="flex-1">内容</TabsTrigger></TabsList>
          <TabsContent value="about" className="space-y-4 mt-4">
            <section><h3 className="text-sm font-medium mb-2">作者说明{latestId !== id && <span className="ml-2 text-xs text-muted-foreground">最新版本 · {newest && getPresetPresentation(newest).version}</span>}</h3>{latestError ? <p role="alert">{latestError}</p> : latestLoading ? <p className="text-sm text-muted-foreground">{LOADING_LABEL}</p> : authorNotes ? <div className="note-markdown prose prose-sm max-w-none text-sm break-words leading-relaxed" dangerouslySetInnerHTML={{ __html: notesMarkup.html }} /> : <div className="rounded-lg border border-dashed border-[color:var(--border-normal)] p-4 text-sm text-muted-foreground leading-relaxed">还没有随附说明。可在整理资料时粘贴发布说明，或补充作者的 MD / TXT 文件。<Button variant="ghost" size="sm" className="mt-2 block" onClick={startEditing}>补充说明</Button></div>}</section>
            {!!catalog.tags?.length && <div className="flex gap-1 flex-wrap">{catalog.tags.map(tag => <span key={tag} className="text-xs bg-[var(--hover-overlay)] px-2 py-1 rounded">#{tag}</span>)}</div>}
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer min-h-8">文件与来源信息</summary><p className="break-all">{base.title}</p><p className="mt-2">入库 {new Date(base.createdAt).toLocaleDateString()} · 内容修改 {new Date(base.updatedAt).toLocaleDateString()}</p>{base.sourceModifiedAt && <p>来源文件修改 {new Date(base.sourceModifiedAt).toLocaleDateString()}</p>}{catalog.modelNotes && <p className="whitespace-pre-wrap mt-2">{catalog.modelNotes}</p>}{!!catalog.representativeCards?.length && <p className="mt-2">代表卡片：{catalog.representativeCards.join('、')}</p>}</details>
          </TabsContent>
          <TabsContent value="notes" className="mt-4"><PresetNotes value={catalog.notes || ''} onChange={notes => setCatalog(value => ({ ...value, notes }))} onSave={() => void save()} busy={busy} dirty={dirty} /></TabsContent>
          <TabsContent value="content" className="mt-4 space-y-3">
            <section><h3 className="text-sm font-medium">提示词</h3>{base.preset.prompts.map((block,i) => resource(`p-${i}`, block.name || block.identifier, block.content ?? ''))}</section>
            <section><h3 className="text-sm font-medium">内嵌正则与脚本</h3>{base.preset.regexRules.map((rule,i) => resource(`r-${i}`, `正则 · ${rule.name}`, `${rule.findRegex}\n→\n${rule.replaceString}`))}{scripts.map((script,i) => resource(`s-${i}`, `脚本 · ${script.name}`, script.content))}{!base.preset.regexRules.length && !scripts.length && <p className="text-xs text-muted-foreground py-2">尚未内置正则或脚本。</p>}</section>
            <section><div className="flex items-center gap-2"><h3 className="text-sm font-medium flex-1">附带文件</h3><Button variant="outline" size="sm" disabled={busy || dirty} onClick={startEditing}>添加正则／脚本</Button></div>
              {files.map(file => <div key={file.id}>{resource(file.id, `${PACKAGE_KIND_LABELS[file.kind]} · ${file.name}`, file.text)}{['regex', 'script'].includes(file.kind) && <Button variant="outline" size="sm" className="my-2" disabled={busy || dirty} onClick={() => void act(async () => {
                const saved = await updatePreset(id, latest => {
                  if (presetContentFingerprint(latest.preset) !== presetContentFingerprint(base.preset)) throw new Error('预设已在其他位置修改，请重新打开后内置');
                  return { ...latest, preset: embedPresetAttachment(latest.preset, file), autoSaved: false, updatedAt: Date.now() };
                });
                if (live.current && epoch === getVaultEpoch()) { setBase(saved); setCatalog(normalizePresetCatalog(saved.catalog)); onSaved(); }
                return '资源已内置，导出 JSON 会一并带出';
              })}>内置到预设 · {file.name}</Button>}</div>)}
            </section>
          </TabsContent>
        </Tabs>
        {full && trialOpened && <section className={trialVisible ? 'space-y-3' : 'hidden'} aria-label="预设临时试用"><Button variant="ghost" size="sm" onClick={() => setTrialVisible(false)}>返回预设资料</Button><PresetPlayground presetId={id} /></section>}
      </>}
      {editing && <fieldset disabled={busy} className="min-w-0 space-y-4">
        <p className="text-xs text-muted-foreground">已带入可识别的模型与版本，确认或修改后保存。作者信息由你填写。</p>
        <PresetCatalogFields value={catalog} onChange={setCatalog} />
        <div className="space-y-2 border-t pt-3"><h3 className="text-sm font-medium">附带文件</h3>
          <input ref={input} className="hidden" type="file" multiple accept=".json,.js,.mjs,.md,.txt" onChange={e => { const chosen = Array.from(e.target.files ?? []); e.target.value = ''; if (chosen.length) void act(async () => {
            const preview = await readPresetPackage(chosen);
            if (preview.presets.length || preview.errors.length) throw new Error([...preview.errors, ...(preview.presets.length ? ['包含预设正文，请从导入同系列新版保存新版本'] : [])].join('\n'));
            if (live.current && epoch === getVaultEpoch()) {
              setFiles(previous => [...previous, ...preview.files]);
              const notes = preview.files.filter(file => file.kind === 'notes').map(file => file.text).join('\n\n');
              if (notes) setCatalog(value => ({ ...value, releaseNotes: value.releaseNotes ? value.releaseNotes : notes }));
            }
            return '附件已加入草稿';
          }); }} />
          <Button variant="outline" onClick={() => input.current?.click()}>补充正则、脚本或说明</Button>
          {files.map(file => <div key={file.id} className="flex items-center gap-2 rounded border p-2 text-xs"><Paperclip className="w-3.5 h-3.5 shrink-0" /><span className="flex-1 min-w-0 break-all">{file.name}</span><Button variant="ghost" size="sm" aria-label={`移除附件 ${file.name}`} onClick={() => setFiles(files.filter(candidate => candidate.id !== file.id))}>移除</Button></div>)}
        </div>
      </fieldset>}
      {error && <p role="alert" className="text-sm text-destructive whitespace-pre-wrap">{error}</p>}
      {message && <p role="status" className="text-xs text-muted-foreground break-all">{message}</p>}
    </div>
    <footer className="shrink-0 border-t border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-5 py-3 flex items-center gap-2">
      {editing ? <><Button disabled={busy || !dirty} onClick={() => void save()}><Save className="w-4 h-4 mr-1" />{busy ? '保存中…' : '保存资料'}</Button><Button variant="ghost" disabled={busy} onClick={() => { if (dirty) setConfirmReload(true); else setEditing(false); }}>取消</Button>{dirty && <span className="text-xs text-muted-foreground ml-auto">未保存</span>}</> : <><Button variant="outline" disabled={busy} onClick={startEditing}><SlidersHorizontal className="w-4 h-4 mr-1.5" />整理资料</Button><span className="text-xs text-muted-foreground ml-auto">{busy ? '处理中…' : '资料与预设正文分别保存'}</span></>}
    </footer>
    </div>
    <PresetDiscardDialog open={confirmReload} cancel={() => setConfirmReload(false)} discard={() => { setConfirmReload(false); setEditing(false); setReload(n => n + 1); }} />
  </div>;
}
