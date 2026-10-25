import { useEffect, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useBuiltinPrompt } from '@/hooks/use-builtin-prompt';
import { BUILTIN_PROMPTS, getBuiltinPrompt, resetBuiltinPrompt, saveBuiltinPrompt, validateBuiltinPrompt } from '@/lib/builtin-prompts';
import type { BuiltinPromptDefinition } from '@/lib/builtin-prompt-defaults';
import { cn } from '@/lib/utils';

const GROUPS = [...new Set(BUILTIN_PROMPTS.map(prompt => prompt.group))];
const draftKey = (id: string) => `ste-builtin-prompt-draft:${id}`;
interface Draft { value: string; base: string }
// Also retain drafts across route changes if the browser cannot write sessionStorage.
const sessionDrafts = new Map<string, Draft>();

function readDraft(id: string): Draft {
  const saved = getBuiltinPrompt(id);
  const cached = sessionDrafts.get(id);
  if (cached) return cached.value === cached.base ? { value: saved, base: saved } : cached;
  try {
    const draft: unknown = JSON.parse(sessionStorage.getItem(draftKey(id)) ?? 'null');
    if (draft && typeof draft === 'object' && 'value' in draft && typeof draft.value === 'string'
      && 'base' in draft && typeof draft.base === 'string') return { value: draft.value, base: draft.base };
  } catch { /* A missing/broken session draft does not affect the saved prompt. */ }
  return { value: saved, base: saved };
}

function PromptEditor({ prompt }: { prompt: BuiltinPromptDefinition }) {
  const { toast } = useToast();
  const saved = useBuiltinPrompt(prompt.id);
  const [draft, setDraft] = useState(() => readDraft(prompt.id));
  const [resetOpen, setResetOpen] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const dirty = draft.value !== saved;
  const conflict = dirty && draft.base !== saved;
  const error = validateBuiltinPrompt(prompt.id, draft.value);

  useEffect(() => {
    setDraft(current => current.value === current.base ? { value: saved, base: saved } : current);
  }, [saved]);

  useEffect(() => {
    if (!storageError || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [storageError, dirty]);

  const updateDraft = (value: string) => {
    const next = { ...draft, value };
    sessionDrafts.set(prompt.id, next);
    try {
      sessionStorage.setItem(draftKey(prompt.id), JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
    setDraft(next);
  };

  const finish = () => {
    const value = getBuiltinPrompt(prompt.id);
    setDraft({ value, base: value });
    sessionDrafts.set(prompt.id, { value, base: value });
    try { sessionStorage.removeItem(draftKey(prompt.id)); } catch { /* Saved setting remains durable. */ }
    setStorageError(false);
  };

  const save = () => {
    try {
      saveBuiltinPrompt(prompt.id, draft.value);
      finish();
      toast({ title: '提示词已保存', description: '后续新生成使用此设置，已有记录和编辑中的模板草稿保留原内容。' });
    } catch (err) {
      toast({ title: '提示词未保存', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };

  return <div className="min-w-0 space-y-3" role="region" aria-label={prompt.title}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold">{prompt.title}</h2>
      <span className="text-xs text-muted-foreground">{dirty ? '有未保存草稿' : saved === prompt.content ? '使用默认' : '已自定义'}</span>
    </div>
    {prompt.description && <p className="text-sm text-muted-foreground">{prompt.description}</p>}
    {!!prompt.required?.length && <p className="break-words text-xs text-muted-foreground">需保留：{prompt.required.join('、')}</p>}
    <Textarea aria-label={`${prompt.title}提示词`} value={draft.value} onChange={event => updateDraft(event.target.value)}
      className="min-h-[45dvh] resize-y font-mono text-sm leading-relaxed" spellCheck={false} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {conflict && <p role="status" className="text-sm text-muted-foreground">已保存版本在另一入口更新。这里保留了你的草稿；保存会以当前草稿替换它。</p>}
    {storageError && <p role="alert" className="text-sm text-destructive">草稿暂存失败，请先保存再切换页面，以免丢失输入。</p>}
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={save} disabled={!dirty || !!error} className="gap-1"><Save className="h-4 w-4" />保存提示词</Button>
      <Button variant="outline" onClick={() => setResetOpen(true)} disabled={!dirty && saved === prompt.content} className="gap-1"><RotateCcw className="h-4 w-4" />恢复默认</Button>
      {dirty && <Button variant="ghost" onClick={finish}>撤销草稿</Button>}
    </div>
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm">查看软件默认内容</summary>
      <pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed">{prompt.content}</pre>
    </details>
    <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>恢复「{prompt.title}」默认提示词？</AlertDialogTitle>
        <AlertDialogDescription>本项自定义内容和未保存草稿将被清除，其他提示词不受影响。</AlertDialogDescription>
      </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel>
        <AlertDialogAction onClick={() => {
          try { resetBuiltinPrompt(prompt.id); finish(); toast({ title: '已恢复默认提示词' }); }
          catch (err) { toast({ title: '恢复失败', description: String(err), variant: 'destructive' }); }
        }}>恢复默认</AlertDialogAction>
      </AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </div>;
}

export function BuiltinPromptsPanel() {
  const [group, setGroup] = useState(GROUPS[0]);
  const [selectedId, setSelectedId] = useState(BUILTIN_PROMPTS[0].id);
  const [query, setQuery] = useState('');
  const choices = BUILTIN_PROMPTS.filter(prompt => prompt.group === group && `${prompt.title} ${prompt.description}`.includes(query.trim()));
  const selected = choices.find(prompt => prompt.id === selectedId) ?? choices[0];
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">统一管理 STE 自带的生成指令与快捷改写要求。设置保存在当前设备，跨资料库使用；导入预设和自建模板请到各自编辑区修改。</p>
    <p className="text-xs text-muted-foreground">草稿在本次窗口中暂存，切换模块或页面可继续编辑；点击保存后才生效。此设置不随资料库备份导出。</p>
    <div className="flex flex-wrap gap-2" aria-label="提示词模块">
      {GROUPS.map(item => <Button key={item} variant={group === item ? 'default' : 'outline'} size="sm" aria-pressed={group === item}
        onClick={() => { setGroup(item); setQuery(''); }}>{item}</Button>)}
    </div>
    <div className="grid items-start gap-4 lg:grid-cols-[12rem_minmax(0,1fr)]">
      <nav className="min-w-0 space-y-2" aria-label={`${group}提示词列表`}>
        <Input aria-label="筛选当前模块提示词" placeholder="筛选提示词…" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="max-h-48 space-y-1 overflow-y-auto lg:max-h-[65dvh]">
          {choices.map(prompt => <button key={prompt.id} type="button" title={prompt.title} aria-current={selected?.id === prompt.id ? 'page' : undefined}
            onClick={() => setSelectedId(prompt.id)} className={cn('tap-target block min-h-9 w-full rounded-md px-3 py-2 text-left text-sm',
              selected?.id === prompt.id ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-accent')}>
            {prompt.title}
          </button>)}
        </div>
      </nav>
      {selected ? <PromptEditor key={selected.id} prompt={selected} /> : <p className="py-8 text-sm text-muted-foreground">没有匹配的提示词。</p>}
    </div>
  </div>;
}
