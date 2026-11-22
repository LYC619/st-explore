import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Send, Square, Trash2, RotateCcw, MessageSquare, ChevronDown } from 'lucide-react';
import { QuickModelSwitcher } from '@/components/ai-tools/QuickModelSwitcher';
import { getActiveModelSelection, getAPIConfigForSelection, type ApiModelSelection } from '@/components/ai-tools/api-profiles';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { listCharacterIndex } from '@/lib/archive-index';
import { listAssetIndex } from '@/lib/asset-index';
import { getCharacter, getRoleplayPreferences } from '@/lib/archive-db';
import { getPreset } from '@/lib/preset-db';
import { getWorldBook } from '@/lib/worldbook-db';
import { subscribeRecordChanges } from '@/lib/repo/changes';
import { buildPresetPlaygroundRequest, type PlaygroundWorldMode } from '@/lib/preset-playground';
import { streamPresetPlayground } from '@/lib/preset-playground-stream';
import { normalizeCharacterCard } from '@/lib/png-parser';
import { substituteVars } from '@/lib/preset-parser';
import { parseWorldBook, type WorldBook, type WorldBookEntry } from '@/types/worldbook';
import type { NormalizedPreset } from '@/types/preset';
import type { ArchiveCharacter } from '@/types/archive';
import type { ChatCompletionMessage } from '@/lib/llm';

interface TrialMessage extends ChatCompletionMessage { id: string; model?: string; state?: 'pending' | 'done' | 'stopped' | 'error' }
interface Choice { id: string; title: string }
const selectClass = 'ste-select h-9 w-full min-w-0 text-sm';

async function resolveTrialWorldBook(
  character: ArchiveCharacter | undefined,
  worldbookId: string,
): Promise<WorldBook | undefined> {
  if (worldbookId === '__none__') return undefined;
  const books: WorldBook[] = [];
  if (worldbookId) {
    const explicit = await getWorldBook(worldbookId);
    if (!explicit) throw new Error('所选世界书已不存在，请重新选择。');
    books.push(explicit.worldbook);
  } else if (character) {
    const linkedRefs = (character.assets ?? []).filter(ref => ref.kind === 'worldbook');
    const activeRefs = character.roleplayWorldbookDisabled
      ? linkedRefs.filter(ref => ref.relations?.includes('extra'))
      : linkedRefs;
    const hasExtractedEmbedded = linkedRefs.some(ref => ref.relations?.includes('embedded'));
    for (const ref of activeRefs) {
      const wb = await getWorldBook(ref.assetId);
      if (wb) books.push(wb.worldbook);
    }
    if (!hasExtractedEmbedded && !character.roleplayWorldbookDisabled) {
      const norm = normalizeCharacterCard(character.card);
      if (norm.characterBook && typeof norm.characterBook === 'object' && 'entries' in norm.characterBook) {
        try {
          books.push(parseWorldBook(norm.characterBook));
        } catch {
          // Ignore malformed embedded character_book during temporary trial
        }
      }
    }
  }
  if (!books.length) return undefined;
  if (books.length === 1) return books[0];
  const merged: Record<string, WorldBookEntry> = {};
  let nextUid = 1;
  for (const book of books) {
    for (const entry of Object.values(book.entries)) {
      const uid = nextUid++;
      merged[String(uid)] = { ...entry, uid };
    }
  }
  return { entries: merged };
}

/** Local to this mounted version and vault: there is no role/story creation or persistence path. */
export function PresetPlayground({
  presetId,
  presetOverride,
}: {
  presetId: string;
  presetOverride?: { title: string; preset: NormalizedPreset };
}) {
  const epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch, getVaultEpoch);
  return <PlaygroundSession key={`${epoch}:${presetId}`} presetId={presetId} presetOverride={presetOverride} epoch={epoch} />;
}

