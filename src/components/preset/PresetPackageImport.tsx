import { formatList, tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useEffect, useRef, useState } from 'react';
import type { PresetCatalog } from '@/types/preset';
import { generateWorldBookId } from '@/types/worldbook';
import { buildImportedPreset, PACKAGE_KIND_LABELS, readPresetPackage, type PresetPackagePreview } from '@/lib/preset-package';
import { getVaultEpoch } from '@/lib/vault/active';
import { saveImportedPreset } from '@/lib/preset-db';
import { saveWorldBook } from '@/lib/worldbook-db';
import { getPresetTags } from '@/lib/preset-tag-values';
import { stableJson } from '@/lib/roleplay/fingerprint';
import { inspectPresetScripts } from '@/lib/preset-catalog';
import { inferPresetIdentity } from '@/lib/preset-presentation';
import { Download, FileText, Check, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PresetCatalogFields } from './PresetCatalogFields';
import { PresetDiscardDialog } from './PresetDraftBoundary';

interface Row {
  selected: boolean; name: string; series: string; version: string; variant: string; models: string[]; files: string[];
  modelsTouched?: boolean; seriesTouched?: boolean; versionTouched?: boolean;
  savedId?: string; error?: string;
}

interface WbRow {
  selected: boolean;
  name: string;
  savedId?: string;
  error?: string;
}

