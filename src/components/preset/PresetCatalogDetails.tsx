import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, FolderOpen, Upload, Save, Star, PenSquare, Download, MoreHorizontal, SlidersHorizontal, FileText, Braces, Paperclip } from 'lucide-react';
import type { PresetCatalog, PresetItem, PresetPackageFile } from '@/types/preset';
import { createPresetDiy, getPreset, savePresetDetails } from '@/lib/preset-db';
import { inspectPresetScripts, normalizePresetCatalog } from '@/lib/preset-catalog';
import { exportPresetPackage, PACKAGE_KIND_LABELS, readPresetPackage } from '@/lib/preset-package';
import { getActiveVault, getVaultEpoch } from '@/lib/vault/active';
import { Button } from '@/components/ui/button';
import { renderNoteMarkdown } from '@/lib/note-markdown';
import { getPresetPresentation } from '@/lib/preset-presentation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PresetCatalogFields } from './PresetCatalogFields';
import { PresetDiscardDialog } from './PresetDraftBoundary';
import { openExternalUrl } from '@/lib/roleplay/external-url';

export function PresetCatalogDetails({ id, onDirty, onEdit, onImport, onSaved, onDelete }: {
  id: string; onDirty: (value: boolean) => void; onEdit: (id: string) => void;
  onImport: (seed: PresetCatalog) => void; onSaved: () => void; onDelete: () => void;
}) {
  const epoch = useRef(getVaultEpoch()).current;
  const live = useRef(true);
  const inFlight = useRef(false);
  const [editing, setEditing] = useState(false);
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
  const notesMarkup = useMemo(() => renderNoteMarkdown(catalog.releaseNotes ?? '', `preset-${id}`), [catalog.releaseNotes, id]);
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
    setCatalog(normalizePresetCatalog({ ...base.catalog, author: identity.author, series: identity.series, version: identity.version, models: identity.models, purposes: identity.purposes }));
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
  return <div className="flex-1 flex flex-col min-h-0" data-preset-details={id}>
    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
      <header>
        <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><h2 className="text-lg font-serif font-semibold leading-snug break-words" title={base.title}>{identity.series || identity.displayName}</h2><p className="text-xs text-muted-foreground mt-2">{[identity.author, identity.version, base.catalog?.variant].filter(Boolean).join(' · ') || '原始预设'}</p></div>
          {!editing && <Button size="icon" variant="ghost" disabled={busy} aria-label={catalog.favorite ? '取消收藏' : '收藏预设'} aria-pressed={!!catalog.favorite} onClick={toggleFavorite}><Star className={`w-4 h-4 ${catalog.favorite ? 'text-brand fill-current' : ''}`} /></Button>}
        </div>
        <div className="flex gap-1.5 flex-wrap mt-3">{identity.models.map(model => <span key={model} className="text-xs rounded-full bg-[var(--brand-active-bg)] text-brand px-2.5 py-1">{model}</span>)}{identity.purposes.map(purpose => <span key={purpose} className="text-xs rounded-full bg-[var(--hover-overlay)] text-muted-foreground px-2.5 py-1">{purpose}</span>)}</div>
        {(identity.inferred.models || identity.inferred.version) && <p className="text-xs text-muted-foreground mt-2">模型／版本含文件名或配置中的线索，尚未确认适配。</p>}
      </header>
      {!editing && <>
        <div className="flex gap-2 flex-wrap">
          <Button disabled={busy} onClick={() => void act(() => exportPresetPackage(id, getActiveVault()?.fs.openPath ? 'folder' : 'zip'))}>{getActiveVault()?.fs.openPath ? <><FolderOpen className="w-4 h-4 mr-1.5" />打开导入文件夹</> : <><Upload className="w-4 h-4 mr-1.5" />导出取用包</>}</Button>
          <Button variant="outline" disabled={busy} onClick={() => void act(async () => { const copy = await createPresetDiy(id); if (!live.current || epoch !== getVaultEpoch()) return; onSaved(); onEdit(copy.id); })}><Copy className="w-4 h-4 mr-1" />复制后 DIY</Button>
          <Popover><PopoverTrigger asChild><Button variant="ghost" size="icon" aria-label="更多预设操作" disabled={busy}><MoreHorizontal className="w-4 h-4" /></Button></PopoverTrigger><PopoverContent align="end" className="w-52 flex flex-col gap-1 p-2">
            <Button variant="ghost" className="justify-start" disabled={busy} onClick={() => onEdit(id)}><PenSquare className="w-4 h-4 mr-2" />编辑原版</Button>
            <Button variant="ghost" className="justify-start" disabled={busy} onClick={() => onImport({ ...catalog, series: identity.series, models: identity.models })}><Download className="w-4 h-4 mr-2" />导入同系列新版</Button>
            {getActiveVault()?.fs.openPath && <Button variant="ghost" className="justify-start" disabled={busy} onClick={() => void act(() => exportPresetPackage(id, 'zip'))}><Upload className="w-4 h-4 mr-2" />导出取用包</Button>}
            {catalog.sourceUrl && <Button variant="ghost" className="justify-start" disabled={busy} onClick={() => void act(() => openExternalUrl(catalog.sourceUrl!))}>打开作者发布页</Button>}
            <Button variant="ghost" className="justify-start text-destructive" disabled={busy} onClick={onDelete}>删除预设</Button>
          </PopoverContent></Popover>
        </div>
        <Tabs defaultValue="about">
          <TabsList className="w-full"><TabsTrigger value="about" className="flex-1">概览</TabsTrigger><TabsTrigger value="content" className="flex-1">内容</TabsTrigger><TabsTrigger value="files" className="flex-1">附件{files.length ? ` · ${files.length}` : ''}</TabsTrigger></TabsList>
          <TabsContent value="about" className="space-y-4 mt-4">
            <div className="grid grid-cols-3 gap-2 text-center rounded-lg bg-[var(--hover-overlay)] p-3"><div><FileText className="w-4 h-4 mx-auto text-muted-foreground mb-1" /><span className="font-medium text-base">{base.preset.prompts.length}</span><p className="text-xs text-muted-foreground">提示词</p></div><div><Braces className="w-4 h-4 mx-auto text-muted-foreground mb-1" /><span className="font-medium text-base">{base.preset.regexRules.length}</span><p className="text-xs text-muted-foreground">内嵌正则</p></div><div><SlidersHorizontal className="w-4 h-4 mx-auto text-muted-foreground mb-1" /><span className="font-medium text-base">{scripts.length}</span><p className="text-xs text-muted-foreground">内嵌脚本</p></div></div>
            <section><h3 className="text-sm font-medium mb-2">作者说明</h3>{catalog.releaseNotes ? <div className="note-markdown prose prose-sm max-w-none text-sm break-words leading-relaxed" dangerouslySetInnerHTML={{ __html: notesMarkup.html }} /> : <div className="rounded-lg border border-dashed border-[color:var(--border-normal)] p-4 text-sm text-muted-foreground leading-relaxed">还没有随附说明。可在整理资料时粘贴发布说明，或补充作者的 MD / TXT 文件。<Button variant="ghost" size="sm" className="mt-2 block" onClick={startEditing}>补充说明</Button></div>}</section>
            {!!catalog.notes && <section><h3 className="text-sm font-medium mb-2">我的使用笔记</h3><p className="text-sm whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">{catalog.notes}</p></section>}
            {!!catalog.tags?.length && <div className="flex gap-1 flex-wrap">{catalog.tags.map(tag => <span key={tag} className="text-xs bg-[var(--hover-overlay)] px-2 py-1 rounded">#{tag}</span>)}</div>}
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer min-h-8">文件与来源信息</summary><p className="break-all">{base.title}</p><p className="mt-2">入库 {new Date(base.createdAt).toLocaleDateString()} · 内容修改 {new Date(base.updatedAt).toLocaleDateString()}</p>{base.sourceModifiedAt && <p>来源文件修改 {new Date(base.sourceModifiedAt).toLocaleDateString()}</p>}{catalog.modelNotes && <p className="whitespace-pre-wrap mt-2">{catalog.modelNotes}</p>}{!!catalog.representativeCards?.length && <p className="mt-2">代表卡片：{catalog.representativeCards.join('、')}</p>}</details>
          </TabsContent>
          <TabsContent value="content" className="mt-4"><p className="text-xs text-muted-foreground mb-2">只读预览；需要修改时复制后 DIY。</p>{base.preset.prompts.map((block,i) => resource(`p-${i}`, block.name || block.identifier, block.content ?? ''))}{base.preset.regexRules.map((rule,i) => resource(`r-${i}`, `正则 · ${rule.name}`, `${rule.findRegex}\n→\n${rule.replaceString}`))}{scripts.map((script,i) => resource(`s-${i}`, `脚本 · ${script.name}`, script.content))}</TabsContent>
          <TabsContent value="files" className="mt-4"><p className="text-xs text-muted-foreground mb-3">随包原文件独立保留，导出取用包时一起带走。</p>{files.map(file => resource(file.id, `${PACKAGE_KIND_LABELS[file.kind]} · ${file.name}`, file.text))}{!files.length && <div className="text-sm text-muted-foreground text-center py-8"><Paperclip className="w-8 h-8 mx-auto mb-3" />尚无独立附件</div>}<Button variant="outline" className="mt-3" onClick={startEditing}>管理附件</Button></TabsContent>
        </Tabs>
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
    <PresetDiscardDialog open={confirmReload} cancel={() => setConfirmReload(false)} discard={() => { setConfirmReload(false); setEditing(false); setReload(n => n + 1); }} />
  </div>;
}
