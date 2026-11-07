import { useEffect, useMemo, useRef, useState } from 'react';
import { Braces, Code, FolderOpen, Pencil, Trash2, Upload } from 'lucide-react';
import type { PresetItem } from '@/types/preset';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PresetDiscardDialog } from './PresetDraftBoundary';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { listPresetEmbeddedScripts, readPresetEmbeddedRegex, removePresetEmbeddedScript, updatePresetEmbeddedScript, type PresetScriptResource } from '@/lib/preset-resources';
import { exportSTRegex } from '@/lib/st-regex-interop';
import { saveTextFile } from '@/lib/roleplay/export-package-file';
import { safeName } from '@/lib/vault/naming';
import { getVaultEpoch } from '@/lib/vault/active';

interface Editor { source: PresetScriptResource; name: string; content: string; info: string }
export function PresetEmbeddedResources({ preset, disabled = false, onChanged, onOpenRegex, onDirty }: {
  preset: PresetItem; disabled?: boolean; onChanged: (saved: PresetItem) => void;
  onOpenRegex?: (assetId: string) => void; onDirty?: (dirty: boolean) => void;
}) {
  const scripts = useMemo(() => listPresetEmbeddedScripts(preset.preset), [preset.preset]);
  const [editor, setEditor] = useState<Editor | null>(null), [discard, setDiscard] = useState(false);
  const [deleting, setDeleting] = useState<PresetScriptResource | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const pending = useRef(false), live = useRef(true), epoch = useRef(getVaultEpoch()).current;
  const dirty = !!editor && (editor.name !== editor.source.name || editor.content !== editor.source.content || editor.info !== editor.source.info);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const action = async (work: () => Promise<void>) => {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setError(''); setMessage('');
    try {
      if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开预设');
      await work();
    } catch (error) { if (live.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  };
  const close = () => { if (pending.current) return; if (dirty) setDiscard(true); else setEditor(null); };
  const exported = async (name: string, text: string) => {
    const result = await saveTextFile({ fileName: `${safeName(name)}.json`, text, label: '预设内嵌资源', extension: 'json' });
    if (live.current) setMessage(result === 'cancelled' ? '已取消导出' : '已导出资源');
  };
  return <section aria-label="预设内嵌资源" className="space-y-4">
    <div className="flex items-center gap-2"><h3 className="flex-1 text-sm font-medium">内嵌正则与脚本</h3><span className="text-xs text-muted-foreground">{preset.preset.regexRules.length} 条正则 · {scripts.length} 个脚本</span></div>
    <div className="rounded-lg border border-[color:var(--border-subtle)] p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm"><Braces className="h-4 w-4" /><span className="flex-1">内嵌正则</span></div>
      {preset.preset.regexRules.length ? <>
        <p className="text-xs text-muted-foreground">{preset.preset.regexRules.map(rule => rule.name).join('、')}</p>
        <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={disabled || busy} onClick={() => void action(async () => {
          const collection = await readPresetEmbeddedRegex(preset.id);
          if (!live.current || epoch !== getVaultEpoch()) return;
          setMessage('已读取到正则库；重复读取保留库中已整理的副本。');
          onOpenRegex?.(collection.id);
        })}><FolderOpen className="w-3.5 h-3.5 mr-1" />读取到正则库{onOpenRegex ? '并管理' : ''}</Button>
        <Button variant="ghost" size="sm" disabled={disabled || busy} onClick={() => void action(() => exported(`${preset.title}-正则`, exportSTRegex(preset.preset.regexRules)))}><Upload className="w-3.5 h-3.5 mr-1" />导出内嵌正则</Button></div>
      </> : <p className="text-xs text-muted-foreground">此版本没有内嵌正则。</p>}
    </div>
    <div className="space-y-2"><div className="flex items-center gap-2 text-sm"><Code className="w-4 h-4" /><span>内嵌脚本</span></div>
      {!scripts.length && <p className="text-xs text-muted-foreground">此版本没有内嵌脚本。可在附带文件中添加作者提供的脚本，再明确内置。</p>}
      {scripts.map(script => <details key={script.key} className="rounded-lg border border-[color:var(--border-subtle)] p-3">
        <summary className="cursor-pointer break-words text-sm">{script.name}</summary>
        {script.info && <p className="my-2 text-xs text-muted-foreground whitespace-pre-wrap">{script.info}</p>}
        <pre className="my-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--hover-overlay)] p-3 text-xs">{script.content}</pre>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => { setError(''); setEditor({source:script,name:script.name,content:script.content,info:script.info}); }}><Pencil className="w-3.5 h-3.5 mr-1" />管理脚本 · {script.name}</Button>
          <Button size="sm" variant="ghost" disabled={disabled || busy} onClick={() => void action(() => exported(script.name,JSON.stringify(script.raw,null,2)))}><Upload className="w-3.5 h-3.5 mr-1" />导出脚本</Button>
          <Button size="sm" variant="ghost" disabled={disabled || busy} aria-label={`移除内嵌脚本 ${script.name}`} onClick={() => setDeleting(script)}><Trash2 className="w-3.5 h-3.5" /></Button></div>
      </details>)}
    </div>
    <p className="text-xs text-muted-foreground">正则读取后在正则库管理副本；脚本在此保存回当前预设，保留原有 ID 和其他作者字段。读取和查看均不运行脚本。</p>
    {error && !editor && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    <Dialog open={!!editor} onOpenChange={open => { if (!open) close(); }}><DialogContent className="max-w-4xl max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>管理内嵌脚本</DialogTitle><DialogDescription>修改名称、说明或源码后，明确保存到当前预设。</DialogDescription></DialogHeader>
      {editor && <><Input aria-label="内嵌脚本名称" value={editor.name} disabled={busy} onChange={e => setEditor({...editor,name:e.target.value})} />
        <Textarea aria-label="内嵌脚本说明" value={editor.info} disabled={busy} onChange={e => setEditor({...editor,info:e.target.value})} rows={2} />
        <Textarea aria-label="内嵌脚本源码" value={editor.content} disabled={busy} onChange={e => setEditor({...editor,content:e.target.value})} className="min-h-[40dvh] font-mono text-xs" />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="ghost" disabled={busy} onClick={close}>关闭</Button><Button disabled={busy || disabled || !dirty || !editor.name.trim()} onClick={() => void action(async () => {
          const saved = await updatePresetEmbeddedScript(preset,editor.source.key,editor);
          if (!live.current || epoch !== getVaultEpoch()) return;
          setEditor(null); onChanged(saved); setMessage('内嵌脚本已保存。');
        })}>{busy ? '保存中…' : '保存内嵌脚本'}</Button></DialogFooter>
      </>}
    </DialogContent></Dialog>
    <PresetDiscardDialog open={discard} cancel={() => setDiscard(false)} discard={() => {setDiscard(false);setEditor(null);setError('');}} />
    <DeleteConfirmDialog open={!!deleting} title={`移除内嵌脚本「${deleting?.name || ''}」？`} description="从当前预设中移除此脚本，其他脚本和已导出的副本保留。" onOpenChange={open => {if(!open)setDeleting(null);}} onConfirm={async () => {
      if (!deleting || disabled || pending.current) return false;
      pending.current = true; setBusy(true);
      try {
        if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开预设');
        const saved = await removePresetEmbeddedScript(preset,deleting.key);
        if (live.current && epoch === getVaultEpoch()) onChanged(saved);
        return true;
      } finally { pending.current = false; if (live.current) setBusy(false); }
    }} />
  </section>;
}
