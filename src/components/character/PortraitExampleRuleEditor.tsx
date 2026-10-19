import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { buildPortraitExampleRule, type PortraitExampleSpan, type PortraitExampleRule } from '@/lib/portrait-example-rule';
import { processPortraitImport } from '@/lib/portrait-import-parser';
import type { PortraitParseResult } from '@/lib/portrait-list-parser';

export function PortraitExampleRuleEditor({ sample, host, source, onUse }: { sample: string; source: string; host: string; onUse: (rule: PortraitExampleRule) => void }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [name, setName] = useState<PortraitExampleSpan | null>(null), [file, setFile] = useState<PortraitExampleSpan | null>(null);
  const [error, setError] = useState(''), [candidate, setCandidate] = useState<PortraitExampleRule | null>(null), [result, setResult] = useState<PortraitParseResult | null>(null);
  const select = () => ({ start: input.current?.selectionStart ?? 0, end: input.current?.selectionEnd ?? 0 });
  useEffect(() => {
    if (!candidate) return; let active = true; setResult(null);
    const worker = new Worker(new URL('../../lib/portrait-cloud.worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => { worker.terminate(); if (active) setError('候选规则检查超时，请缩小文本范围'); }, 1500);
    worker.onmessage = ({ data }) => { worker.terminate(); clearTimeout(timer); if (active) { setResult(data.result ?? null); setError(data.error ?? ''); } };
    worker.onerror = () => { worker.terminate(); clearTimeout(timer); if (active) setError('候选规则无法解析'); };
    worker.postMessage({ mode: 'auto', source, host, rule: candidate });
    return () => { active = false; clearTimeout(timer); worker.terminate(); };
  }, [candidate, source, host]);
  const preview = () => {
    try {
      if (!file) throw new Error('请先选中文件码或完整 URL 片段');
      const rule = buildPortraitExampleRule(sample, name, file);
      if (!processPortraitImport({ mode: 'auto', source: sample, host, rule }).items.length) throw new Error('所选文件片段不是有效图片码或 URL');
      setCandidate(rule); setError('');
    } catch (error) { setCandidate(null); setError(error instanceof Error ? error.message : String(error)); }
  };
  return <details className="rounded border border-border p-3 space-y-2"><summary className="cursor-pointer text-sm">用一行示例帮助识别</summary>
    <p className="text-xs text-muted-foreground">选中名称（可不选）和文件码/完整链接，再检查候选结果。规则只在本机使用。</p>
    <Textarea ref={input} aria-label="示例原行" readOnly value={sample} rows={3} />
    <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => { setName(select()); setCandidate(null); }}>将选区设为名称</Button>
      <Button variant="outline" size="sm" onClick={() => { setFile(select()); setCandidate(null); }}>将选区设为文件或链接</Button>
      <Button variant="outline" size="sm" onClick={() => { setName(null); setCandidate(null); }}>不提取名称</Button></div>
    <p className="text-xs">名称：{name ? sample.slice(name.start, name.end) : '从文件名推定'}；文件：{file ? sample.slice(file.start, file.end) : '未选'}</p>
    <Button variant="secondary" size="sm" onClick={preview}>检查候选规则</Button>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {result && candidate && <div className="space-y-2 text-xs"><p>候选结果：{result.items.length} 行成功，{result.failed.length} 行需修正</p>
      <ul className="max-h-32 overflow-auto">{result.items.map(item => <li key={item.line} className="break-all">第 {item.line} 行 · {item.name} · {item.url}</li>)}{result.failed.map(issue => <li key={issue.line}>第 {issue.line} 行：{issue.reason}</li>)}</ul>
      <Button size="sm" onClick={() => onUse(candidate)}>使用此规则</Button></div>}
  </details>;
}
