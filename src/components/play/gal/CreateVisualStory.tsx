import { useEffect, useState } from 'react';
import { listCharacterIndex } from '@/lib/archive-index';
import { getCharacter } from '@/lib/archive-db';
import { loadApiProfiles, profileModels } from '@/components/ai-tools/api-profiles';
import { createVisualStory } from '@/play/gal/story-adapter';
import { beginBudget } from '@/play/agents/budget';
import { currentMediaRepo } from '@/play/media/media-repo';
import { bytesFromBase64, importStageImage } from '@/play/media/asset';
import type { WorldState } from '@/play/world/schema';
export function CreateVisualStory({ create, busy }: { create: (name: string, world: WorldState) => Promise<void>; busy: boolean }) {
  const [cards, setCards] = useState<{ id: string; name: string }[]>([]), [query, setQuery] = useState(''), [id, setId] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [profiles] = useState(loadApiProfiles), [profileId, setProfileId] = useState(profiles.activeId), [model, setModel] = useState(profiles.profiles.find(p => p.id === profiles.activeId)?.model ?? '');
  useEffect(() => { let alive = true; void listCharacterIndex().then(rows => { if (alive) setCards(rows.map(({id,name}) => ({id,name}))); }, e => { if (alive) setError(String(e)); }); return () => { alive = false; }; }, []);
  return <form className="world-panel-stack" onSubmit={e => { e.preventDefault(); setLoading(true); setError(''); void (async () => { try {
    const card = await getCharacter(id); if (!card) throw new Error('请先选择角色卡'); const state = createVisualStory(card);
    state.intelligence!.settings = { ...state.intelligence!.settings, mode: 'ai', profileId, model }; state.intelligence = beginBudget(state.intelligence!);
    if (card.pngBase64 && card.pngBase64.length < 5_500_000) { try { const media = await importStageImage(new Blob([bytesFromBase64(card.pngBase64)])); await currentMediaRepo().put(media); state.gal!.portraitAsset = media.id; } catch { /* The first scene remains readable without a valid portrait. */ } }
    await create(`${card.name} · 视觉故事`, state);
  } catch (reason) { setError(String(reason)); } finally { setLoading(false); } })(); }}>
    <p>以角色卡的开场白揭幕。阅读对白无需调用模型，选择行动后才续写下一场。</p><input aria-label="搜索视觉故事角色" value={query} onChange={e => setQuery(e.target.value)} placeholder="寻找这次故事的主角…" /><label>角色<select aria-label="角色" value={id} onChange={e => setId(e.target.value)}><option value="">请选择</option>{cards.filter(c => c.name.includes(query)).slice(0,100).map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
    <label>续写连接<select aria-label="续写连接" value={profileId} onChange={e => { setProfileId(e.target.value); setModel(profiles.profiles.find(p => p.id === e.target.value)?.model ?? ''); }}>{profiles.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>续写模型<input list="gal-models" value={model} onChange={e => setModel(e.target.value)} /><datalist id="gal-models">{profileModels(profiles.profiles.find(p => p.id === profileId)!).map(m => <option key={m}>{m}</option>)}</datalist></label>
    <p className="world-effect">本次最多 30 次调用 / 64,000 Token，5 分钟后需重新确认额度。人设与开场白会派生为独立故事；作者脚本、MVU 与 SPreset 请继续使用标准聊天。</p>{error && <p role="alert">{error}</p>}<button type="submit" className="world-primary" disabled={busy || loading || !id || !model}>{loading ? '正在布置舞台…' : '揭幕'}</button>
  </form>;
}
