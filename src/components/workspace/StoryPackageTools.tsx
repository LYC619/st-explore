import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { createStoryPackageAdapter, readStoryPackage, type StoryPackageAdapter, type StoryPackagePreview } from '@/lib/roleplay/story-package';
import { saveStoryPackageFile } from '@/lib/roleplay/export-package-file';

const actionNames = { create: '新增', identical: '已有相同内容', conflict: '存在冲突' };
const kindNames = { story: '故事', character: '角色', worldbook: '世界书', preset: '预设', regex: '正则' };
export function StoryPackageTools({ storyId }: { storyId?: string }) {
  const { toast } = useToast(), navigate = useNavigate();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const [pending, setPending] = useState<{ adapter: StoryPackageAdapter; preview: StoryPackagePreview }>();
  async function preview(selected: File) {
    setBusy(true); setError(undefined);
    try { const adapter = createStoryPackageAdapter(); setPending({ adapter, preview: await adapter.previewImport(await readStoryPackage(selected)) }); }
    catch (reason) { toast({ title: '无法读取故事包', description: String(reason instanceof Error ? reason.message : reason), variant: 'destructive' }); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!pending) return; setBusy(true); setError(undefined);
    try {
      const result = await pending.adapter.applyImport(pending.preview);
      setPending(undefined); toast({ title: result.status === 'identical' ? '已存在相同故事' : '完整故事已导入' });
      navigate('/story/' + encodeURIComponent(result.storyId));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  async function exportStory() {
    if (!storyId) return; setBusy(true);
    try {
      const output = await createStoryPackageAdapter().exportStory(storyId), result = await saveStoryPackageFile(output);
      if (result !== 'cancelled') toast({ title: result === 'downloaded' ? '已开始下载完整故事包' : '完整故事包已导出',
        description: output.package.omissions.length ? '连接凭据、安装脚本和本机外部文件不随包迁移；详见包内 omissions。' : undefined });
    } catch (reason) { toast({ title: '导出失败', description: String(reason instanceof Error ? reason.message : reason), variant: 'destructive' }); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-wrap items-center gap-2">
    {storyId && <Button size="sm" variant="outline" disabled={busy} onClick={() => void exportStory()}>导出完整故事包</Button>}
    <Button size="sm" variant="outline" disabled={busy} onClick={() => file.current?.click()}>导入故事包</Button>
    <input ref={file} aria-label="选择完整故事包" type="file" accept=".ste-play" hidden onChange={event => {
      const selected = event.target.files?.[0]; event.target.value = ''; if (selected) void preview(selected);
    }} />
    <Dialog open={!!pending} onOpenChange={open => { if (!open && !busy) setPending(undefined); }}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>导入完整故事包</DialogTitle><DialogDescription>恢复故事的全部分支、引用资产与文件记忆。同 ID 的不同内容会阻止导入。</DialogDescription></DialogHeader>
        {pending && <>
          <p className="font-medium">{pending.preview.story.title}</p>
          <ul className="space-y-1 text-sm">{pending.preview.records.map(record => <li key={record.kind + record.id}>{kindNames[record.kind]} · {record.title}：{actionNames[record.action]}</li>)}</ul>
          <p className="text-sm">记忆与运行记录：{pending.preview.files.length} 个文件</p>
          {pending.preview.omissions.length > 0 && <details className="text-sm"><summary>未包含的内容（{pending.preview.omissions.length} 项）</summary><ul>{pending.preview.omissions.map((item, i) => <li key={i}>{item.name ?? item.field}：{item.reason === 'credential' ? '连接凭据' : item.reason === 'executable' ? '脚本请另行安装' : '本机外部路径或文件'}</li>)}</ul></details>}
          {pending.preview.conflicts.map(conflict => <p key={conflict} className="text-sm text-destructive">{conflict}</p>)}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setPending(undefined)}>取消</Button><Button disabled={busy || !pending.preview.canApply} onClick={() => void apply()}>{busy ? '正在导入…' : '确认导入故事包'}</Button></DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
  </div>;
}
