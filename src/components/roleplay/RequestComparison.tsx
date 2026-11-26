import { getLocale } from '@/lib/i18n';
import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useMemo, useState  } from 'react';
import { diffChars } from 'diff';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { compareRequests, importRequest, type RequestSnapshot } from '@/lib/roleplay/request-diagnostics';
import type { ChatProcess } from '@/lib/roleplay/process-log';
import { variableText } from '@/lib/variable-inspector';
import { loadApiProfiles } from '@/components/ai-tools/api-profiles';
import { saveTextFile } from '@/lib/roleplay/export-package-file';

const selectClass = 'ste-select h-9 w-full min-w-0 text-xs';
const pretty = (value: unknown) => value === undefined ? tr("（不存在）") : JSON.stringify(value, null, 2);
function MessageDifference({ before, after }: { before: unknown; after: unknown }) {
  useI18n();
  const a = pretty(before), b = pretty(after);
  const parts = useMemo(() => a.length + b.length <= 30000 ? diffChars(a, b, { timeout: 40 }) : undefined, [a, b]);
  return <div>
    {parts ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">{parts.map((p, i) => p.added ? <ins key={i} className="bg-primary/20 no-underline">{p.value}</ins> : p.removed ? <del key={i} className="bg-destructive/20">{p.value}</del> : <span key={i}>{p.value}</span>)}</pre>
      : <div className="grid gap-2"><p className="text-xs text-muted-foreground">{tr("内容较长，分别显示完整已捕获片段。")}</p><pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words bg-muted p-2 text-xs">{tr("左：")}{a}</pre><pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words bg-muted p-2 text-xs">{tr("右：")}{b}</pre></div>}
  </div>;
}
function MessageRow({ message }: { message: ReturnType<typeof compareRequests>['messages'][number] }) {
  useI18n();
  const [open, setOpen] = useState(false);
  return <details className="rounded border p-2" onToggle={e => setOpen(e.currentTarget.open)}><summary className="cursor-pointer text-xs">{tr("消息 ")}{message.index + 1} · {String((message.before as { role?: string })?.role ?? tr("无"))} → {String((message.after as { role?: string })?.role ?? tr("无"))} · {message.changed ? tr("不同") : tr("一致")}</summary>{open && <div className="mt-2"><MessageDifference before={message.before} after={message.after} /></div>}</details>;
}
export function RequestComparison({ turns }: { turns: ChatProcess[] }) {
  useI18n();
  const [leftId, setLeftId] = useState('previous'), [rightId, setRightId] = useState('latest');
  const [imported, setImported] = useState<RequestSnapshot>(), [paste, setPaste] = useState(''), [error, setError] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(true), [counting, setCounting] = useState(false);
  const [counts, setCounts] = useState<{ left: RequestSnapshot; right: RequestSnapshot; values: Record<string, unknown>[] }>();
  const available = turns.filter(turn => turn.finalRequest);
  const rightTurn = rightId === 'latest' ? available[0] : available.find(turn => turn.id === rightId);
  const right = rightTurn?.finalRequest;
  const leftTurn = leftId === 'previous' ? available.find(turn => turn.id !== rightTurn?.id) : available.find(turn => turn.id === leftId);
  const left = leftId === 'import' ? imported : leftId === 'incoming' ? rightTurn?.incomingRequest : leftTurn?.finalRequest;
  const comparison = useMemo(() => left && right ? compareRequests(left, right) : undefined, [left, right]);
  function read(text: string) {
    try { setImported(importRequest(text, loadApiProfiles().profiles.map(p => p.apiKey))); setLeftId('import'); setPaste(''); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function download() {
    if (!right) return;
    try { await saveTextFile({ fileName: tr("STE-最终请求快照.json"), text: JSON.stringify(right, null, 2), label: tr("最终请求快照"), extension: 'json' }); setError(''); }
    catch (reason) { setError(tr("导出失败：") + (reason instanceof Error ? reason.message : String(reason))); }
  }
  async function count() {
    if (!left || !right || counting) return;
    setCounting(true);
    try { const { tokenizeTavern } = await import('@/lib/roleplay/tokenizer');
      const values = [left, right].map(snapshot => tokenizeTavern('/api/tokenizers/openai/count?model=' + encodeURIComponent(String(snapshot.body.model ?? '')), snapshot.body.messages));
      setCounts({ left, right, values });
    } catch { setError(tr("当前快照无法估算 token")); } finally { setCounting(false); }
  }
  const turnLabel = (turn: ChatProcess) => `${new Date(turn.startedAt).toLocaleTimeString(getLocale())} · ${turn.floor === undefined ? turn.type : tr("第 {{v0}} 楼", { v0: turn.floor })} · ${turn.id.slice(0, 6)}`;
  return <section className="space-y-3 rounded-lg border p-3" aria-label={tr("最终请求对照")}>
    <h3 className="text-sm font-medium">{tr("最终请求对照")}</h3>
    <div className="grid grid-cols-2 gap-2"><label className="text-xs">{tr("左侧")}<select aria-label={tr("左侧请求")} className={selectClass} value={leftId} onChange={e => setLeftId(e.target.value)}><option value="previous">{tr("上一轮最终请求")}</option><option value="incoming">{tr("右侧本轮 · 主机接收消息")}</option><option value="import">{tr("导入的 ST 请求")}</option>{available.map(turn => <option key={turn.id} value={turn.id}>{turnLabel(turn)}</option>)}</select></label><label className="text-xs">{tr("右侧")}<select aria-label={tr("右侧请求")} className={selectClass} value={rightId} onChange={e => setRightId(e.target.value)}><option value="latest">{tr("最近一轮最终请求")}</option>{available.map(turn => <option key={turn.id} value={turn.id}>{turnLabel(turn)}</option>)}</select></label></div>
    <details><summary className="cursor-pointer text-xs">{tr("导入 SillyTavern 实际请求")}</summary><p className="my-2 text-xs text-muted-foreground">{tr("复制浏览器网络面板里实际发出的请求 JSON，或选择只含一个聊天请求的 HAR。也可导入 STE 导出的请求记录。")}</p><input aria-label={tr("导入请求 JSON 或 HAR")} type="file" accept=".json,.har" className="max-w-full text-xs" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; if (file.size > 4 * 1024 * 1024) { setError(tr("导入文件不能超过 4 MiB")); return; } try { read(await file.text()); } catch { setError(tr("无法读取请求文件")); } }} /><Textarea aria-label={tr("粘贴 ST 请求 JSON")} className="mt-2 font-mono text-xs" rows={4} value={paste} onChange={e => setPaste(e.target.value)} /><Button size="sm" className="mt-2" disabled={!paste.trim()} onClick={() => read(paste)}>{tr("读取粘贴请求")}</Button></details>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!right} onClick={download}>{tr("导出右侧快照")}</Button><Button size="sm" variant="outline" disabled={!left || !right || counting} onClick={() => void count()}>{counting ? tr("正在估算…") : tr("估算消息 token")}</Button><label className="flex gap-1 items-center text-xs"><input type="checkbox" checked={onlyChanged} onChange={e => setOnlyChanged(e.target.checked)} />{tr("仅显示不同消息")}</label></div>
    {counts?.left === left && counts?.right === right && counts && <p className="text-xs">{tr("消息 token 估算：左 {{v0}} → 右 {{v1}}（{{v2}} / {{v3}}）。不含工具定义或图片等多模态计费，实际消耗以接口返回为准。", { v0: String(counts.values[0].token_count), v1: String(counts.values[1].token_count), v2: String(counts.values[0].encoding), v3: String(counts.values[1].encoding) })}</p>}
    {leftId === 'incoming' && <p className="text-xs text-muted-foreground">{tr("左侧是酒馆发送给主机的消息与后处理选项；右侧经过 STE 的后处理、自定义参数及 Agent 资料补充后发出。左侧未捕获其他参数；更早的插件内部步骤不可见。")}</p>}
    {[[tr("左"), left], [tr("右"), right]].map(([name, raw]) => { const snapshot = raw as RequestSnapshot | undefined; return snapshot && <p key={String(name)} className="text-xs text-muted-foreground">{String(name)}: {snapshot.complete ? tr("完整捕获") : tr("不完整")}{tr(" · 原始 ")}{snapshot.originalMessages}{tr(" 条消息")}{snapshot.notes.length ? ' · ' + snapshot.notes.join('; ') : ''}</p>; })}
    {comparison ? <>
      <p className="text-sm font-medium">{comparison.equal ? tr("已捕获请求一致") : comparison.comparable ? tr("存在请求差异") : tr("仅比较已捕获部分，无法判断完整请求一致")} · {comparison.messages.filter(m => m.changed).length}{tr(" 条消息不同")}</p>
      <details open={comparison.parameters.changes.length > 0}><summary className="cursor-pointer text-xs">{tr("参数差异（{{v0}}{{v1}}）", { v0: comparison.parameters.changes.length, v1: comparison.parameters.truncated ? '+' : '' })}</summary><div className="mt-2 max-h-60 overflow-auto space-y-2">{comparison.parameters.changes.map(change => <div key={change.path} className="break-all text-xs"><p className="font-medium">{change.path}</p><p className="text-muted-foreground">{tr("左：")}{variableText(change.before, 1200)}</p><p>{tr("右：")}{variableText(change.after, 1200)}</p></div>)}{!comparison.parameters.changes.length && <p className="text-xs text-muted-foreground">{tr("未发现参数差异")}</p>}</div></details>
      <div className="space-y-2">{comparison.messages.filter(m => !onlyChanged || m.changed).map(message => <MessageRow key={message.index} message={message} />)}</div>
    </> : <p className="text-xs text-muted-foreground">{!right ? tr("发送消息后可查看实际最终请求。") : tr("请选择另一轮请求，或导入 ST 请求开始比较。")}</p>}
    {rightTurn?.response && <div className="rounded bg-muted p-2 text-xs space-y-1"><p>{tr("模型原始返回：")}{rightTurn.response.contentChars}{tr(" 字符 · ")}{rightTurn.response.toolCalls}{tr(" 个工具调用 · 结束原因 ")}{rightTurn.response.finishReason ?? tr("未提供")}</p>
      {!!rightTurn.response.usage && <pre className="whitespace-pre-wrap break-words">{tr("实际用量：")}{pretty(rightTurn.response.usage)}</pre>}
      {!rightTurn.response.contentChars && rightTurn.response.toolCalls > 0 && <p>{tr("模型返回了工具调用。正文提取与变量处理是否完成，继续查看本轮的「处理」「变量」「保存」事件。")}</p>}
      {!rightTurn.response.contentChars && !rightTurn.response.toolCalls && <p>{tr("未观察到正文或工具调用，检查响应错误和结束原因。")}</p>}
    </div>}
  </section>;
}
