import { useState } from 'react';
import { loadApiProfiles, profileModels } from '@/components/ai-tools/api-profiles';
import { beginBudget } from '@/play/agents/budget';
import { intelligence, withIntelligence } from '@/play/agents/state';
import type { WorldState } from '@/play/world/schema';
import type { WorldTrace } from '@/play/agents/model-gateway';
export function WorldIntelligencePanel({ world, busy, save, traces }: { world: WorldState; busy: boolean; save: (world: WorldState) => Promise<boolean>; traces: WorldTrace[] }) {
  const data = intelligence(world), [profiles] = useState(() => loadApiProfiles()), [settings, setSettings] = useState(data.settings);
  const [actorId, setActorId] = useState(world.actors[0].id), [personas, setPersonas] = useState(data.personas);
  const profile = profiles.profiles.find(p => p.id === settings.profileId), persona = personas[actorId];
  async function apply(fresh: boolean) {
    const next = withIntelligence(world); next.intelligence!.settings = settings; next.intelligence!.personas = personas; next.intelligence!.contextRevision++;
    if (fresh) next.intelligence = beginBudget(next.intelligence!);
    await save(next);
  }
  return <div className="world-panel-stack">
    <div className="world-segments" aria-label="推演引擎"><button aria-pressed={settings.mode === 'rules'} onClick={() => setSettings({ ...settings, mode: 'rules' })}>规则演进</button><button aria-pressed={settings.mode === 'ai'} onClick={() => setSettings({ ...settings, mode: 'ai' })}>人物自主思考</button></div>
    <p className="world-muted">每位人物只根据自己知道的事作决定。行动结果由世界规则结算。</p>
    {settings.mode === 'ai' && <><label>模型连接<select aria-label="模型连接" value={settings.profileId} onChange={e => { const p = profiles.profiles.find(p => p.id === e.target.value); setSettings({ ...settings, profileId: e.target.value, model: p?.model ?? '' }); }}><option value="">选择已配置的连接</option>{profiles.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>模型<input list="world-models" value={settings.model} onChange={e => setSettings({ ...settings, model: e.target.value })} placeholder="与设置中的模型一致" /><datalist id="world-models">{profile && profileModels(profile).map(m => <option key={m}>{m}</option>)}</datalist></label>
      <label className="world-check"><input type="checkbox" checked={settings.narration} onChange={e => setSettings({ ...settings, narration: e.target.checked })} />为已发生的事写一段旁白</label>
      <details><summary>本次额度与记忆整理</summary><label>单次输出上限<input type="number" min={256} max={4096} step={256} value={settings.outputTokens ?? 2048} onChange={e => setSettings({ ...settings, outputTokens: Number(e.target.value) })} /></label><p>推理模型的思考也可能占用输出额度。遇到截断可调高上限；实际用量仍计入本次总额。</p><label>单次超时（秒）<input type="number" min={1} max={120} value={settings.requestTimeoutMs / 1000} onChange={e => setSettings({ ...settings, requestTimeoutMs: Number(e.target.value) * 1000 })} /></label><label>最多请求次数<input type="number" min={1} max={100} value={settings.maxCalls} onChange={e => setSettings({ ...settings, maxCalls: Number(e.target.value) })} /></label><label>Token 总额<input type="number" min={1000} max={200000} value={settings.maxTokens} onChange={e => setSettings({ ...settings, maxTokens: Number(e.target.value) })} /></label><label>每几步提炼待确认事实（0 为关闭）<input type="number" min={0} max={100} value={settings.reflectionEvery} onChange={e => setSettings({ ...settings, reflectionEvery: Number(e.target.value) })} /></label><p>每步最多 4 位人物思考、1 次公共旁白；持续行动不重复询问。额度会话最长 5 分钟，超时与无用量回复按预留记账。</p></details>
    </>}
    <div className="world-effect" role="status">{data.budget ? `本次已用 ${data.budget.calls} / ${data.budget.maxCalls} 次 · ${data.budget.charged.toLocaleString()} / ${data.budget.maxTokens.toLocaleString()} Token` : '尚未开始模型额度。规则演进无需联网。'}</div>
    <details><summary>人物档案 · 仅该人物知情</summary><label>人物<select aria-label="人物" value={actorId} onChange={e => setActorId(e.target.value)}>{world.actors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>{persona && (['identity', 'temperament', 'ambition', 'privateNotes'] as const).map(key => <label key={key}>{{ identity: '身世', temperament: '性情', ambition: '眼下心愿', privateNotes: '未曾告诉他人的事' }[key]}<textarea rows={3} maxLength={key === 'identity' || key === 'privateNotes' ? 4000 : 1200} value={persona[key]} onChange={e => setPersonas({ ...personas, [actorId]: { ...persona, [key]: e.target.value } })} /></label>)}</details>
    <div className="world-actions"><button disabled={busy} onClick={() => void apply(false)}>保存设置</button>{settings.mode === 'ai' && <button className="world-primary" disabled={busy || !profile || !settings.model.trim()} onClick={() => void apply(true)}>确认并开启新额度</button>}</div>
    <details><summary>调用凭据 · 最近 {data.receipts.length} 条</summary>{[...data.receipts].reverse().map(r => <div className="world-receipt" key={r.id}><strong>{world.actors.find(a => a.id === r.actorId)?.name ?? '公共旁白'} · 第 {r.tick} 步</strong><p>{r.status === 'completed' ? '已返回' : r.status === 'reserved' ? '已预留' : r.status === 'cancelled' ? '已停止' : '失败'} · {r.estimated ? '估算' : '服务用量'} {r.charged} Token{r.outcome === 'rejected' ? ' · 行动被规则拒绝' : ''}</p><small>引用事实：{r.factIds.length ? r.factIds.join('、') : '无'} · 上下文版本 {r.contextRevision}</small>{traces.find(t => t.id === r.id) && <details><summary>本次发送内容（导演可见）</summary><pre>{JSON.stringify(traces.find(t => t.id === r.id)!.request, null, 2)}</pre></details>}</div>)}</details>
  </div>;
}
