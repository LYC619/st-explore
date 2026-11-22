import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CloudDownload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CATBOX_WORLDBOOK_PRESET } from '@/lib/portrait-cloud';
import { portraitCloudTasks } from '@/lib/portrait-cloud-task';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { normalizePortraitUrl, parsePortraitList, DEFAULT_PORTRAIT_HOST, type PortraitParseResult } from '@/lib/portrait-list-parser';
import { buildPortraitPreview, recommendPortraitRow, loadPortraitImportPreferences, savePortraitImportPreferences, type PortraitPreviewRow } from '@/lib/portrait-import-preferences';
import type { PortraitExampleRule } from '@/lib/portrait-example-rule';
import { portraitPreviewCache } from '@/lib/portrait-preview-cache';
import { PortraitImportPreview } from './PortraitImportPreview';
import { PortraitExampleRuleEditor } from './PortraitExampleRuleEditor';
import { PortraitCloudTaskProgress } from './PortraitCloudTasks';
import type { ArchiveCharacter } from '@/types/archive';

const EMPTY: PortraitParseResult = { items: [], failed: [], skipped: [] };
export function PortraitCloudImport({ character }: { character: ArchiveCharacter }) {
  const [preferences] = useState(loadPortraitImportPreferences);
  const [open, setOpen] = useState(false), [source, setSource] = useState('');
  const [mode, setMode] = useState<'auto' | 'advanced'>(preferences?.mode ?? 'auto');
  const [host, setHost] = useState(preferences?.host ?? DEFAULT_PORTRAIT_HOST), [pattern, setPattern] = useState(preferences?.pattern ?? '');
  const [template, setTemplate] = useState(preferences?.template ?? ''), [encode, setEncode] = useState(preferences?.encode ?? true);
  const [rule, setRule] = useState<PortraitExampleRule | undefined>(preferences?.rule);
  const [rows, setRows] = useState<PortraitPreviewRow[]>([]), [error, setError] = useState(''), [previewing, setPreviewing] = useState(false);
  const [globalRow, setGlobalRow] = useState('__auto__'), [parsed, setParsed] = useState(EMPTY);
  const worker = useRef<Worker>(), currentCharacter = useRef(character), parsedRef = useRef(EMPTY), sequence = useRef(0), globalRowRef = useRef(globalRow);
  currentCharacter.current = character; globalRowRef.current = globalRow;
  const task = useSyncExternalStore(portraitCloudTasks.subscribe, portraitCloudTasks.getSnapshot);
  const epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch, getVaultEpoch);
  const currentTask = task?.target.characterId === character.id && task.epoch === getVaultEpoch() ? task : null;
  const busy = task?.status === 'running' || task?.status === 'cancelling';
  useEffect(() => {
    const counter = sequence, token = ++counter.current, epoch = getVaultEpoch();
    worker.current?.terminate(); setError('');
    if (!open) { setPreviewing(false); return; }
    if (!source.trim()) { setRows([]); setParsed(EMPTY); parsedRef.current = EMPTY; setPreviewing(false); return; }
    setPreviewing(true);
    let current: Worker | undefined, timeout: ReturnType<typeof setTimeout> | undefined;
    const debounce = setTimeout(() => {
      const finish = (message: { result?: PortraitParseResult; error?: string }) => {
        current?.terminate(); clearTimeout(timeout);
        if (counter.current !== token || epoch !== getVaultEpoch()) return;
        worker.current = undefined; setPreviewing(false); setError(message.error ?? '');
        const result = message.result ?? EMPTY; setParsed(result); parsedRef.current = result;
        setRows(previous => buildPortraitPreview(result, previous, currentCharacter.current).map(row =>
          globalRowRef.current !== '__auto__' && !row.manualRow ? { ...row, rowId: globalRowRef.current || null, manualRow: true } : row));
      };
      try {
        current = new Worker(new URL('../../lib/portrait-cloud.worker.ts', import.meta.url), { type: 'module' }); worker.current = current;
        current.onmessage = ({ data }) => finish(data); current.onerror = () => finish({ error: '无法解析，请检查高级规则或逐行修改' });
        timeout = setTimeout(() => finish({ error: '解析超过 1.5 秒，请简化高级规则或缩小文本范围' }), 1500);
        current.postMessage(mode === 'auto' ? { mode, source, host, rule } : { mode, source, pattern, template, encode });
      } catch (error) { finish({ error: String(error) }); }
    }, 250);
    return () => { counter.current++; clearTimeout(debounce); clearTimeout(timeout); current?.terminate(); };
  }, [open, source, mode, host, pattern, template, encode, rule, character.id]);
  useEffect(() => { setRows(previous => buildPortraitPreview(parsedRef.current, previous, character)); }, [character]);
  useEffect(() => { setRows([]); setSource(''); setGlobalRow('__auto__'); setOpen(false); }, [character.id]);
  useEffect(() => { setRows([]); setSource(''); setOpen(false); }, [epoch]);
  useEffect(() => () => { worker.current?.terminate(); setTimeout(() => portraitPreviewCache.clearUnused(), 0); }, []);
  const changeRow = (id: string, patch: Partial<PortraitPreviewRow>, validate = false) => setRows(previous => previous.map(row => {
    if (row.id !== id) return row;
    const next = { ...row, ...patch };
    if (patch.name !== undefined && !next.manualRow) next.rowId = recommendPortraitRow(next.name, character.portraitRows ?? []);
    if (validate) {
      try {
        if (mode === 'advanced' && /^https?:\/\//i.test(next.input.trim())) {
          const url = normalizePortraitUrl(next.input.trim());
          const name = next.name.trim();
          if (!name) throw new Error('名称不能为空');
          return { ...next, name, manualName: true, manualUrl: true, url: url.href, issue: undefined, selected: true };
        }
        const result = parsePortraitList(next.input.trim(), host), item = result.items[0];
        if (!item || result.items.length !== 1 || result.failed.length) throw new Error(result.failed[0]?.reason ?? '请输入一个有效图片链接或文件码');
        return { ...next, name: next.name.trim() || item.name, manualName: true, manualUrl: true, url: item.url, issue: undefined, selected: true };
      } catch (error) { return { ...next, url: undefined, selected: false, issue: String(error instanceof Error ? error.message : error) }; }
    }
    if (patch.name !== undefined && !patch.name.trim()) return { ...next, issue: '名称不能为空', selected: false };
    if (row.issue === '名称不能为空' && next.name.trim()) return { ...next, issue: undefined };
    return next;
  }));
  const selected = rows.filter(row => row.selected && row.url && !row.issue && row.name.trim());
  const download = () => {
    setError('');
    try {
      for (const row of selected) if (row.rowId && !character.portraitRows?.some(item => item.id === row.rowId)) throw new Error('第 ' + row.line + ' 行目标分行已删除，请重新选择');
      const remembered = { version: 1 as const, mode, host, pattern, template, encode, rule };
      portraitCloudTasks.start({ characterId: character.id, characterName: character.displayMeta?.name || character.name, rowId: null, rowTitle: '逐行保存' },
        selected.map(row => ({ name: row.name, url: row.url!, rowId: row.rowId, rowTitle: character.portraitRows?.find(item => item.id === row.rowId)?.title ?? '未分行', force: row.force })),
        { onFirstSave: () => savePortraitImportPreferences(remembered) });
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  return <>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)}><CloudDownload className="mr-1.5 h-4 w-4" />从图床导入</Button>
    <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) setTimeout(() => portraitPreviewCache.clearUnused(), 0); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>从图床导入立绘</DialogTitle><DialogDescription>粘贴即可自动预览，名称、链接和分行可逐行修改。有效行可先导入；开始后可关闭弹窗，前往其他模块。</DialogDescription></DialogHeader>
        <fieldset disabled={busy} className="space-y-3 min-w-0">
          <label className="block text-sm">名称或世界书片段<Textarea aria-label="名称或世界书片段" value={source} onChange={event => setSource(event.target.value)} rows={5} placeholder={'不开心: 不开心_hv26xb.png\nAndrea_happy_2ctstv.png\nhttps://files.catbox.moe/abcd.png'} /></label>
          <label className="flex gap-2 items-center text-sm">保存到<select aria-label="保存到分行" className="ste-select h-8 min-w-0 text-sm" value={globalRow} onChange={event => {
            const value = event.target.value; setGlobalRow(value);
            const recommended = buildPortraitPreview(parsedRef.current, [], character);
            setRows(previous => previous.map(row => ({ ...row, rowId: value === '__auto__' ? recommended.find(item => item.id === row.id)?.rowId ?? null : value || null, manualRow: value !== '__auto__' })));
          }}>
            <option value="__auto__">按名称推荐，可逐行修改</option><option value="">全部保存到未分行</option>{character.portraitRows?.map(row => <option value={row.id} key={row.id}>{row.title}</option>)}
          </select></label>
          <details open={mode === 'advanced'}><summary className="cursor-pointer text-sm">高级设置</summary><div className="space-y-2 pt-2">
            <label className="flex gap-2 items-center text-sm">解析模式<select aria-label="解析模式" className="ste-select h-8 text-sm" value={mode} onChange={event => setMode(event.target.value as 'auto' | 'advanced')}><option value="auto">自动识别</option><option value="advanced">模板与正则</option></select></label>
            <label className="block text-sm">裸文件码使用的图床<Input aria-label="图床地址" value={host} onChange={event => setHost(event.target.value)} /></label>
            <Button variant="secondary" size="sm" onClick={() => { setMode('advanced'); setPattern(CATBOX_WORLDBOOK_PRESET.pattern); setTemplate(CATBOX_WORLDBOOK_PRESET.template); }}>Catbox 世界书列表</Button>
            {mode === 'advanced' && <><label className="block text-sm">提取正则（空为逐行）<Input aria-label="提取正则" value={pattern} onChange={event => setPattern(event.target.value)} /></label>
              <label className="block text-sm">图片链接模板<Input aria-label="图片链接模板" value={template} onChange={event => setTemplate(event.target.value)} /></label>
              <p className="text-xs text-muted-foreground">{'{name}'} 使用第一个捕获组或整行；支持 $1、$2、$&amp; 和命名捕获。完整 URL 使用 $&amp; 并取消编码。</p>
              <label className="flex gap-2 text-sm"><input type="checkbox" checked={encode} onChange={event => setEncode(event.target.checked)} />对提取的组件进行 URL 编码</label></>}
            {rule && <Button variant="outline" size="sm" onClick={() => setRule(undefined)}>停用示例规则</Button>}
          </div></details>
        </fieldset>
        <p role="status" className="text-sm">{previewing ? '正在解析…' : rows.filter(row => row.url && !row.issue).length + ' 行有效 · ' + rows.filter(row => !!row.issue).length + ' 行待修正 · ' + parsed.skipped.length + ' 行空白/标签/重复已跳过'} · 裸文件默认图床：{host}</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!!rows.length && <><label className="flex gap-2 text-sm"><input type="checkbox" aria-label="全选有效立绘" disabled={busy || previewing}
          checked={rows.filter(row => row.url && !row.issue && (!row.alreadySaved || row.force)).length > 0 && rows.filter(row => row.url && !row.issue && (!row.alreadySaved || row.force)).every(row => row.selected)}
          onChange={event => setRows(previous => previous.map(row => ({ ...row, selected: !!row.url && !row.issue && (!row.alreadySaved || !!row.force) && event.target.checked })))} />全选有效立绘 · 已选 {selected.length}</label>
          <PortraitImportPreview rows={rows} character={character} disabled={busy || previewing} onChange={changeRow} />
          <div className="flex justify-end"><Button onClick={download} disabled={busy || previewing || !selected.length}>导入所选（{selected.length}）</Button></div></>}
        {parsed.failed[0] && !busy && <PortraitExampleRuleEditor key={parsed.failed[0].text} sample={parsed.failed[0].text} source={source} host={host} onUse={rule => { setRule(rule); setMode('auto'); }} />}
        {busy && !currentTask && <p role="status" className="text-sm text-muted-foreground">其他角色的立绘正在导入，请完成或停止当前任务后再开始。</p>}
        {currentTask && <div className="rounded border p-3"><PortraitCloudTaskProgress task={currentTask} /></div>}
        <p className="text-xs text-muted-foreground">后台最多同时导入 4 张，每张上限 20 MB；预览按可见区域加载。已保存来源默认跳过，可明确重新导入。切换资料库会停止后续任务。</p>
      </DialogContent>
    </Dialog>
  </>;
}