function PlaygroundSession({
  presetId,
  presetOverride,
  epoch,
}: {
  presetId: string;
  presetOverride?: { title: string; preset: NormalizedPreset };
  epoch: number;
}) {
  const [selection, setSelection] = useState<ApiModelSelection>(getActiveModelSelection);
  const [characters, setCharacters] = useState<Choice[]>([]), [worldbooks, setWorldbooks] = useState<Choice[]>([]);
  const [characterId, setCharacterId] = useState(''), [worldbookId, setWorldbookId] = useState('');
  const [worldMode, setWorldMode] = useState<PlaygroundWorldMode>('keywords');
  const [userName, setUserName] = useState('你'), [persona, setPersona] = useState('');
  const [greetingOptions, setGreetingOptions] = useState<string[]>([]), [greetingIdx, setGreetingIdx] = useState(0);
  const [messages, setMessages] = useState<TrialMessage[]>([]), [input, setInput] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [error, setError] = useState(''), [warnings, setWarnings] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0), [phase, setPhase] = useState('等待模型响应');
  const latestOverrideRef = useRef(presetOverride);
  latestOverrideRef.current = presetOverride;

  useEffect(() => {
    if (!busy) return;
    const start = Date.now(); setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const [preview, setPreview] = useState<{ messages: ChatCompletionMessage[]; tokens: number; worldCount: number } | null>(null);
  const [retryMessages, setRetryMessages] = useState<TrialMessage[] | null>(null), [loadVersion, setLoadVersion] = useState(0);
  const live = useRef(true), ticket = useRef(0), active = useRef<AbortController | null>(null);
  const history = useRef<HTMLDivElement>(null), follow = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; active.current?.abort(); };
  }, []);
  useEffect(() => {
    let valid = true, sequence = 0;
    void getRoleplayPreferences().then(prefs => {
      if (!valid) return;
      const savedName = typeof prefs.tavern?.username === 'string' ? prefs.tavern.username.trim() : '';
      if (savedName) setUserName(prev => (prev === '你' ? savedName : prev));
    }).catch(() => {});
    const load = async () => {
      const current = ++sequence;
      try {
        const [chars, books] = await Promise.all([listCharacterIndex(), listAssetIndex('worldbooks')]);
        if (valid && current === sequence && epoch === getVaultEpoch()) {
          setCharacters(chars.map(item => ({ id: item.id, title: item.displayMeta?.name || item.name })));
          setWorldbooks(books.map(item => ({ id: item.id, title: item.title }))); setLoadError('');
        }
      } catch (e) { if (valid && current === sequence) setLoadError(e instanceof Error ? e.message : String(e)); }
      finally { if (valid && current === sequence) setLoading(false); }
    };
    void load();
    const off = subscribeRecordChanges(change => { if (change.store === 'characters' || change.store === 'worldbooks') void load(); });
    return () => { valid = false; off(); };
  }, [epoch, loadVersion]);
  useEffect(() => { if (follow.current && history.current) history.current.scrollTop = history.current.scrollHeight; }, [messages]);
  const cancel = () => { ++ticket.current; active.current?.abort(); active.current = null; setBusy(false); };
  const clear = () => { cancel(); setMessages([]); setRetryMessages(null); setError(''); setWarnings([]); setPreview(null); };
  const changeAttachment = (change: () => void) => { clear(); change(); };
  const generate = async (turn: TrialMessage[]) => {
    if (active.current) return;
    const controller = new AbortController(), current = ++ticket.current;
    active.current = controller; setBusy(true); setError(''); setWarnings([]); setRetryMessages(turn); follow.current = true;
    setPhase('等待模型响应');
    const answerId = crypto.randomUUID();
    setMessages([...turn, { id: answerId, role: 'assistant', content: '', state: 'pending', model: selection.model }]);
    const owns = () => live.current && current === ticket.current && epoch === getVaultEpoch() && !controller.signal.aborted;
    try {
      const config = getAPIConfigForSelection(selection);
      if (!config) throw new Error('所选模型配置已不存在，请重新选择连接。');
      const override = latestOverrideRef.current;
      const [presetRecord, character] = await Promise.all([
        override ? Promise.resolve(undefined) : getPreset(presetId),
        characterId ? getCharacter(characterId) : undefined,
      ]);
      if (!owns()) return;
      const activePreset = override?.preset ?? presetRecord?.preset;
      if (!activePreset) throw new Error('当前预设已不存在，请重新打开版本。');
      if (characterId && !character) throw new Error('所选角色已不存在，请重新选择。');
      const resolvedWorldbook = await resolveTrialWorldBook(character, worldbookId);
      if (!owns()) return;
      const built = buildPresetPlaygroundRequest({
        preset: activePreset,
        character: character?.card,
        worldbook: resolvedWorldbook,
        worldMode,
        userName,
        persona,
        messages: turn.map(({ role, content }) => ({ role, content })),
      });
      setWarnings(built.warnings); setPreview({ messages: built.messages, tokens: built.tokenEstimate, worldCount: built.worldEntryCount });
      const content = await streamPresetPlayground(config, built.request, controller.signal, text => {
        if (owns()) { setPhase('正在接收回复'); setMessages(rows => rows.map(row => row.id === answerId ? { ...row, content: text } : row)); }
      }, { onReasoning: () => { if (owns()) setPhase('模型正在思考'); } });
      if (owns()) { setMessages(rows => rows.map(row => row.id === answerId ? { ...row, content, state: 'done' } : row)); setRetryMessages(null); }
    } catch (e) {
      if (!live.current || current !== ticket.current || epoch !== getVaultEpoch()) return;
      const stopped = controller.signal.aborted;
      setMessages(rows => rows.map(row => row.id === answerId ? { ...row, state: stopped ? 'stopped' : 'error' } : row));
      if (!stopped) setError(e instanceof Error ? e.message : String(e));
    } finally { if (live.current && current === ticket.current) { active.current = null; setBusy(false); } }
  };
  const send = () => {
    if (!input.trim() || busy) return;
    const turn: TrialMessage[] = [...messages.filter(message => message.role === 'user' || message.state === 'done'), { id: crypto.randomUUID(), role: 'user', content: input.trim() }];
    setInput(''); void generate(turn);
  };
  const stop = () => {
    cancel();
    setMessages(rows => rows.map(row => row.state === 'pending' ? { ...row, state: 'stopped' } : row));
  };
  useEffect(() => {
    let alive = true;
    setGreetingOptions([]);
    setGreetingIdx(0);
    if (!characterId) return;
    void getCharacter(characterId).then(char => {
      if (!alive || !char) return;
      const card = normalizeCharacterCard(char.card);
      const list = [card.firstMessage, ...card.alternateGreetings].map(g => g.trim()).filter(Boolean);
      setGreetingOptions(list);
    }).catch(() => {});
    return () => { alive = false; };
  }, [characterId]);

  const greeting = async (idx = greetingIdx) => {
    const current = ++ticket.current;
    try {
      const character = await getCharacter(characterId);
      if (!live.current || current !== ticket.current || epoch !== getVaultEpoch()) return;
      if (!character) throw new Error('角色已不存在。');
      const card = normalizeCharacterCard(character.card);
      const greetings = [card.firstMessage, ...card.alternateGreetings].map(g => g.trim()).filter(Boolean);
      if (!greetings.length) throw new Error('这张角色卡没有开场白。');
      const chosen = greetings[Math.min(Math.max(0, idx), greetings.length - 1)] ?? greetings[0];
      setMessages([{ id: crypto.randomUUID(), role: 'assistant', state: 'done', content: substituteVars(chosen, card.name, userName) }]); setError('');
    } catch (e) { if (live.current && current === ticket.current) setError(e instanceof Error ? e.message : String(e)); }
  };
  const hasUserMessages = messages.some(m => m.role === 'user');
  const hasWorldScope = Boolean((characterId && worldbookId !== '__none__') || (worldbookId && worldbookId !== '__none__'));
  return <section className="flex flex-col gap-4 min-w-0" aria-label="预设试用" data-preset-playground={presetId}>
    <div className="flex flex-wrap gap-3 items-center"><div className="min-w-0 flex-1"><h2 className="font-medium flex items-center gap-2"><MessageSquare className="w-4 h-4" />{presetOverride ? '边改边试（实时读取当前编辑草稿）' : '试用当前版本'}</h2><p className="text-xs text-muted-foreground mt-1">临时对话，不写入角色聊天记录；修改你的名字或设定不会清空当前测试对话。</p></div><Button type="button" variant="ghost" size="sm" disabled={!messages.length && !busy} onClick={clear}><Trash2 className="w-3.5 h-3.5 mr-1" />清空</Button></div>
    <QuickModelSwitcher value={selection} onChange={setSelection} disabled={busy} busy={busy} />
    <details className="min-w-0 rounded-lg border border-[color:var(--border-subtle)] p-3"><summary className="cursor-pointer text-sm flex items-center gap-2 min-w-0"><ChevronDown className="w-3.5 h-3.5 shrink-0" /><span className="shrink-0">挂载角色与世界书</span><span className="text-xs text-muted-foreground min-w-0 truncate">{[characters.find(item => item.id === characterId)?.title, worldbookId === '__none__' ? '禁用世界书' : worldbooks.find(item => item.id === worldbookId)?.title || (characterId ? '跟随角色世界书' : '')].filter(Boolean).join(' · ') || '可选'}</span></summary>
      <fieldset disabled={busy || loading} className="grid gap-3 mt-3 sm:grid-cols-2 min-w-0">
        <label className="text-xs space-y-1 min-w-0"><span>角色卡</span><select aria-label="试用角色卡" className={selectClass} value={characterId} onChange={e => changeAttachment(() => { const next = e.target.value; setCharacterId(next); if (!next && worldbookId === '__none__') setWorldbookId(''); })}><option value="">不挂载角色</option>{characters.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label className="text-xs space-y-1 min-w-0"><span>世界书</span><select aria-label="试用世界书" className={selectClass} value={worldbookId} onChange={e => changeAttachment(() => setWorldbookId(e.target.value))}><option value="">{characterId ? '自动跟随角色自带/关联世界书' : '不挂载世界书'}</option>{characterId && <option value="__none__">不挂载任何世界书</option>}{worldbooks.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        {hasWorldScope && <label className="text-xs space-y-1 min-w-0"><span>世界书启用方式</span><select aria-label="试用世界书启用方式" className={selectClass} value={worldMode} onChange={e => setWorldMode(e.target.value as PlaygroundWorldMode)}><option value="keywords">常驻与关键词命中</option><option value="constant">仅常驻</option><option value="all">全部启用条目</option></select></label>}
        <label className="text-xs space-y-1 min-w-0"><span>你的名字</span><Input aria-label="试用用户名" value={userName} onChange={e => setUserName(e.target.value)} /></label>
        <label className="text-xs space-y-1 min-w-0 sm:col-span-2"><span>你的角色设定（可选）</span><Textarea aria-label="试用用户设定" rows={2} value={persona} onChange={e => setPersona(e.target.value)} /></label>
        {characterId && (
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            {greetingOptions.length > 1 && (
              <select
                aria-label="选择开场白"
                className="ste-select h-8 text-xs"
                value={String(greetingIdx)}
                disabled={hasUserMessages}
                onChange={e => {
                  const nextIdx = Number(e.target.value) || 0;
                  setGreetingIdx(nextIdx);
                  if (messages.length === 1 && !hasUserMessages) void greeting(nextIdx);
                }}
              >
                {greetingOptions.map((_, idx) => (
                  <option key={idx} value={String(idx)}>{idx === 0 ? '默认开场白' : `备选开场白 ${idx}`}</option>
                ))}
              </select>
            )}
            <Button type="button" variant="outline" size="sm" disabled={hasUserMessages} onClick={() => void greeting(greetingIdx)}>
              {messages.length && !hasUserMessages ? '重载开场白' : '插入角色开场白'}
            </Button>
          </div>
        )}
      </fieldset><p className="text-xs text-muted-foreground mt-3">切换角色或世界书会重置临时对话；修改用户名或玩家设定会在下一句即时生效。</p>
    </details>
    {loadError && <p role="alert" className="text-xs text-destructive">{loadError}<Button type="button" variant="ghost" size="sm" onClick={() => setLoadVersion(value => value + 1)}>重读挂载列表</Button></p>}
    <div ref={history} className="min-h-40 max-h-[52dvh] overflow-y-auto space-y-3 rounded-lg border border-[color:var(--border-subtle)] p-3" role="log" aria-label="试用消息历史" onScroll={e => { const el = e.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}>
      {!messages.length && <p className="py-8 text-sm text-center text-muted-foreground">选好模型，发一句话试试预设文风；也可挂载角色卡与世界书。</p>}
      {messages.map(message => <article key={message.id} className={`rounded-lg p-3 ${message.role === 'user' ? 'bg-[var(--brand-active-bg)] ml-5' : 'bg-[var(--hover-overlay)] mr-5'}`}><div className="text-xs text-muted-foreground mb-1">{message.role === 'user' ? userName || '你' : message.model || '角色开场白'}{message.state === 'pending' ? ' · 生成中' : message.state === 'stopped' ? ' · 已停止' : message.state === 'error' ? ' · 未完成' : ''}</div><div className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.content || (message.state === 'pending' ? '…' : '未收到回复')}</div></article>)}
    </div>
    {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
    {busy && <p role="status" className="text-xs text-muted-foreground">{phase} · {elapsed} 秒 · 可随时停止</p>}
    {!!warnings.length && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">本轮试用提示 · {warnings.length}</summary><ul className="list-disc pl-4 space-y-1 mt-2">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
    {preview && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">查看预设组装内容 · 约 {preview.tokens} tokens · {preview.worldCount} 条世界书</summary><p className="mt-2">以下为组装后的提示词；连接设置的后处理和自定义请求参数可能继续调整发送内容。</p><div className="mt-2 space-y-2 max-h-72 overflow-y-auto">{preview.messages.map((message, index) => <pre key={index} className="whitespace-pre-wrap break-words p-2 rounded bg-[var(--hover-overlay)]">{`${message.role}\n${message.content}`}</pre>)}</div></details>}
    <div className="space-y-2"><Textarea aria-label="试用消息" placeholder="输入测试消息；Enter 发送，Shift+Enter 换行" rows={3} value={input} disabled={busy} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); } }} />
      <div className="flex flex-wrap gap-2 justify-end items-center"><p className="mr-auto text-xs text-muted-foreground">随包正则、酒馆助手与 HTML 脚本不在此执行。</p>{retryMessages && !busy && <Button type="button" size="sm" variant="outline" onClick={() => void generate(retryMessages)}><RotateCcw className="w-3.5 h-3.5 mr-1" />重试本轮</Button>}{busy ? <Button type="button" size="sm" variant="outline" onClick={stop}><Square className="w-3.5 h-3.5 mr-1" />停止</Button> : <Button type="button" size="sm" disabled={!input.trim() || loading} onClick={send}><Send className="w-3.5 h-3.5 mr-1" />发送</Button>}</div>
    </div>
  </section>;
}
