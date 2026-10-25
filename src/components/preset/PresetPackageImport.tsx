import { useRef, useState } from 'react';
import type { PresetCatalog, PresetItem } from '@/types/preset';
import { buildImportedPreset, PACKAGE_KIND_LABELS, readPresetPackage, type PresetPackagePreview } from '@/lib/preset-package';
import { getVaultEpoch } from '@/lib/vault/active';
import { getCurrentRepo } from '@/lib/repo';
import { inspectPresetScripts } from '@/lib/preset-catalog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PresetCatalogFields } from './PresetCatalogFields';
import { PresetDiscardDialog } from './PresetDraftBoundary';

interface Row {
  selected: boolean; name: string; version: string; variant: string; models: string[]; files: string[];
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
  const finish = () => { if (pendingIds.current.length) onImported(pendingIds.current); onClose(); };
  const changeRow = (key: string, patch: Partial<Row>) => setRows(rows => ({ ...rows, [key]: { ...rows[key], ...patch } }));
  const read = async (files: File[]) => {
    setBusy(true); setError('');
    try {
      if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开导入窗口');
      const result = await readPresetPackage(files);
      setPreview(result);
      setRows(Object.fromEntries(result.presets.map(candidate => [candidate.key, {
        selected: true, name: candidate.name, version: '', variant: '', models: [],
        files: result.presets.length === 1 ? result.files.map(file => file.id) : [],
      }])));
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
          ...catalog, version: row.version || catalog.version, variant: row.variant || catalog.variant,
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
      <DialogContent className="max-w-5xl max-h-[90dvh] overflow-y-auto" onInteractOutside={e => e.preventDefault()}>
        <DialogHeader><DialogTitle>导入作者预设</DialogTitle><DialogDescription>一起选择预设 JSON、附带正则／脚本和 MD／TXT 说明。新版独立保存，旧版仍可使用。压缩包请先解压。</DialogDescription></DialogHeader>
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <Input aria-label="选择预设和附带文件" type="file" multiple accept=".json,.js,.mjs,.md,.txt" disabled={pendingIds.current.length > 0} onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) void read(files); }} />
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
            <div><p className="text-sm font-medium mb-3">本批共同资料（单项可覆盖版本）</p><PresetCatalogFields compact value={catalog} onChange={setCatalog} /></div>
            <div className="space-y-3">
              {!preview && <p className="py-8 text-sm text-muted-foreground">选择文件后，先在这里核对识别结果与附件归属。</p>}
              {preview?.errors.map((message, i) => <p role="alert" key={i} className="text-sm text-destructive">{message}</p>)}
              {preview && preview.presets.length === 0 && <p className="text-sm text-destructive">未识别到聊天补全预设，需要包含 prompts 和 prompt_order 的 JSON。已识别 {preview.files.length} 个附件。</p>}
              {preview && preview.presets.length > 1 && preview.files.length > 0 && <p className="text-sm text-muted-foreground">本批包含多份预设，请为每份勾选所属附件；未勾选的文件不会入库。</p>}
              {preview?.presets.map(candidate => {
                const row = rows[candidate.key];
                return <fieldset key={candidate.key} disabled={!!row.savedId} className="min-w-0 rounded-lg border p-3 space-y-2">
                  <label className="flex gap-2 items-center text-sm font-medium"><Checkbox checked={row.selected} onCheckedChange={value => changeRow(candidate.key, { selected: !!value })} />{candidate.name}{row.savedId && ' · 已入库'}</label>
                  <p className="text-xs text-muted-foreground">{candidate.preset.prompts.length} 个提示词 · {candidate.preset.regexRules.length} 条内嵌正则 · {inspectPresetScripts(candidate.preset.originalData).length} 个内嵌脚本</p>
                  {candidate.duplicateTitles.length > 0 && <p className="text-xs text-[color:var(--status-warn)]">内容相同：{candidate.duplicateTitles.join('、')}。继续将保存为新记录。</p>}
                  <label className="block text-xs">预设名称<Input value={row.name} onChange={e => changeRow(candidate.key, { name: e.target.value })} /></label>
                  <div className="grid grid-cols-2 gap-2"><label className="text-xs">本项版本<Input value={row.version} placeholder={catalog.version || '沿用本批版本'} onChange={e => changeRow(candidate.key, { version: e.target.value })} /></label>
                    <label className="text-xs">本项变体<Input value={row.variant} placeholder={catalog.variant || '沿用本批变体'} onChange={e => changeRow(candidate.key, { variant: e.target.value })} /></label></div>
                  <label className="block text-xs">本项模型<Input value={row.models.join('，')} placeholder={catalog.models?.join('，') || '沿用本批模型'} onChange={e => changeRow(candidate.key, { models: e.target.value ? e.target.value.split(/[,，]/) : [] })} /></label>
                  {!!candidate.suggestedModels.length && <div className="text-xs text-muted-foreground">识别候选（未经实测）：{candidate.suggestedModels.join('、')} <Button size="sm" variant="ghost" onClick={() => changeRow(candidate.key, { models: candidate.suggestedModels })}>采用候选</Button></div>}
                  {preview.files.map(file => <label key={file.id} className="flex items-center gap-2 text-xs min-h-8"><Checkbox checked={row.files.includes(file.id)} onCheckedChange={checked => changeRow(candidate.key, { files: checked ? [...row.files, file.id] : row.files.filter(id => id !== file.id) })} /><span className="break-all">{PACKAGE_KIND_LABELS[file.kind]} · {file.name}</span></label>)}
                  {row.error && <p role="alert" className="text-sm text-destructive">{row.error}</p>}
                </fieldset>;
              })}
              {preview && preview.files.length > 0 && <p className="text-xs text-muted-foreground">说明文件原文随附件保留；共同发布说明留空时，从所选 MD / TXT 汇入。脚本仅归档，不自动运行。</p>}
              {!!preview?.files.length && <details className="text-xs border-t pt-2"><summary className="cursor-pointer min-h-8">查看随包文件原文</summary>{preview.files.map(file => <details key={file.id}><summary className="cursor-pointer min-h-8 break-all">{PACKAGE_KIND_LABELS[file.kind]} · {file.name}</summary><pre className="whitespace-pre-wrap break-all max-h-52 overflow-y-auto">{file.text}</pre></details>)}</details>}
            </div>
          </div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setDiscard(true)}>关闭</Button><Button disabled={busy || !remaining} onClick={() => void save()}>{busy ? '处理中…' : `导入 ${remaining} 份预设`}</Button></div>
      </DialogContent>
    </Dialog>
    <PresetDiscardDialog open={discard} cancel={() => setDiscard(false)} discard={finish} />
  </>;
}
