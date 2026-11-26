import { formatList, tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useMemo, useEffect, useRef, useState  } from 'react';
import { Braces, Code, FolderOpen, Pencil, Trash2, Upload } from 'lucide-react';
import type { PresetItem } from '@/types/preset';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PresetDiscardDialog } from './PresetDraftBoundary';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { listPresetEmbeddedScripts, readPresetEmbeddedRegex, removePresetEmbeddedScript, updatePresetEmbeddedScript, type PresetScriptResource } from '@/lib/preset-resources';
import { exportSTRegex } from '@/lib/st-regex-interop';
import { saveTextFile } from '@/lib/roleplay/export-package-file';
import { safeName } from '@/lib/vault/naming';
import { getVaultEpoch } from '@/lib/vault/active';

interface Editor { source: PresetScriptResource; name: string; content: string; info: string; enabled: boolean }
export function PresetEmbeddedResources({ preset, disabled = false, onChanged, onOpenRegex, onDirty }: {
  preset: PresetItem; disabled?: boolean; onChanged: (saved: PresetItem) => void;
  onOpenRegex?: (assetId: string) => void; onDirty?: (dirty: boolean) => void;
}) {
  useI18n();
  const scripts = useMemo(() => listPresetEmbeddedScripts(preset.preset), [preset.preset]);
  const [editor, setEditor] = useState<Editor | null>(null), [discard, setDiscard] = useState(false);
  const [deleting, setDeleting] = useState<PresetScriptResource | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const pending = useRef(false), live = useRef(true), epoch = useRef(getVaultEpoch()).current;
  const dirty = !!editor && (
    editor.name !== editor.source.name
    || editor.content !== editor.source.content
    || editor.info !== editor.source.info
    || editor.enabled !== editor.source.enabled
  );
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const action = async (work: () => Promise<void>) => {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setError(''); setMessage('');
    try {
      if (epoch !== getVaultEpoch()) throw new Error(tr("资料库已切换，请重新打开预设"));
      await work();
    } catch (error) { if (live.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  };
  const close = () => { if (pending.current) return; if (dirty) setDiscard(true); else setEditor(null); };
  const exported = async (name: string, text: string) => {
    const result = await saveTextFile({ fileName: `${safeName(name)}.json`, text, label: tr("预设内嵌资源"), extension: 'json' });
    if (live.current) setMessage(result === 'cancelled' ? tr("已取消导出") : tr("已导出资源"));
  };
  return <section aria-label={tr("预设内嵌资源")} className="space-y-4">
    <div className="flex items-center gap-2"><h3 className="flex-1 text-sm font-medium">{tr("内嵌正则与脚本")}</h3><span className="text-xs text-muted-foreground">{tr("{{v0}} 条正则 · {{v1}} 个脚本", { v0: preset.preset.regexRules.length, v1: scripts.length })}</span></div>
    <div className="rounded-lg border border-[color:var(--border-subtle)] p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm"><Braces className="h-4 w-4" /><span className="flex-1">{tr("内嵌正则")}</span></div>
      {preset.preset.regexRules.length ? <>
        <p className="text-xs text-muted-foreground">{formatList(preset.preset.regexRules.map(rule => rule.name))}</p>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => void action(async () => {
          const collection = await readPresetEmbeddedRegex(preset.id);
          if (!live.current || epoch !== getVaultEpoch()) return;
          setMessage(tr("已读取到正则库；重复读取保留库中已整理的副本。"));
          onOpenRegex?.(collection.id);
        })}><FolderOpen className="w-3.5 h-3.5 mr-1" />{onOpenRegex ? tr("读取到正则库并管理") : tr("读取到正则库")}</Button>
        <Button type="button" variant="ghost" size="sm" disabled={disabled || busy} onClick={() => void action(() => exported(tr("{{v0}}-正则", { v0: preset.title }), exportSTRegex(preset.preset.regexRules)))}><Upload className="w-3.5 h-3.5 mr-1" />{tr("导出内嵌正则")}</Button></div>
      </> : <p className="text-xs text-muted-foreground">{tr("此版本没有内嵌正则。")}</p>}
    </div>
    <div className="space-y-2"><div className="flex items-center gap-2 text-sm"><Code className="w-4 h-4" /><span>{tr("内嵌脚本")}</span></div>
      {!scripts.length && <p className="text-xs text-muted-foreground">{tr("此版本没有内嵌脚本。可在附带文件中添加作者提供的脚本，再明确内置。")}</p>}
      {scripts.map(script => <details key={script.key} className="rounded-lg border border-[color:var(--border-subtle)] p-3">
        <summary className="cursor-pointer break-words text-sm flex items-center gap-2">
          <span className="flex-1 min-w-0 truncate">{script.name}</span>
          <span className="text-xs text-muted-foreground shrink-0">{script.enabled ? tr("默认开启") : tr("默认关闭")}</span>
          <Switch
            checked={script.enabled}
            disabled={disabled || busy}
            aria-label={tr("切换内嵌脚本 {{v0}} 启用状态", { v0: script.name })}
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={(checked) => void action(async () => {
              const saved = await updatePresetEmbeddedScript(preset, script.key, {
                name: script.name,
                content: script.content,
                info: script.info,
                enabled: checked,
              });
              if (live.current && epoch === getVaultEpoch()) {
                onChanged(saved);
                setMessage(checked ? tr("内嵌脚本「{{v0}}」已设为开启。", { v0: script.name }) : tr("内嵌脚本「{{v0}}」已设为关闭。", { v0: script.name }));
              }
            })}
          />
        </summary>
        {script.info && <p className="my-2 text-xs text-muted-foreground whitespace-pre-wrap">{script.info}</p>}
        <pre className="my-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--hover-overlay)] p-3 text-xs">{script.content}</pre>
        <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={() => { setError(''); setEditor({ source: script, name: script.name, content: script.content, info: script.info, enabled: script.enabled }); }}><Pencil className="w-3.5 h-3.5 mr-1" />{tr("管理脚本 · ")}{script.name}</Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled || busy} onClick={() => void action(() => exported(script.name, JSON.stringify(script.raw, null, 2)))}><Upload className="w-3.5 h-3.5 mr-1" />{tr("导出脚本")}</Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled || busy} aria-label={tr("移除内嵌脚本 {{v0}}", { v0: script.name })} onClick={() => setDeleting(script)}><Trash2 className="w-3.5 h-3.5" /></Button></div>
      </details>)}
    </div>
    <p className="text-xs text-muted-foreground">{tr("正则读取后在正则库管理副本；脚本在此保存回当前预设，保留原有 ID 和其他作者字段。读取和查看均不运行脚本。")}</p>
    {error && !editor && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    <Dialog open={!!editor} onOpenChange={open => { if (!open) close(); }}><DialogContent className="max-w-4xl max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{tr("管理内嵌脚本")}</DialogTitle><DialogDescription>{tr("修改名称、说明或源码后，明确保存到当前预设。")}</DialogDescription></DialogHeader>
      {editor && <><Input aria-label={tr("内嵌脚本名称")} value={editor.name} disabled={busy} onChange={e => setEditor({ ...editor, name: e.target.value })} />
        <Textarea aria-label={tr("内嵌脚本说明")} value={editor.info} disabled={busy} onChange={e => setEditor({ ...editor, info: e.target.value })} rows={2} />
        <Textarea aria-label={tr("内嵌脚本源码")} value={editor.content} disabled={busy} onChange={e => setEditor({ ...editor, content: e.target.value })} className="min-h-[40dvh] font-mono text-xs" />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={close}>{tr("关闭")}</Button><Button type="button" disabled={busy || disabled || !dirty || !editor.name.trim()} onClick={() => void action(async () => {
          const saved = await updatePresetEmbeddedScript(preset, editor.source.key, editor);
          if (!live.current || epoch !== getVaultEpoch()) return;
          setEditor(null); onChanged(saved); setMessage(tr("内嵌脚本已保存。"));
        })}>{busy ? tr("保存中…") : tr("保存内嵌脚本")}</Button></DialogFooter>
      </>}
    </DialogContent></Dialog>
    <PresetDiscardDialog open={discard} cancel={() => setDiscard(false)} discard={() => { setDiscard(false); setEditor(null); setError(''); }} />
    <DeleteConfirmDialog open={!!deleting} title={tr("移除内嵌脚本「{{v0}}」？", { v0: deleting?.name || '' })} description={tr("从当前预设中移除此脚本，其他脚本和已导出的副本保留。")} onOpenChange={open => { if (!open) setDeleting(null); }} onConfirm={async () => {
      if (!deleting || disabled || pending.current) return false;
      pending.current = true; setBusy(true);
      try {
        if (epoch !== getVaultEpoch()) throw new Error(tr("资料库已切换，请重新打开预设"));
        const saved = await removePresetEmbeddedScript(preset, deleting.key);
        if (live.current && epoch === getVaultEpoch()) onChanged(saved);
        return true;
      } finally { pending.current = false; if (live.current) setBusy(false); }
    }} />
  </section>;
}
