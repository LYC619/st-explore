import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, FolderOpen, Upload, Save, Star, PenSquare, Download, SlidersHorizontal, Paperclip, Trash2, X, FlaskConical } from 'lucide-react';
import type { PresetCatalog, PresetItem, PresetPackageFile } from '@/types/preset';
import { getPreset, savePresetDetails, updatePreset } from '@/lib/preset-db';
import { normalizePresetCatalog, presetContentFingerprint, splitCatalogLabels } from '@/lib/preset-catalog';
import { exportPresetPackage, openPresetLocation, PACKAGE_KIND_LABELS, readPresetPackage, presetAttachmentRegexEntries } from '@/lib/preset-package';
import { getActiveVault, getVaultEpoch } from '@/lib/vault/active';
import { getPresetTags, catalogWithTags } from '@/lib/preset-tag-values';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { renderNoteMarkdown } from '@/lib/note-markdown';
import { getPresetPresentation } from '@/lib/preset-presentation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PresetNotes } from './PresetNotes';
import { embedPresetAttachment } from '@/lib/preset-attachments';
import { PresetCatalogFields } from './PresetCatalogFields';
import { PresetDetailMetadata } from './PresetDetailMetadata';
import { PresetEmbeddedResources } from './PresetEmbeddedResources';
import { PresetVersionPicker } from './PresetVersionPicker';
import { PresetDiscardDialog } from './PresetDraftBoundary';
import type { AssetIndexEntry } from '@/lib/asset-index-entry';
import { PresetPlayground } from './PresetPlayground';
import { openExternalUrl } from '@/lib/roleplay/external-url';
import { exportSTRegex, parseSTRegexImport } from '@/lib/st-regex-interop';
import { LOADING_LABEL } from '@/lib/ui-copy';
import { useViewport } from '@/hooks/use-viewport';

