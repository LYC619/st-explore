import { useRef, useState } from 'react';
import type { PresetCatalog, PresetItem } from '@/types/preset';
import { buildImportedPreset, PACKAGE_KIND_LABELS, readPresetPackage, type PresetPackagePreview } from '@/lib/preset-package';
import { getVaultEpoch } from '@/lib/vault/active';
import { getCurrentRepo } from '@/lib/repo';
import { inspectPresetScripts } from '@/lib/preset-catalog';
import { inferPresetIdentity } from '@/lib/preset-presentation';
import { Download, FileText, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PresetCatalogFields } from './PresetCatalogFields';
import { PresetDiscardDialog } from './PresetDraftBoundary';

interface Row {
  selected: boolean; name: string; series: string; version: string; variant: string; models: string[]; files: string[];
  savedId?: string; error?: string;
}

export function PresetPackageImport({ seed, onClose, onImported }: {
  seed: PresetCatalog; onClose: () => void; onImported: (ids: string[]) => void;
}) {
  const epoch = useRef(getVaultEpoch()).current;
  const [catalog, setCatalog] = useState<PresetCatalog>({ ...seed, version: '', variant: '', releaseNotes: '', status: 'unreviewed', favorite: false, notes: '', originId: undefined, publishedAt: '', updatedAt: undefined });
  const [preview, setPreview] = useState<PresetPackagePreview | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const pendingIds = useRef<string[]>([]);
  const touchedFields = useRef(new Set<keyof PresetCatalog>());
  const picker = useRef<HTMLInputElement>(null);
  const finish = () => { if (pendingIds.current.length) onImported(pendingIds.current); onClose(); };
  const changeRow = (key: string, patch: Partial<Row>) => setRows(rows => ({ ...rows, [key]: { ...rows[key], ...patch } }));
  const read = async (files: File[]) => {
    setBusy(true); setError('');
    try {
      if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开导入窗口');
      const result = await readPresetPackage(files);
      setPreview(result);
      setRows(Object.fromEntries(result.presets.map(candidate => {
        const hint = inferPresetIdentity(candidate.name, candidate.preset.originalData);
        return [candidate.key, {
          selected: true, name: candidate.name, series: result.presets.length > 1 ? hint.series ?? '' : '',
          version: result.presets.length > 1 ? hint.version ?? '' : '', variant: '', models: result.presets.length > 1 ? hint.models : [],
          files: result.presets.length === 1 ? result.files.map(file => file.id) : [],
        }];
      })));
      const hint = result.presets.length === 1 ? inferPresetIdentity(result.presets[0].name, result.presets[0].preset.originalData) : undefined;
      setCatalog(value => ({ ...value,
        ...(!touchedFields.current.has('series') ? { series: seed.series || hint?.series } : {}),
        ...(!touchedFields.current.has('version') ? { version: hint?.version } : {}),
        ...(!touchedFields.current.has('models') ? { models: hint?.models.length ? hint.models : seed.models } : {}),
        ...(!touchedFields.current.has('purposes') ? { purposes: hint?.purposes.length ? hint.purposes : seed.purposes } : {}),
        ...(!touchedFields.current.has('releaseNotes') ? { releaseNotes: result.presets.length === 1 ? result.files.filter(file => file.kind === 'notes').map(file => file.text).join('\n\n') : '' } : {}),
      }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!preview) return;
    setBusy(true); setError('');
    const target = getCurrentRepo<PresetItem>('presets');
    let failed = false;
    for (const candidate of preview.presets) {
      const row = rows[candidate.key];
      if (!row.selected || row.savedId) continue;
      try {
        if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，本批剩余项目已停止');
        const item = buildImportedPreset({ ...candidate, name: row.name }, {
          ...catalog, series: row.series || catalog.series, version: row.version || catalog.version, variant: row.variant || catalog.variant,
          models: row.models.length ? row.models : catalog.models,
        }, preview.files.filter(file => row.files.includes(file.id)));
        await target.put(item);
        pendingIds.current.push(item.id);
        changeRow(candidate.key, { savedId: item.id, error: undefined });
      } catch (e) { failed = true; changeRow(candidate.key, { error: e instanceof Error ? e.message : String(e) }); }
    }
    setBusy(false);
    if (failed) setError('部分项目未入库，已成功的不会重复导入；可保留当前输入并重试。');
    else finish();
  };
  const remaining = Object.values(rows).filter(row => row.selected && !row.savedId).length;
  return <>
    <Dialog open onOpenChange={open => { if (!open && !busy) setDiscard(true); }}>
      <DialogContent className="max-w-4xl top-[calc(50%+var(--app-chrome-h,0px)/2)] max-h-[min(90dvh,calc(100dvh-var(--app-chrome-h,0px)-1rem))] flex flex-col overflow-hidden" onInteractOutside={e => e.preventDefault()}>
        <DialogHeader><DialogTitle>导入预设</DialogTitle><DialogDescription>选择作者的 JSON，可同时带上正则、脚本和说明。先自动识别，再确认入库。</DialogDescription></DialogHeader>
        <input ref={picker} aria-label="选择预设和附带文件" className="hidden" type="file" multiple accept=".json,.js,.mjs,.md,.txt" disabled={busy || pendingIds.current.length > 0} onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) void read(files); }} />
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {!preview ? <button className="w-full my-3 py-16 px-6 flex flex-col items-center text-center gap-3 rounded-xl border-2 border-dashed border-[color:var(--border-strong)] bg-[var(--hover-overlay)] hover:bg-[var(--brand-active-bg)] transition-colors" disabled={busy} onClick={() => picker.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy && e.dataTransfer.files.length) void read(Array.from(e.dataTransfer.files)); }}><Download className="w-9 h-9 text-brand" /><span className="font-medium">{busy ? '正在识别…' : '拖入文件，或点击选择'}</span><span className="text-sm text-muted-foreground">预设 JSON · 正则与脚本 · MD / TXT 说明</span><span className="text-xs text-muted-foreground">压缩包请先解压；每个文件最多 8 MB</span></button>
          : <fieldset disabled={busy} className="min-w-0 space-y-4">
            <div className="flex items-center gap-2 py-2"><Check className="w-4 h-4 text-brand" /><p className="text-sm flex-1">识别到 {preview.presets.length} 份预设 · {preview.files.length} 个附件</p><Button variant="ghost" size="sm" disabled={pendingIds.current.length > 0} onClick={() => picker.current?.click()}>重新选文件</Button></div>
            {preview.errors.map((message, i) => <p role="alert" key={i} className="text-sm text-destructive">{message}</p>)}
            {preview.presets.length === 0 && <p className="text-sm text-destructive">没有识别到聊天补全预设，请选择包含 prompts 的预设 JSON。</p>}
            <div className="grid gap-5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="space-y-3">
                <h3 className="text-sm font-medium">文件与识别结果</h3>
                {preview.presets.length > 1 && preview.files.length > 0 && <p className="text-xs text-muted-foreground">多份预设请分别勾选附件归属，未选附件不入库。</p>}
                {preview.presets.map(candidate => {
                  const row = rows[candidate.key], hint = inferPresetIdentity(candidate.name, candidate.preset.originalData);
                  return <fieldset key={candidate.key} disabled={!!row.savedId} className="min-w-0 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--hover-overlay)] p-3 space-y-2">
                    <div className="flex gap-2 items-start"><FileText className="w-4 h-4 mt-1 text-brand shrink-0" />{preview.presets.length > 1 && <Checkbox aria-label={`导入 ${candidate.name}`} checked={row.selected} onCheckedChange={value => changeRow(candidate.key, { selected: !!value })} />}<span className="text-sm font-medium break-words">{hint.displayName}{row.savedId && ' · 已入库'}</span></div>
                    <p className="text-xs text-muted-foreground">{[hint.version, ...hint.models].filter(Boolean).join(' · ') || '保留原文件内容'}<span className="block mt-1">{candidate.preset.prompts.length} 提示词 · {candidate.preset.regexRules.length} 正则 · {inspectPresetScripts(candidate.preset.originalData).length} 脚本</span></p>
                    {candidate.duplicateTitles.length > 0 && <p className="text-xs text-[color:var(--status-warn)]">已有相同内容：{candidate.duplicateTitles.join('、')}。继续会独立保存。</p>}
                    <details className="text-xs"><summary className="cursor-pointer min-h-8 pt-1 text-muted-foreground">调整本项</summary><div className="space-y-2 py-2">
                      <label className="block space-y-1">预设名称<Input value={row.name} onChange={e => changeRow(candidate.key, { name: e.target.value })} /></label>
                      {preview.presets.length > 1 && <><label className="block space-y-1">本项系列<Input value={row.series} onChange={e => changeRow(candidate.key, { series: e.target.value })} /></label><label className="block space-y-1">本项版本<Input value={row.version} placeholder={catalog.version || '沿用共同版本'} onChange={e => changeRow(candidate.key, { version: e.target.value })} /></label><label className="block space-y-1">本项模型<Input value={row.models.join('，')} placeholder={catalog.models?.join('，') || '可用逗号分隔'} onChange={e => changeRow(candidate.key, { models: e.target.value ? e.target.value.split(/[,，]/) : [] })} /></label></>}
                      <label className="block space-y-1">本项变体<Input value={row.variant} placeholder={catalog.variant || '选填'} onChange={e => changeRow(candidate.key, { variant: e.target.value })} /></label>
                    </div></details>
                    {preview.files.map(file => <label key={file.id} className="flex items-center gap-2 text-xs min-h-8"><Checkbox checked={row.files.includes(file.id)} onCheckedChange={checked => changeRow(candidate.key, { files: checked ? [...row.files, file.id] : row.files.filter(id => id !== file.id) })} /><span className="break-all">{PACKAGE_KIND_LABELS[file.kind]} · {file.name}</span></label>)}
                    {row.error && <p role="alert" className="text-sm text-destructive">{row.error}</p>}
                  </fieldset>;
                })}
                {preview.files.length > 0 && <p className="text-xs text-muted-foreground leading-relaxed">所选说明原文随附件保留，脚本只归档。单份预设已自动选中全部附件。</p>}
              </div>
              {!!preview.presets.length && <div className="space-y-3"><h3 className="text-sm font-medium">{preview.presets.length > 1 ? '共同资料（选填）' : '确认资料'}</h3><p className="text-xs text-muted-foreground leading-relaxed">模型与版本来自名称或当前配置，先帮你填好；无需填完所有项也能导入。</p><PresetCatalogFields compact value={catalog} onChange={value => { for (const key of Object.keys(value) as (keyof PresetCatalog)[]) if (JSON.stringify(value[key]) !== JSON.stringify(catalog[key])) touchedFields.current.add(key); setCatalog(value); }} /></div>}
            </div>
          </fieldset>}
          {error && <p role="alert" className="text-sm text-destructive mt-3">{error}</p>}
        </div>
        <div className="shrink-0 border-t pt-3 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setDiscard(true)}>关闭</Button><Button disabled={busy || !remaining} onClick={() => void save()}>{busy ? '处理中…' : `导入 ${remaining} 份预设`}</Button></div>
      </DialogContent>
    </Dialog>
    <PresetDiscardDialog open={discard} cancel={() => setDiscard(false)} discard={finish} />
  </>;
}