export function PresetPackageImport({ seed, onClose, onImported, onDirtyChange }: {
  seed: PresetCatalog; onClose: () => void; onImported: (ids: string[]) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  useI18n();
  const epoch = useRef(getVaultEpoch()).current;
  const [catalog, setCatalog] = useState<PresetCatalog>({ ...seed, name: '', version: '', variant: '', releaseNotes: '', status: 'unreviewed', favorite: false, notes: '', originId: undefined, publishedAt: '', updatedAt: undefined });
  const initialTags = useRef(getPresetTags(catalog).sort()).current;
  const [preview, setPreview] = useState<PresetPackagePreview | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [wbRows, setWbRows] = useState<Record<string, WbRow>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const [editedCount, setEditedCount] = useState(0);
  const pendingIds = useRef<string[]>([]);
  const touchedFields = useRef(new Set<keyof PresetCatalog>());
  const picker = useRef<HTMLInputElement>(null);

  const hasUnsavedWork = Boolean(preview || editedCount > 0 || pendingIds.current.length > 0);
  useEffect(() => {
    onDirtyChange?.(hasUnsavedWork);
    return () => { onDirtyChange?.(false); };
  }, [hasUnsavedWork, onDirtyChange]);

  const finish = () => { if (pendingIds.current.length) onImported(pendingIds.current); onClose(); };
  const requestClose = () => {
    if (busy) return;
    if (!hasUnsavedWork) {
      finish();
      return;
    }
    setDiscard(true);
  };
  const changeRow = (key: string, patch: Partial<Row>) => setRows(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  const changeWbRow = (key: string, patch: Partial<WbRow>) => setWbRows(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const read = async (files: File[]) => {
    setBusy(true); setError('');
    try {
      if (epoch !== getVaultEpoch()) throw new Error(tr("资料库已切换，请重新打开导入窗口"));
      const result = await readPresetPackage(files);
      setPreview(result);
      setRows(Object.fromEntries(result.presets.map(candidate => {
        const hint = inferPresetIdentity(candidate.name, candidate.preset.originalData);
        return [candidate.key, {
          selected: true, name: hint.displayName, series: '',
          version: result.presets.length > 1 ? hint.version ?? '' : '', variant: '', models: result.presets.length > 1 ? hint.models : [],
          files: result.presets.length === 1 ? result.files.map(file => file.id) : [],
        }];
      })));
      setWbRows(Object.fromEntries(result.worldbooks.map(wb => [wb.key, {
        selected: true,
        name: wb.name,
      }])));
      const hint = result.presets.length === 1 ? inferPresetIdentity(result.presets[0].name, result.presets[0].preset.originalData) : undefined;
      setCatalog(value => ({
        ...value,
        ...(!touchedFields.current.has('name') ? { name: hint?.displayName } : {}),
        ...(!touchedFields.current.has('series') ? { series: seed.series || hint?.series } : {}),
        ...(!touchedFields.current.has('version') ? { version: hint?.version } : {}),
        ...(!touchedFields.current.has('models') ? { models: hint?.models.length ? hint.models : seed.models } : {}),
        ...(!touchedFields.current.has('releaseNotes') ? { releaseNotes: result.presets.length === 1 ? result.files.filter(file => file.kind === 'notes').map(file => file.text).join('\n\n') : '' } : {}),
      }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!preview) return;
    setBusy(true); setError('');
    const tagsExplicit = stableJson(getPresetTags(catalog).sort()) !== stableJson(initialTags);
    let failed = false;
    for (const candidate of preview.presets) {
      const row = rows[candidate.key];
      if (!row?.selected || row.savedId) continue;
      try {
        if (epoch !== getVaultEpoch()) throw new Error(tr("资料库已切换，本批剩余项目已停止"));
        const item = buildImportedPreset(candidate, {
          ...catalog,
          name: preview.presets.length === 1 ? catalog.name || row.name : row.name,
          series: row.seriesTouched ? row.series : (row.series || catalog.series),
          seriesConfirmed: row.seriesTouched || catalog.seriesConfirmed,
          version: row.versionTouched ? row.version : (row.version || catalog.version),
          versionConfirmed: row.versionTouched || catalog.versionConfirmed,
          variant: row.variant || catalog.variant,
          models: row.modelsTouched ? row.models : touchedFields.current.has('models') ? catalog.models : row.models.length ? row.models : catalog.models,
          modelsConfirmed: row.modelsTouched || catalog.modelsConfirmed,
        }, preview.files.filter(file => row.files.includes(file.id)));
        await saveImportedPreset(item, { tagsExplicit, epoch });
        pendingIds.current.push(item.id);
        changeRow(candidate.key, { savedId: item.id, error: undefined });
      } catch (e) { failed = true; changeRow(candidate.key, { error: e instanceof Error ? e.message : String(e) }); }
    }
    for (const wb of preview.worldbooks) {
      const row = wbRows[wb.key];
      if (!row?.selected || row.savedId) continue;
      try {
        if (epoch !== getVaultEpoch()) throw new Error(tr("资料库已切换，本批剩余项目已停止"));
        const id = generateWorldBookId();
        const now = Date.now();
        await saveWorldBook({
          id,
          title: row.name.trim() || wb.name || tr("随预设导入世界书"),
          worldbook: structuredClone(wb.worldbook),
          createdAt: now,
          updatedAt: now,
          autoSaved: false,
        });
        changeWbRow(wb.key, { savedId: id, error: undefined });
      } catch (e) { failed = true; changeWbRow(wb.key, { error: e instanceof Error ? e.message : String(e) }); }
    }
    setBusy(false);
    if (failed) setError(tr("部分项目未入库，已成功的不会重复导入；可保留当前输入并重试。"));
    else finish();
  };

  const remainingPresets = Object.values(rows).filter(row => row.selected && !row.savedId).length;
  const remainingWorldbooks = Object.values(wbRows).filter(row => row.selected && !row.savedId).length;
  const remaining = remainingPresets + remainingWorldbooks;

  return <>
    <Dialog open onOpenChange={open => { if (!open) requestClose(); }}>
      <DialogContent className="max-w-4xl top-[calc(50%+var(--app-chrome-h,0px)/2)] max-h-[min(90dvh,calc(100dvh-var(--app-chrome-h,0px)-1rem))] flex flex-col overflow-hidden" onInteractOutside={e => { if (hasUnsavedWork) e.preventDefault(); }}>
        <DialogHeader><DialogTitle>{tr("导入预设")}</DialogTitle><DialogDescription>{tr("支持直接拖入作者发布的 .zip 压缩包或散装文件，自动识别预设、配套世界书、正则、脚本与食用说明。")}</DialogDescription></DialogHeader>
        <input ref={picker} aria-label={tr("选择预设和附带文件")} className="hidden" type="file" multiple accept=".json,.zip,.js,.mjs,.md,.txt" disabled={busy || pendingIds.current.length > 0} onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) void read(files); }} />
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {!preview ? <button type="button" className="w-full my-3 py-16 px-6 flex flex-col items-center text-center gap-3 rounded-xl border-2 border-dashed border-[color:var(--border-strong)] bg-[var(--hover-overlay)] hover:bg-[var(--brand-active-bg)] transition-colors" disabled={busy} onClick={() => picker.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy && e.dataTransfer.files.length) void read(Array.from(e.dataTransfer.files)); }}><Download className="w-9 h-9 text-brand" /><span className="font-medium">{busy ? tr("正在识别与解压…") : tr("拖入 .zip 压缩包或文件，或点击选择")}</span><span className="text-sm text-muted-foreground">{tr("预设 JSON / ZIP 包 · 配套世界书 · 正则与脚本 · MD / TXT 说明")}</span><span className="text-xs text-muted-foreground">{tr("单文件最多 8 MB，整包最多 32 MB")}</span></button>
          : <fieldset disabled={busy} className="min-w-0 space-y-4">
            <div className="flex items-center gap-2 py-2"><Check className="w-4 h-4 text-brand" /><p className="text-sm flex-1">{preview.worldbooks.length > 0 ? tr("识别到 {{v0}} 份预设 · {{v1}} 本配套世界书 · {{v2}} 个附件", { v0: preview.presets.length, v1: preview.worldbooks.length, v2: preview.files.length }) : tr("识别到 {{v0}} 份预设 · {{v1}} 个附件", { v0: preview.presets.length, v1: preview.files.length })}</p><Button type="button" variant="ghost" size="sm" disabled={pendingIds.current.length > 0} onClick={() => picker.current?.click()}>{tr("重新选文件")}</Button></div>
            {preview.errors.map((message, i) => <p role="alert" key={i} className="text-sm text-destructive">{message}</p>)}
            {preview.presets.length === 0 && preview.worldbooks.length === 0 && <p className="text-sm text-destructive">{tr("没有识别到预设或世界书，请选择 SillyTavern 聊天补全预设 JSON 或作者发布的 ZIP 压缩包。")}</p>}
            <div className="grid gap-5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="space-y-3">
                <h3 className="text-sm font-medium">{tr("文件与识别结果")}</h3>
                {preview.presets.length > 1 && preview.files.length > 0 && <p className="text-xs text-muted-foreground">{tr("多份预设请分别勾选附件归属，未选附件不入库。")}</p>}
                {preview.presets.map(candidate => {
                  const row = rows[candidate.key], hint = inferPresetIdentity(candidate.name, candidate.preset.originalData);
                  return <fieldset key={candidate.key} disabled={!!row.savedId} className="min-w-0 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--hover-overlay)] p-3 space-y-2">
                    <div className="flex gap-2 items-start"><FileText className="w-4 h-4 mt-1 text-brand shrink-0" />{preview.presets.length > 1 && <Checkbox aria-label={tr("导入 {{v0}}", { v0: candidate.name })} checked={row.selected} onCheckedChange={value => changeRow(candidate.key, { selected: !!value })} />}<span className="text-sm font-medium break-words">{hint.displayName}{row.savedId && tr(" · 已入库")}</span></div>
                    <p className="text-xs text-muted-foreground">{[hint.version, ...hint.models].filter(Boolean).join(' · ') || tr("保留原文件内容")}<span className="block mt-1">{tr("{{v0}} 提示词 · {{v1}} 正则 · {{v2}} 脚本", { v0: candidate.preset.prompts.length, v1: candidate.preset.regexRules.length, v2: inspectPresetScripts(candidate.preset.originalData).length })}</span></p>
                    {candidate.duplicateTitles.length > 0 && <p className="text-xs text-[color:var(--status-warn)]">{tr("已有相同内容：{{v0}}。继续会独立保存。", { v0: formatList(candidate.duplicateTitles) })}</p>}
                    <details className="text-xs"><summary className="cursor-pointer min-h-8 pt-1 text-muted-foreground">{tr("调整本项")}</summary><div className="space-y-2 py-2">
                      {preview.presets.length > 1 && <label className="block space-y-1">{tr("预设名称")}<Input value={row.name} onChange={e => changeRow(candidate.key, { name: e.target.value })} /></label>}
                      {preview.presets.length > 1 && <><label className="block space-y-1">{tr("本项系列")}<Input value={row.series} onChange={e => changeRow(candidate.key, { series: e.target.value, seriesTouched: true })} /></label><label className="block space-y-1">{tr("本项版本")}<Input value={row.version} placeholder={catalog.version || tr("沿用共同版本")} onChange={e => changeRow(candidate.key, { version: e.target.value, versionTouched: true })} /></label><label className="block space-y-1">{tr("本项模型")}<Input value={row.models.join('，')} placeholder={catalog.models?.join('，') || tr("可用逗号分隔")} onChange={e => changeRow(candidate.key, { models: e.target.value ? e.target.value.split(/[,，]/) : [], modelsTouched: true })} /></label></>}
                      <label className="block space-y-1">{tr("本项变体")}<Input value={row.variant} placeholder={catalog.variant || tr("选填")} onChange={e => changeRow(candidate.key, { variant: e.target.value })} /></label>
                    </div></details>
                    {preview.files.map(file => <label key={file.id} className="flex items-center gap-2 text-xs min-h-8"><Checkbox checked={row.files.includes(file.id)} onCheckedChange={checked => changeRow(candidate.key, { files: checked ? [...row.files, file.id] : row.files.filter(id => id !== file.id) })} /><span className="break-all">{PACKAGE_KIND_LABELS[file.kind]} · {file.name}</span></label>)}
                    {row.error && <p role="alert" className="text-sm text-destructive">{row.error}</p>}
                  </fieldset>;
                })}
                {preview.worldbooks.map(wb => {
                  const row = wbRows[wb.key];
                  return <fieldset key={wb.key} disabled={!!row?.savedId} className="min-w-0 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--hover-overlay)] p-3 space-y-2" data-companion-worldbook>
                    <div className="flex gap-2 items-center">
                      <Globe className="w-4 h-4 text-brand shrink-0" />
                      <Checkbox aria-label={tr("导入配套世界书 {{v0}}", { v0: wb.name })} checked={!!row?.selected} onCheckedChange={value => changeWbRow(wb.key, { selected: !!value })} />
                      <span className="text-sm font-medium break-words">{tr("配套世界书 · ")}{row?.name || wb.name}{row?.savedId && tr(" · 已存入世界书库")}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{tr("共 {{v0}} 个条目，勾选后一并存入世界书库。", { v0: wb.entryCount })}</p>
                    <Input size="sm" aria-label={tr("配套世界书名称 {{v0}}", { v0: wb.name })} value={row?.name ?? wb.name} onChange={e => changeWbRow(wb.key, { name: e.target.value })} />
                    {row?.error && <p role="alert" className="text-sm text-destructive">{row.error}</p>}
                  </fieldset>;
                })}
                {preview.files.length > 0 && <p className="text-xs text-muted-foreground leading-relaxed">{tr("所选说明原文随附件保留，脚本只归档。单份预设已自动选中全部附件。")}</p>}
              </div>
              {!!preview.presets.length && <div className="space-y-3"><h3 className="text-sm font-medium">{preview.presets.length > 1 ? tr("共同资料（选填）") : tr("确认资料")}</h3><p className="text-xs text-muted-foreground leading-relaxed">{tr("模型与版本来自名称或当前配置，先帮你填好；无需填完所有项也能直接入库。")}</p><PresetCatalogFields compact multiple={preview.presets.length > 1} value={catalog} onChange={value => {
                let changed = false;
                for (const key of Object.keys(value) as (keyof PresetCatalog)[]) {
                  if (JSON.stringify(value[key]) !== JSON.stringify(catalog[key])) {
                    touchedFields.current.add(key);
                    changed = true;
                  }
                }
                if (changed) setEditedCount(n => n + 1);
                setCatalog(value);
              }} /></div>}
            </div>
          </fieldset>}
          {error && <p role="alert" className="text-sm text-destructive mt-3">{error}</p>}
        </div>
        <div className="shrink-0 border-t pt-3 flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={requestClose}>{tr("关闭")}</Button><Button type="button" disabled={busy || !remaining} onClick={() => void save()}>{busy ? tr("处理中…") : tr("导入所选（{{v0}} 项）", { v0: remaining })}</Button></div>
      </DialogContent>
    </Dialog>
    <PresetDiscardDialog open={discard} cancel={() => setDiscard(false)} discard={finish} />
  </>;
}
