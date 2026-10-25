import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, FolderOpen, Upload, Save, Star, PenSquare, Download } from 'lucide-react';
import type { PresetCatalog, PresetItem, PresetPackageFile } from '@/types/preset';
import { createPresetDiy, getPreset, savePresetDetails } from '@/lib/preset-db';
import { inspectPresetScripts, normalizePresetCatalog } from '@/lib/preset-catalog';
import { exportPresetPackage, PACKAGE_KIND_LABELS, readPresetPackage } from '@/lib/preset-package';
import { getActiveVault, getVaultEpoch } from '@/lib/vault/active';
import { Button } from '@/components/ui/button';
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
    setBase(saved); setCatalog(normalizePresetCatalog(saved.catalog)); setFiles(saved.packageFiles ?? []); onSaved();
    return '管理资料和附件已保存';
  });
  if (!base) return <div className="p-4 text-sm">{error || '正在读取预设…'}{error && <Button variant="outline" onClick={() => setReload(n => n + 1)}>重试</Button>}</div>;
  return <div className="space-y-4 p-4" data-preset-details={id}>
    <div><h2 className="text-base font-semibold break-words">{base.title}</h2>
      <p className="text-xs text-muted-foreground mt-1">{base.preset.prompts.length} 个提示词 · {base.preset.regexRules.length} 条内嵌正则 · {scripts.length} 个内嵌脚本 · {files.length} 个附带文件</p></div>
    <p className="text-xs text-muted-foreground">入库 {new Date(base.createdAt).toLocaleDateString()} · 内容修改 {new Date(base.updatedAt).toLocaleDateString()}{base.catalog?.updatedAt ? ` · 资料更新 ${new Date(base.catalog.updatedAt).toLocaleDateString()}` : ''}{base.sourceModifiedAt ? ` · ST 来源修改 ${new Date(base.sourceModifiedAt).toLocaleDateString()}` : ''}</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy || dirty} onClick={() => onEdit(id)}><PenSquare className="w-4 h-4 mr-1" />编辑原版</Button>
      <Button variant="outline" disabled={busy || dirty} onClick={() => void act(async () => {
        const copy = await createPresetDiy(id); if (!live.current || epoch !== getVaultEpoch()) return;
        onSaved(); onEdit(copy.id);
      })}><Copy className="w-4 h-4 mr-1" />复制后 DIY</Button>
      <Button variant="outline" disabled={busy || dirty} onClick={() => onImport(catalog)}><Download className="w-4 h-4 mr-1" />导入同系列新版</Button>
      {getActiveVault()?.fs.openPath && <Button variant="outline" disabled={busy || dirty} onClick={() => void act(() => exportPresetPackage(id, 'folder'))}><FolderOpen className="w-4 h-4 mr-1" />打开导入文件夹</Button>}
      <Button variant="outline" disabled={busy || dirty} onClick={() => void act(() => exportPresetPackage(id, 'zip'))}><Upload className="w-4 h-4 mr-1" />导出取用包</Button>
      {catalog.sourceUrl && <Button variant="outline" disabled={busy} onClick={() => void act(() => openExternalUrl(catalog.sourceUrl!))}>打开作者发布页</Button>}
    </div>
    <p className="text-xs text-muted-foreground">打开文件夹会生成当前版本的取用副本，内含预设、附件和作者说明。DIY 会新建一份，保留原版。</p>
    <fieldset disabled={busy} className="min-w-0 space-y-3">
      <Button variant={catalog.favorite ? 'secondary' : 'outline'} onClick={() => setCatalog({ ...catalog, favorite: !catalog.favorite })} aria-pressed={!!catalog.favorite}><Star className="w-4 h-4 mr-1" />{catalog.favorite ? '已收藏' : '收藏'}</Button>
      <PresetCatalogFields value={catalog} onChange={setCatalog} />
      <div className="space-y-2 border-t pt-3">
        <h3 className="text-sm font-medium">附带文件</h3>
        <input ref={input} className="hidden" type="file" multiple accept=".json,.js,.mjs,.md,.txt" onChange={e => {
          const chosen = Array.from(e.target.files ?? []); e.target.value = '';
          if (chosen.length) void act(async () => {
            const preview = await readPresetPackage(chosen);
            if (preview.presets.length || preview.errors.length) throw new Error([...preview.errors, ...(preview.presets.length ? ['检测到预设正文，请使用“导入同系列新版”；本次未添加文件'] : [])].join('\n'));
            if (live.current && epoch === getVaultEpoch()) setFiles(previous => [...previous, ...preview.files]);
            return '附件已加入草稿，请保存资料';
          });
        }} />
        <Button variant="outline" onClick={() => input.current?.click()}>补充正则、脚本或说明</Button>
        {files.map(file => <div key={file.id} className="rounded border p-2 text-xs">
          <div className="flex items-start justify-between gap-2"><details className="min-w-0 flex-1"><summary className="cursor-pointer min-h-8 break-all">{PACKAGE_KIND_LABELS[file.kind]} · {file.name}</summary><pre className="whitespace-pre-wrap break-all max-h-60 overflow-y-auto mt-2">{file.text}</pre></details>
            <Button variant="ghost" size="sm" onClick={() => setFiles(files.filter(candidate => candidate.id !== file.id))} aria-label={`移除附件 ${file.name}`}>移除</Button></div>
        </div>)}
        {!files.length && <p className="text-xs text-muted-foreground">尚未添加独立附件。</p>}
      </div>
    </fieldset>
    <details className="text-xs border-t pt-3"><summary className="cursor-pointer min-h-8">查看预设内容、内嵌正则与脚本（只读）</summary>
      {base.preset.prompts.map((block, i) => <details key={`${block.identifier}-${i}`} className="py-1"><summary className="cursor-pointer min-h-8">提示词 · {block.name || block.identifier}</summary><pre className="whitespace-pre-wrap break-all max-h-60 overflow-y-auto">{block.content || '系统占位块'}</pre></details>)}
      {base.preset.regexRules.map(rule => <details key={rule.id} className="py-1"><summary className="cursor-pointer min-h-8">正则 · {rule.name}</summary><pre className="whitespace-pre-wrap break-all">{rule.findRegex}{'\n→\n'}{rule.replaceString}</pre></details>)}
      {scripts.map((script, i) => <details key={i} className="py-1"><summary className="cursor-pointer min-h-8">脚本 · {script.name}</summary><pre className="whitespace-pre-wrap break-all max-h-60 overflow-y-auto">{script.content}</pre></details>)}
    </details>
    {error && <p role="alert" className="text-sm text-destructive whitespace-pre-wrap">{error}</p>}
    {message && <p role="status" className="text-sm break-all">{message}</p>}
    <div className="sticky bottom-0 bg-[var(--surface-elevated)] border-t py-3 flex flex-wrap gap-2">
      <Button disabled={busy || !dirty} onClick={() => void save()}><Save className="w-4 h-4 mr-1" />{busy ? '处理中…' : '保存资料'}</Button>
      <Button variant="outline" disabled={busy} onClick={() => dirty ? setConfirmReload(true) : setReload(n => n + 1)}>重新载入</Button>
      <Button variant="ghost" disabled={busy || dirty} onClick={onDelete}>删除预设</Button>
      {dirty && <span className="text-xs self-center text-muted-foreground">有未保存的修改</span>}
    </div>
    <PresetDiscardDialog open={confirmReload} cancel={() => setConfirmReload(false)} discard={() => { setConfirmReload(false); setReload(n => n + 1); }} />
  </div>;
}
