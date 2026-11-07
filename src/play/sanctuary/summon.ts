import { sha256 } from 'js-sha256';
import { normalizeCharacterCard } from '@/lib/png-parser';
import type { ArchiveCharacter } from '@/types/archive';
import { withIntelligence } from '../agents/state';
import type { Persona } from '../agents/types';
import { createWorld } from '../world/simulation';
import type { WorldState } from '../world/schema';
import { saveFact } from '../memory/console';
export function characterSignature(character: ArchiveCharacter): string {
  const card = normalizeCharacterCard(character.card);
  return sha256(JSON.stringify([character.name, card.description, card.personality, card.scenario, card.firstMessage, card.characterVersion]));
}
export function personaFromCard(character: ArchiveCharacter): Persona {
  const card = normalizeCharacterCard(character.card);
  return { identity: card.description.slice(0, 4000), temperament: card.personality.slice(0, 1200),
    ambition: '在陌生的休息室找到自己的位置，与来自其他世界的人相识。', privateNotes: card.scenario.slice(0, 4000),
    source: { characterId: character.id, name: character.name, hash: characterSignature(character), importedAt: Date.now() } };
}
export function createSanctuary(seed: number): WorldState {
  const world = withIntelligence(createWorld(seed)); world.setting = 'sanctuary';
  const places: Record<string, [string, string]> = {
    camp: ['星门大厅', '来自不同世界的行旅在星门下相逢。'], market: ['灯下茶室', '交换见闻与补给，偶遇会留下关系。'], forest: ['玻璃花房', '照料青叶，放慢步调。'],
    mountain: ['观星台', '搜集灵石，眺望遥远的世界。'], farm: ['共用厨房', '早晨备粮，夜晚聚餐。'], ferry: ['浮桥长廊', '雨中封闭的露天长廊。'], valley: ['静修庭', '安静修行与歇息。'], coast: ['回声书房', '收藏青叶，交换旅途的故事。'],
  };
  for (const [id, [name, description]] of Object.entries(places)) Object.assign(world.regions[id], { name, description });
  for (const actor of world.actors) { actor.goal = 'camp'; world.intelligence!.personas[actor.id].ambition = '在休息室安顿下来，备齐物资，结识同伴。'; }
  return world;
}
/** Replaces a world-local role slot only after the player reviews the mapping. Never writes source cards. */
export function summon(world: WorldState, actorId: string, character: ArchiveCharacter, persona: Persona, memories: string[]): WorldState {
  if (world.setting !== 'sanctuary') throw new Error('请在主神空间接待来客');
  if (world.adventure?.control?.actorId === actorId) throw new Error('请先结束此人的冒险');
  const next = withIntelligence(world), data = next.intelligence!, actor = next.actors.find(a => a.id === actorId);
  if (!actor) throw new Error('接待席位已不存在');
  if (!data.personas[actorId]?.source && Object.values(data.personas).filter(p => p.source).length >= 4) throw new Error('首批最多接待四位跨世界来客');
  if (Object.entries(data.personas).some(([id, p]) => id !== actorId && p.source?.characterId === character.id)) throw new Error('这位来客已经在休息室');
  if (memories.length > 8 || memories.some(m => !m.trim() || m.length > 240)) throw new Error('最多携带八条已确认短事实，每条不超过240字');
  const previousSource = data.personas[actorId]?.source;
  const refreshing = previousSource?.characterId === character.id;
  if (!refreshing) {
    // Previous slot's private knowledge must not pass to a different character.
    data.facts = data.facts.filter(f => f.owner !== actorId).map(f => ({ ...f, knownBy: f.knownBy.filter(id => id !== actorId) }));
    actor.relations = {}; actor.job = undefined;
    for (const other of next.actors) delete other.relations[actorId];
  }
  actor.name = character.name.slice(0, 100); actor.role = '异界来客';
  data.personas[actorId] = { ...persona, source: { characterId: character.id, name: character.name, hash: characterSignature(character), importedAt: Date.now() } };
  data.contextRevision++;
  return memories.reduce((state, text) => saveFact(state, { type: 'event', subject: actor.name, text, visibility: 'private', owner: actorId }), next);
}