export function PresetCatalogDetails({ id, onDirty, onEdit, onImport, onSaved, onDelete, full = false, versions = [], onVersion, onOpenFull, onClose, onOpenRegex, onBack, onOpenRegexAsset }: {
  onOpenFull?: () => void; onClose?: () => void; onBack?: () => void; onOpenRegex?: (name: string, text: string) => void; onOpenRegexAsset?: (id: string) => void;
  full?: boolean; versions?: AssetIndexEntry[]; onVersion?: (id: string) => void;
  id: string; onDirty: (value: boolean) => void; onEdit: (id: string) => void;
  onImport: (seed: PresetCatalog) => void; onSaved: () => void; onDelete: () => void;
}) {
  const epoch = useRef(getVaultEpoch()).current, live = useRef(true), inFlight = useRef(false);
  const { isMobile } = useViewport();
  const [metadataOpen, setMetadataOpen] = useState(!isMobile);
  useEffect(() => { setMetadataOpen(!isMobile); }, [isMobile]);
  const [editing, setEditing] = useState(false), [authorEditing, setAuthorEditing] = useState(false), [previewCurrentAuthor, setPreviewCurrentAuthor] = useState(false);
  const [trialOpened, setTrialOpened] = useState(false), [trialVisible, setTrialVisible] = useState(false);
  const [tab, setTab] = useState('about'), [opened, setOpened] = useState('');
  const [base, setBase] = useState<PresetItem | null>(null), [catalog, setCatalog] = useState<PresetCatalog>({}), [files, setFiles] = useState<PresetPackageFile[]>([]);
  const [modelDraft, setModelDraft] = useState(''), [tagDraft, setTagDraft] = useState(''), [resourceDirty, setResourceDirty] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [reload, setReload] = useState(0), [confirmReload, setConfirmReload] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const metadataDirty = !!base && (JSON.stringify(catalog) !== JSON.stringify(normalizePresetCatalog(base.catalog)) || JSON.stringify(files) !== JSON.stringify(base.packageFiles ?? []) || !!modelDraft.trim() || !!tagDraft.trim());
  const dirty = metadataDirty || resourceDirty;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    live.current = true;
    let active = true; setError('');
    void getPreset(id).then(item => {
      if (!active || epoch !== getVaultEpoch()) return;
      if (!item) throw new Error('预设已不存在，请刷新列表');
      setBase(item); setCatalog(normalizePresetCatalog(item.catalog)); setFiles(item.packageFiles ?? []); setModelDraft(''); setTagDraft(''); setPreviewCurrentAuthor(false); setAuthorEditing(false);
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; live.current = false; };
  }, [id, epoch, reload]);
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
  const authorNotes = latestId === id || previewCurrentAuthor ? catalog.releaseNotes || '' : latestNotes?.text || '';
  const notesMarkup = useMemo(() => renderNoteMarkdown(authorNotes, `preset-${id}`), [authorNotes, id]);
  const act = async (action: () => Promise<string | void | null>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setMessage('');
    try {
      if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开预设');
      const result = await action();
      if (live.current && epoch === getVaultEpoch() && result) setMessage(result);
    } catch (error) { if (live.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { inFlight.current = false; if (live.current) setBusy(false); }
  };
  const save = () => act(async () => {
    if (!base || resourceDirty) return;
    let pending = { ...catalog };
    if (modelDraft.trim()) pending = { ...pending, models: [...getPresetPresentation({ ...base, catalog }).models, ...splitCatalogLabels(modelDraft)], modelsConfirmed: true };
    if (tagDraft.trim()) pending = catalogWithTags(pending, [...getPresetTags(pending), ...splitCatalogLabels(tagDraft)]);
    const saved = await savePresetDetails(base, pending, files);
    if (!live.current || epoch !== getVaultEpoch()) return;
    setBase(saved); setCatalog(normalizePresetCatalog(saved.catalog)); setFiles(saved.packageFiles ?? []); setModelDraft(''); setTagDraft(''); setEditing(false); onSaved();
    return '管理资料和附件已保存';
  });
  if (!base) return <div className="p-4 text-sm space-y-3">{full && onBack && <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="w-3.5 h-3.5 mr-2" />返回预设库</Button>}<p>{error || '正在读取预设…'}</p>{error && <Button variant="outline" onClick={() => setReload(value => value + 1)}>重试</Button>}</div>;
  const identity = getPresetPresentation(base), draftIdentity = getPresetPresentation({ ...base, catalog });
  const sidebarCatalog = { ...catalog, name: catalog.name ?? identity.displayName, author: catalog.author ?? identity.author, series: catalog.series ?? identity.series, version: catalog.version ?? identity.version, models: catalog.models?.length || catalog.modelsConfirmed ? catalog.models : identity.models };
  const importVersion = () => onImport({ ...catalog, series: identity.series, models: identity.models });
  const startEditing = () => {
    if (full) { setTab('about'); setPreviewCurrentAuthor(true); setAuthorEditing(true); return; }
    setCatalog(sidebarCatalog); setEditing(true);
  };
  const resource = (key: string, title: string, content: string) => <div key={key} className="border-b border-[color:var(--border-subtle)]">
    <button type="button" className="w-full min-h-10 py-2 text-left text-sm flex items-center gap-2" aria-expanded={opened === key} onClick={() => setOpened(opened === key ? '' : key)}><span className="text-muted-foreground">{opened === key ? '−' : '+'}</span><span className="break-words min-w-0">{title}</span></button>
    {opened === key && <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed max-h-[55dvh] overflow-y-auto rounded-md bg-[var(--hover-overlay)] p-3 mb-3">{content || '系统占位块'}</pre>}
  </div>;
  const toggleFavorite = () => void act(async () => {
    const saved = await savePresetDetails(base, { ...catalog, favorite: !catalog.favorite }, files);
    if (!live.current || epoch !== getVaultEpoch()) return;
    setBase(saved); setCatalog(normalizePresetCatalog(saved.catalog)); onSaved();
  });
  const openAttachmentRegex = (file: PresetPackageFile) => void act(async () => {
    const rules = parseSTRegexImport(presetAttachmentRegexEntries(JSON.parse(file.text)));
    if (!rules.length) throw new Error('附件中没有可识别的正则规则');
    onOpenRegex?.(file.name, exportSTRegex(rules));
  });
  const addModels = () => { if (modelDraft.trim()) { setCatalog({ ...sidebarCatalog, models: [...new Set([...(sidebarCatalog.models ?? []), ...splitCatalogLabels(modelDraft)])], modelsConfirmed: true }); setModelDraft(''); } };
  const addTags = () => { if (tagDraft.trim()) { setCatalog(catalogWithTags(sidebarCatalog, [...getPresetTags(sidebarCatalog), ...splitCatalogLabels(tagDraft)])); setTagDraft(''); } };
  const attachments = <section aria-label="预设附带文件" className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><div className="flex-1 min-w-0"><h3 className="text-sm font-medium">附带文件 <span className="text-muted-foreground font-normal">· {files.length}</span></h3><p className="text-xs text-muted-foreground mt-1">保存作者随附的说明、正则和脚本。</p></div><Button size="sm" variant="outline" disabled={busy || resourceDirty} onClick={() => input.current?.click()}><Paperclip className="w-3.5 h-3.5 mr-1" />补充文件</Button></div>
    {!files.length && <div className="border border-dashed border-[color:var(--border-subtle)] rounded-lg py-12 px-4 text-center text-sm text-muted-foreground">还没有附带文件，可补充 JSON、JS、MD 或 TXT 文件。</div>}
    {files.map(file => <div key={file.id} className="rounded-lg border border-[color:var(--border-subtle)] px-3">
      {resource(file.id, `${PACKAGE_KIND_LABELS[file.kind]} · ${file.name}`, file.text)}
      <div className="flex flex-wrap gap-1 py-2">
        {file.kind === 'regex' && onOpenRegex && <Button variant="ghost" size="sm" className="text-xs" disabled={busy || resourceDirty} onClick={() => openAttachmentRegex(file)}>打开正则 · {file.name}</Button>}
        {['regex', 'script'].includes(file.kind) && <Button variant="outline" size="sm" className="text-xs" disabled={busy || dirty} onClick={() => void act(async () => {
          const saved = await updatePreset(id, latest => {
            if (presetContentFingerprint(latest.preset) !== presetContentFingerprint(base.preset)) throw new Error('预设已在其他位置修改，请重新打开后内置');
            return { ...latest, preset: embedPresetAttachment(latest.preset, file), autoSaved: false, updatedAt: Date.now() };
          });
          if (live.current && epoch === getVaultEpoch()) { setBase(saved); setCatalog(normalizePresetCatalog(saved.catalog)); onSaved(); }
          return '资源已内置，导出 JSON 会一并带出';
        })}>内置到预设 · {file.name}</Button>}
        <Button variant="ghost" size="sm" className="text-xs ml-auto text-muted-foreground" disabled={busy || resourceDirty} aria-label={`移除附件 ${file.name}`} onClick={() => setFiles(previous => previous.filter(candidate => candidate.id !== file.id))}>移除</Button>
      </div>
    </div>)}
  </section>;
  return <div className={`flex-1 flex min-h-0 min-w-0 ${full ? 'flex-col md:flex-row overflow-y-auto md:overflow-hidden' : 'flex-col'}`} data-preset-details={id}>
    {(full || editing || tab === 'attachments') && <input ref={input} className="hidden" aria-label="补充预设附带文件" type="file" multiple accept=".json,.js,.mjs,.md,.txt" onChange={event => {
      const chosen = Array.from(event.target.files ?? []); event.target.value = '';
      if (chosen.length) void act(async () => {
        const preview = await readPresetPackage(chosen);
        if (preview.presets.length || preview.errors.length) throw new Error([...preview.errors, ...(preview.presets.length ? ['包含预设正文，请从导入同系列保存新版本'] : [])].join('\n'));
        if (live.current && epoch === getVaultEpoch()) {
          setFiles(previous => [...previous, ...preview.files]);
          const notes = preview.files.filter(file => file.kind === 'notes').map(file => file.text).join('\n\n');
          if (notes) setCatalog(value => ({ ...value, releaseNotes: value.releaseNotes || notes }));
          setTab('attachments');
        }
        return '附件已加入草稿，保存资料后生效';
      });
    }} />}
    {full && <aside aria-label="预设信息" className="shrink-0 md:w-60 xl:w-64 border-b md:border-b-0 md:border-r border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] flex flex-col min-h-0">
      <div className="px-4 pt-4 pb-3 border-b border-[color:var(--border-subtle)]">{onBack && <Button variant="outline" size="sm" className="mb-4 text-xs" onClick={onBack}><ArrowLeft className="w-3.5 h-3.5 mr-1.5" />返回预设库</Button>}<button type="button" className="flex w-full items-center justify-between gap-2 md:hidden text-left" aria-expanded={metadataOpen} aria-label="展开预设资料" onClick={() => setMetadataOpen(value => !value)}><h2 className="font-medium text-sm">预设资料</h2><ChevronDown className={`w-3.5 h-3.5 md:hidden transition-transform ${metadataOpen ? 'rotate-180' : ''}`} /></button><h2 className="hidden md:block font-medium text-sm">预设资料</h2></div>
      <div className={`${metadataOpen ? 'block' : 'hidden'} md:block overflow-y-auto max-h-[45dvh] md:max-h-none p-4`}><fieldset disabled={busy || resourceDirty} className="min-w-0"><PresetDetailMetadata value={sidebarCatalog} inferredModels={draftIdentity.inferred.models} onChange={setCatalog} modelDraft={modelDraft} onModelDraft={setModelDraft} addModels={addModels} tagDraft={tagDraft} onTagDraft={setTagDraft} addTags={addTags} onOpenSource={() => void act(() => openExternalUrl(catalog.sourceUrl!))} /></fieldset></div>
    </aside>}
    <div className={`flex-1 flex flex-col min-w-0 ${full ? 'min-h-[28rem] md:min-h-0' : 'min-h-0'}`}>
      {full && <div className="shrink-0 flex min-w-0 items-center gap-3 px-4 sm:px-5 py-3 border-b border-[color:var(--border-subtle)]"><div className="min-w-0 flex-1 truncate text-xs text-muted-foreground" aria-label="当前预设系列">预设库 <span className="px-2 opacity-50">/</span><span className="text-foreground">{draftIdentity.series || draftIdentity.displayName}</span></div><PresetVersionPicker id={id} version={identity.version} versions={versions} onVersion={onVersion} onNewVersion={importVersion} disabled={busy} /></div>}
      <header className="shrink-0 px-4 sm:px-5 pt-4 pb-2">
        <div className="flex items-start gap-2"><div className="min-w-0 flex-1 flex items-start gap-2"><h2 className="min-w-0 line-clamp-2 text-lg md:text-xl font-serif font-semibold leading-snug break-words" title={base.title}>{draftIdentity.displayName}</h2><span title={draftIdentity.version || '未标版本'} className="shrink-0 max-w-28 truncate text-[11px] mt-1 rounded-full bg-[var(--hover-overlay)] border border-[color:var(--border-subtle)] text-muted-foreground px-2 py-0.5">{draftIdentity.inferred.version && draftIdentity.version ? `版本线索 ${draftIdentity.version}` : draftIdentity.version || '未标版本'}</span></div>
          {!editing && <Button size="icon" variant="ghost" className="shrink-0" disabled={busy || dirty} title={dirty ? '请先保存当前修改' : undefined} aria-label={catalog.favorite ? '取消收藏' : '收藏预设'} aria-pressed={!!catalog.favorite} onClick={toggleFavorite}><Star className={`w-4 h-4 ${catalog.favorite ? 'text-brand fill-current' : 'text-muted-foreground'}`} /></Button>}
          {onClose && <Button size="icon" variant="ghost" className="shrink-0" aria-label="关闭预设资料" onClick={onClose}><X className="w-4 h-4" /></Button>}
        </div>
        {(!editing || full) && <div className="flex items-center gap-1.5 overflow-x-auto py-3 whitespace-nowrap" aria-label="预设操作">
          {!full && <Button size="sm" className="shrink-0 text-xs" disabled={busy} onClick={onOpenFull}>查看详情</Button>}
          <Button variant="outline" size="sm" className="shrink-0 text-xs" disabled={busy || !getActiveVault()?.fs.openPath} title={!getActiveVault()?.fs.openPath ? '桌面文件库可定位原文件' : undefined} onClick={() => void act(() => openPresetLocation(id))}><FolderOpen className="w-3.5 h-3.5 mr-1" />打开所在文件夹</Button>
          <Button variant="outline" size="sm" className="shrink-0 text-xs" disabled={busy} onClick={() => onEdit(id)}><PenSquare className="w-3.5 h-3.5 mr-1" />DIY</Button>
          {full && <Button variant="outline" size="sm" className="shrink-0 text-xs" disabled={busy} onClick={() => { setTrialOpened(true); setTrialVisible(true); }}><FlaskConical className="w-3.5 h-3.5 mr-1" />临时试用</Button>}
          <Button variant="outline" size="sm" className="shrink-0 text-xs" disabled={busy} onClick={importVersion}><Download className="w-3.5 h-3.5 mr-1" />导入同系列</Button>
          <Button variant="outline" size="sm" className="shrink-0 text-xs" disabled={busy} onClick={() => void act(() => exportPresetPackage(id, 'json'))}><Upload className="w-3.5 h-3.5 mr-1" />导出预设</Button>
          <Button variant="outline" size="icon" className="shrink-0 text-destructive" aria-label="删除预设" title="删除预设" disabled={busy} onClick={onDelete}><Trash2 className="w-3.5 h-3.5" /></Button>
        </div>}
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 pb-5">
        {(!editing || full) && <Tabs value={tab} onValueChange={setTab} className={trialVisible ? 'hidden' : undefined}>
          <TabsList className="flex w-full justify-start rounded-none bg-transparent border-b border-[color:var(--border-subtle)] h-10 p-0 mb-4 overflow-x-auto gap-2" aria-label="预设详情内容">{[['about','作者说明'],['notes','笔记'],['content','内容'],['resources','正则与脚本'],['attachments','附带文件']].map(([value,label]) => <TabsTrigger key={value} value={value} className="shrink-0 rounded-none h-10 text-xs px-3 border-b-2 border-transparent data-[state=active]:border-[color:var(--brand)] data-[state=active]:text-brand data-[state=active]:shadow-none data-[state=active]:bg-transparent">{label}</TabsTrigger>)}</TabsList>
          <TabsContent value="about" className="mt-0 space-y-4">
            <div className="flex items-center gap-2 text-xs"><span className="flex-1 text-muted-foreground">{authorEditing ? '编辑当前版本的作者说明' : previewCurrentAuthor ? `当前版本说明 · ${identity.version || '未标版本'}` : latestId !== id ? `最新版本说明 · ${newest && getPresetPresentation(newest).version}` : '作者说明'}</span>{full && !authorEditing && previewCurrentAuthor && latestId !== id && <Button size="sm" variant="ghost" className="text-xs" disabled={busy} onClick={() => setPreviewCurrentAuthor(false)}>查看最新说明</Button>}{full && <Button size="sm" variant="ghost" className="text-xs" disabled={busy || resourceDirty} onClick={() => { setPreviewCurrentAuthor(true); setAuthorEditing(value => !value); }}>{authorEditing ? '预览说明' : '编辑说明'}</Button>}</div>
            {authorEditing && full ? <Textarea aria-label="作者发布说明" className="min-h-[22rem] h-[50dvh] leading-7 text-sm resize-y" disabled={busy || resourceDirty} value={catalog.releaseNotes || ''} placeholder="粘贴作者说明，支持 Markdown。保存资料后生效。" onChange={event => setCatalog(value => ({ ...value, releaseNotes: event.target.value }))} />
              : <div className="rounded-lg border border-[color:var(--border-subtle)] bg-background/40 min-h-[22rem] p-4 sm:p-5">{!previewCurrentAuthor && latestError ? <p role="alert" className="text-sm text-destructive">{latestError}</p> : !previewCurrentAuthor && latestId !== id && latestNotes?.id !== latestId ? <p className="text-sm text-muted-foreground">{LOADING_LABEL}</p> : authorNotes ? <div className="note-markdown prose prose-sm max-w-none text-sm break-words leading-7" dangerouslySetInnerHTML={{ __html: notesMarkup.html }} /> : <div className="text-sm text-muted-foreground py-8 text-center"><p>还没有作者说明。</p><Button variant="ghost" size="sm" className="mt-2" onClick={startEditing}>补充说明</Button></div>}</div>}
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer min-h-8">文件与来源信息</summary><p className="break-all">{base.title}</p><p className="mt-2">入库 {new Date(base.createdAt).toLocaleDateString()} · 内容修改 {new Date(base.updatedAt).toLocaleDateString()}</p>{base.sourceModifiedAt && <p>来源文件修改 {new Date(base.sourceModifiedAt).toLocaleDateString()}</p>}{catalog.modelNotes && <p className="whitespace-pre-wrap mt-2">{catalog.modelNotes}</p>}</details>
          </TabsContent>
          <TabsContent value="notes" className="mt-0"><PresetNotes value={catalog.notes || ''} onChange={notes => setCatalog(value => ({ ...value, notes }))} onSave={() => void save()} busy={busy || resourceDirty} dirty={metadataDirty} /></TabsContent>
          <TabsContent value="content" className="mt-0 space-y-5">
            <section className="rounded-lg border border-[color:var(--border-subtle)] px-4 py-3"><h3 className="text-sm font-medium mb-1">提示词 <span className="text-xs text-muted-foreground font-normal">· {base.preset.prompts.length}</span></h3>{base.preset.prompts.map((block,index) => resource(`p-${index}`, block.name || block.identifier, block.content ?? ''))}</section>
          </TabsContent>
          <TabsContent value="resources" className="mt-0">
            <PresetEmbeddedResources key={`${id}:${reload}`} preset={base} disabled={busy || metadataDirty} onDirty={setResourceDirty} onOpenRegex={onOpenRegexAsset} onChanged={saved => { setBase(saved); setCatalog(normalizePresetCatalog(saved.catalog)); setFiles(saved.packageFiles ?? []); onSaved(); }} />
          </TabsContent>
          <TabsContent value="attachments" className="mt-0">{attachments}</TabsContent>
        </Tabs>}
        {full && trialOpened && <section className={trialVisible ? 'space-y-3' : 'hidden'} aria-label="预设临时试用"><Button variant="ghost" size="sm" onClick={() => setTrialVisible(false)}>返回预设资料</Button><PresetPlayground presetId={id} /></section>}
        {editing && !full && <fieldset disabled={busy || resourceDirty} className="min-w-0 space-y-5"><PresetCatalogFields value={catalog} onChange={setCatalog} />{attachments}</fieldset>}
        {error && <p role="alert" className="mt-4 text-sm text-destructive whitespace-pre-wrap">{error}</p>}
        {message && <p role="status" className="mt-3 text-xs text-muted-foreground break-all">{message}</p>}
      </div>
      <footer className="shrink-0 border-t border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-4 sm:px-5 py-2.5 flex items-center gap-2">
        {(editing || full) ? <><Button size="sm" disabled={busy || !metadataDirty || resourceDirty} onClick={() => void save()}><Save className="w-3.5 h-3.5 mr-1" />{busy ? '保存中…' : '保存资料'}</Button><Button size="sm" variant="ghost" disabled={busy || (full && !dirty)} onClick={() => { if (dirty) setConfirmReload(true); else setEditing(false); }}>{full ? '撤销修改' : '取消'}</Button><span className="text-[11px] text-muted-foreground ml-auto">{resourceDirty ? '内嵌资源有未保存修改' : metadataDirty ? '未保存' : '已保存'}</span></> : <><Button variant="outline" size="sm" disabled={busy} onClick={startEditing}><SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />整理资料</Button><span className="text-[11px] text-muted-foreground ml-auto">资料与正文分别保存</span></>}
      </footer>
    </div>
    <PresetDiscardDialog open={confirmReload} cancel={() => setConfirmReload(false)} discard={() => { setConfirmReload(false); setEditing(false); setResourceDirty(false); setReload(value => value + 1); }} />
  </div>;
}
