import { useState, useSyncExternalStore } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import type { TavernHost } from '@/lib/roleplay/frame';
import type { ChatProcess } from '@/lib/roleplay/process-log';
import { RequestComparison } from './RequestComparison';
import { VariableInspector } from '@/components/VariableInspector';

const empty: ChatProcess[] = [];
const emptySnapshot = () => empty;
const noSubscribe = () => () => {};
const statusText = { pending: '进行中', succeeded: '模型回复完成', failed: '生成未完成', cancelled: '已停止' };
const elapsed = (ms: number) => ms < 1000 ? `${Math.max(0, ms)} 毫秒` : `${(ms / 1000).toFixed(2)} 秒`;

export function ChatProcessPanel({ host, storyId, branchId, open, onOpenChange, portalContainer }: {
  host?: TavernHost; storyId: string; branchId?: string | null; open: boolean; onOpenChange: (open: boolean) => void; portalContainer?: HTMLElement | null;
}) {
  const records = useSyncExternalStore(open && host ? host.processLog.subscribe : noSubscribe,
    host ? host.processLog.snapshot : emptySnapshot);
  const turns = records.filter(record => record.storyId === storyId && record.branchId === (branchId ?? null)).slice().reverse();
  const [view, setView] = useState<'timeline' | 'compare'>('timeline');
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent container={portalContainer} className="flex w-full flex-col sm:max-w-2xl" aria-label="聊天过程">
      <SheetHeader className="shrink-0 pr-8">
        <SheetTitle>聊天过程</SheetTitle>
        <SheetDescription>查看当前故事与分支中，每轮实际发生的请求、回复处理和保存。保留本次打开聊天期间最近 20 轮，详情过长会截断。</SheetDescription>
      </SheetHeader>
      <div className="flex gap-2 pt-3"><Button size="sm" variant={view === 'timeline' ? 'secondary' : 'ghost'} onClick={() => setView('timeline')}>本轮过程</Button><Button size="sm" variant={view === 'compare' ? 'secondary' : 'ghost'} onClick={() => setView('compare')}>请求对照</Button></div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-3">
        {view === 'compare' ? <RequestComparison turns={turns} /> : <>
        {!turns.length && <p className="text-sm text-muted-foreground">还没有过程记录，发送消息后会在这里显示。</p>}
        {turns.map((turn, index) => <details key={turn.id} open={index === 0} className="rounded-lg border p-3" data-process-turn={turn.id}>
          <summary className="cursor-pointer text-sm font-medium">
            {new Date(turn.startedAt).toLocaleTimeString()} · {turn.type === 'quiet' ? '辅助请求' : turn.type === 'swipe' ? '新候选' : turn.type === 'continue' ? '续写' : '生成'}
            {turn.floor !== undefined && ` · 第 ${turn.floor} 楼`} · {statusText[turn.status]}
          </summary>
          {turn.candidateId && <p className="mt-2 truncate text-xs text-muted-foreground" title={turn.candidateId}>候选 · {turn.candidateId}</p>}
          <ol className="mt-3 space-y-3 border-l pl-3">
            {turn.events.map((event, i) => <li key={i} className="text-sm" data-process-stage={event.stage}>
              <div className="flex items-start justify-between gap-2">
                <span className={event.stage === 'error' ? 'text-destructive' : undefined}>{event.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">+{elapsed(event.at - turn.startedAt)}</span>
              </div>
              {event.detail && <details className="mt-1"><summary className="cursor-pointer text-xs text-muted-foreground">查看详情</summary>
                {event.stage === 'variables' && <ProcessVariables detail={event.detail} />}
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">{event.detail}</pre>
              </details>}
            </li>)}
          </ol>
        </details>)}
        </>}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t pt-3">
        <p className="text-xs text-muted-foreground">插件内部未提供的处理步骤不会出现在记录中。变量变化以观察到的保存内容为准。</p>
        <Button variant="outline" size="sm" disabled={!records.length || host?.isRequestActive() || host?.isGenerating()} onClick={() => host?.processLog.clear()}>清空记录</Button>
      </div>
    </SheetContent>
  </Sheet>;
}

function ProcessVariables({ detail }: { detail: string }) {
  try { const data = JSON.parse(detail); return Object.hasOwn(data, 'before') && Object.hasOwn(data, 'after')
    ? <VariableInspector value={data.after} before={data.before} label="保存后" beforeLabel="保存前（日志快照）" /> : null;
  } catch { return <p className="text-xs text-muted-foreground">本条变量详情已截断，请在成品工作台读取完整楼层快照。</p>; }
}
