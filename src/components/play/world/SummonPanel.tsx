import { useEffect, useState } from 'react';
import { listCharacterIndex, listStoryIndex } from '@/lib/archive-index';
import { getCharacter } from '@/lib/archive-db';
import type { ArchiveCharacter } from '@/types/archive';
import type { WorldState } from '@/play/world/schema';
import type { Persona } from '@/play/agents/types';
import { characterSignature, personaFromCard, summon } from '@/play/sanctuary/summon';
import { intelligence } from '@/play/agents/state';
import { loadStoryTimeline, type StoryTimelineRow } from '@/play/memory/story-timeline';
export function SummonPanel({ world, busy, save }: { world: WorldState; busy: boolean; save: (state: WorldState) => Promise<boolean> }) {
  const [catalog, setCatalog] = useState<{ id: string; name: string }[]>([]), [query, setQuery] = useState(''), [selected, setSelected] = useState<ArchiveCharacter>();
  const [persona, setPersona] = useState<Persona>(), [slot, setSlot] = useState('a0'), [memories, setMemories] = useState(''), [rows, setRows] = useState<StoryTimelineRow[]>([]);
  const [reading, setReading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => { let alive = true; void listCharacterIndex().then(items => { if (alive) setCatalog(items.map(({ id, name }) => ({ id, name }))); }, reason => { if (alive) setError(String(reason)); }); return () => { alive = false; }; }, []);
  useEffect(() => { let alive = true; setRows([]); if (selected) void listStoryIndex().then(async stories => {
    const recent = stories.filter(s => s.characterId === selected.id).sort((a,b) => b.updatedAt-a.updatedAt).slice(0, 3);
    const rows = (await Promise.all(recent.map(s => loadStoryTimeline(s.id)))).flat();
    if (alive) setRows(rows.filter(r => r.text.length <= 240).slice(-30));
  }).catch(e => { if (alive) setError(String(e)); }); return () => { alive = false; }; }, [selected]);
  async function choose(id: string) {
    setReading(true); setError(''); setNotice('');
    try { const character = await getCharacter(id); if (!character) throw new Error('来源卡已不存在'); setSelected(character); setPersona(personaFromCard(character)); setMemories('');
      const existing = Object.entries(intelligence(world).personas).find(([, p]) => p.source?.characterId === id); if (existing) setSlot(existing[0]);
      else setSlot(world.actors.find(a => !intelligence(world).personas[a.id]?.source)?.id ?? 'a0');
    } catch (e) { setError(String(e)); } finally { setReading(false); }
  }
  const source = intelligence(world).personas[slot]?.source, same = selected && source?.characterId === selected.id;
  return <div className="world-panel-stack"><p>给异世界的朋友留一个位置。确认身世与携带的记忆后，他们将在这里独立生活。</p>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <input aria-label="搜索来客角色" value={query} onChange={e => setQuery(e.target.value)} placeholder="寻找角色卡…" />
    <div className="world-guest-list">{catalog.filter(c => c.name.includes(query)).slice(0, 50).map(c => <button key={c.id} disabled={reading || busy} aria-pressed={c.id === selected?.id} onClick={() => void choose(c.id)}>{c.name}</button>)}</div>
    {!catalog.length && <p>角色库还没有卡片。先从资料库导入角色，即可在这里接待。</p>}
    {reading && <p role="status">正在读取这张卡…</p>}
    {selected && persona && <form onSubmit={e => { e.preventDefault(); setError(''); void (async () => { try {
      const latest = await getCharacter(selected.id); if (!latest || characterSignature(latest) !== characterSignature(selected)) throw new Error('来源卡在预览后发生变化，请重新选择并确认');
      const next = summon(world, slot, latest, persona, memories.split('\n').map(s => s.trim()).filter(Boolean));
      if (await save(next)) { setNotice(`${selected.name}已在休息室安顿。可以开始推演，观察相遇与日程。`); setMemories(''); }
    } catch (reason) { setError(String(reason)); } })(); }}>
      <label>世界里的位置<select aria-label="世界里的位置" value={slot} onChange={e => setSlot(e.target.value)}>{world.actors.map(a => <option key={a.id} value={a.id}>{a.name} · {world.regions[a.region].name}{intelligence(world).personas[a.id]?.source ? '（已有来客）' : ''}</option>)}</select></label>
      <p className="world-effect">{same ? source.hash === characterSignature(selected) ? '来源与导入时一致，可修订本地映射。' : '来源卡已更新。确认后只更新本地人设，保留已发生的经历。' : '将此位置交给新来客；原人物的私密记忆与关系不会转交。世界中的物资仍留在此位置。'}</p>
      <label>确认身世<textarea rows={4} maxLength={4000} value={persona.identity} onChange={e => setPersona({ ...persona, identity: e.target.value })} /></label><label>性情<textarea rows={2} maxLength={1200} value={persona.temperament} onChange={e => setPersona({ ...persona, temperament: e.target.value })} /></label>
      <details><summary>只有来客自己知道的背景</summary><textarea aria-label="来客私密背景" rows={3} maxLength={4000} value={persona.privateNotes} onChange={e => setPersona({ ...persona, privateNotes: e.target.value })} /></details>
      <label>携带的短事实 · 每行一条，最多 8 条<textarea rows={3} value={memories} maxLength={2000} placeholder="例如：答应过玩家，下一次见面要一起看日出。" onChange={e => setMemories(e.target.value)} /></label>
      {!!rows.length && <details><summary>从已有故事回顾中挑选</summary>{rows.map(row => <button type="button" className="world-summary-pick" key={row.source.storyId + row.id} onClick={() => setMemories(text => [text, row.text.replace(/\n/g, ' ')].filter(Boolean).join('\n'))}>{row.text}</button>)}</details>}
      <p className="world-muted">这里接入确认后的人设与短事实。作者 HTML、MVU 和 SPreset 继续在标准聊天中运行。</p><div className="world-actions"><button type="submit" className="world-primary" disabled={busy || reading}>{same ? '确认更新映射' : '确认召唤'}</button></div>
    </form>}
  </div>;
}
