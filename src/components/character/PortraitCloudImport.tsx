import { useEffect, useRef, useState } from 'react';
import { CloudDownload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { downloadPortrait, type PortraitLink } from '@/lib/portrait-cloud';
import { addPortraitFiles } from '@/lib/portrait-store';
import { getVaultEpoch } from '@/lib/vault/active';
import type { ArchiveCharacter } from '@/types/archive';
import type { CharacterPatch } from '@/lib/character-write';

type LinkState = PortraitLink & { selected: boolean; result?: string; saved?: boolean };
export function PortraitCloudImport({ character, onPatch }: { character: ArchiveCharacter; onPatch: (patch: CharacterPatch) => Promise<ArchiveCharacter> }) {
  const [open, setOpen] = useState(false), [source, setSource] = useState(''), [pattern, setPattern] = useState('');
  const [template, setTemplate] = useState(''), [encode, setEncode] = useState(true), [row, setRow] = useState('');
  const [links, setLinks] = useState<LinkState[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [previewing, setPreviewing] = useState(false);
  const controller = useRef<AbortController>(), worker = useRef<Worker>(), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); worker.current?.terminate(); }; }, []);
  const invalidate = () => { worker.current?.terminate(); worker.current = undefined; setPreviewing(false); setLinks([]); setError(''); };
  const preview = () => {
    invalidate(); setPreviewing(true);
    const current = new Worker(new URL('../../lib/portrait-cloud.worker.ts', import.meta.url), { type: 'module' }); worker.current = current;
    const finish = (message: { links?: PortraitLink[]; error?: string }) => {
      current.terminate(); clearTimeout(timer);
      if (!mounted.current || worker.current !== current) return;
      worker.current = undefined; setPreviewing(false); setError(message.error ?? (message.links?.length ? '' : '未提取到名称，请检查文本和正则'));
      setLinks(message.links?.map(link => ({ ...link, selected: true })) ?? []);
    };
    const timer = setTimeout(() => finish({ error: '正则处理超时，请简化规则或缩小文本范围' }), 1500);
    current.onmessage = ({ data }) => finish(data); current.onerror = () => finish({ error: '无法解析规则，请检查正则表达式' });
    current.postMessage({ source, pattern, template, encode });
  };
  const download = async () => {
    setBusy(true); setError('');
    const abort = new AbortController(); controller.current = abort; const epoch = getVaultEpoch();
    for (const link of links.filter(link => link.selected && !link.saved)) {
      if (abort.signal.aborted || epoch !== getVaultEpoch()) break;
      let result = '已保存', saved = false;
      try {
        const file = await downloadPortrait(link, abort.signal);
        abort.signal.throwIfAborted(); if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，下载停止');
        await onPatch(async current => {
          if (epoch !== getVaultEpoch()) throw new Error('资料库已切换');
          const outcome = await addPortraitFiles(current, row || null, [file]);
          if (!outcome.ok) throw new Error('图片保存失败或目标分行已删除');
          return outcome.patch;
        });
        saved = true;
      } catch (cause) { result = abort.signal.aborted ? '已取消' : cause instanceof Error ? cause.message : '下载失败（网页端可能受图床跨域限制，可用客户端重试）'; }
      if (mounted.current) setLinks(current => current.map(item => item.url === link.url ? { ...item, result, saved } : item));
    }
    if (mounted.current) { setBusy(false); if (epoch !== getVaultEpoch()) setError('资料库已切换，导入已停止'); }
  };
  return <>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)}><CloudDownload className="mr-1.5 h-4 w-4" />从图床导入</Button>
    <Dialog open={open} onOpenChange={value => { if (!value && busy) return; setOpen(value); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>从图床导入立绘</DialogTitle><DialogDescription>粘贴世界书里的立绘名称，预览拼接后的链接，再选择下载到本地。</DialogDescription></DialogHeader>
        <fieldset disabled={busy} className="space-y-3 min-w-0">
          <label className="block text-sm">名称或世界书片段<Textarea aria-label="名称或世界书片段" value={source} onChange={e => { setSource(e.target.value); invalidate(); }} rows={5} placeholder={'开心\n生气\n害羞'} /></label>
          <label className="block text-sm">提取正则（可留空，默认每行一个名称）<Input value={pattern} onChange={e => { setPattern(e.target.value); invalidate(); }} placeholder="例如：立绘名：(\S+)" /></label>
          <label className="block text-sm">图片链接模板<Input value={template} onChange={e => { setTemplate(e.target.value); invalidate(); }} placeholder="https://example.com/角色/{name}.png" /></label>
          <p className="text-xs text-muted-foreground">{'{name}'} 使用第一个捕获组或整行；支持 $1、$2、$& 和 $&lt;分组名&gt;。直接粘贴完整链接时填 $&amp;，并取消编码。</p>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={encode} onChange={e => { setEncode(e.target.checked); invalidate(); }} />对提取的名称进行 URL 编码（中文、空格等）</label>
          <label className="flex gap-2 items-center text-sm">保存到<select className="bg-background border rounded p-1.5" value={row} onChange={e => setRow(e.target.value)}><option value="">未分行</option>{character.portraitRows?.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
          <Button variant="secondary" onClick={preview} disabled={previewing || !source.trim() || !template.trim()}>{previewing ? '正在提取…' : '预览链接'}</Button>
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!!links.length && <>
          <div className="flex justify-between text-sm"><label><input type="checkbox" disabled={busy} checked={links.every(link => link.selected)} onChange={e => setLinks(current => current.map(link => ({ ...link, selected: e.target.checked })))} /> 全选 · {links.length} 个链接</label><span>已保存 {links.filter(link => link.saved).length} 张</span></div>
          <div className="max-h-60 overflow-auto border rounded divide-y">{links.map(link => <label key={link.url} className="flex gap-2 p-2 text-sm items-start"><input type="checkbox" disabled={busy || link.saved} checked={link.selected} onChange={e => setLinks(current => current.map(item => item.url === link.url ? { ...item, selected: e.target.checked } : item))} /><span className="min-w-0"><strong className="font-medium">{link.name}</strong><span className="block text-xs text-muted-foreground break-all">{link.url}</span>{link.result && <span className={link.saved ? 'text-primary' : 'text-destructive'}>{link.result}</span>}</span></label>)}</div>
          <div className="flex justify-end gap-2">{busy ? <Button variant="outline" onClick={() => controller.current?.abort()}>停止下载</Button> : <Button onClick={() => void download()} disabled={!links.some(link => link.selected && !link.saved)}>下载所选{links.some(link => link.result && !link.saved) ? ' / 重试失败项' : ''}</Button>}</div>
          <p className="text-xs text-muted-foreground">逐张保存，失败项可重试；停止后已保存的图片会保留。每张上限 20 MB。</p>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
