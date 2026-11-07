import type { WorldState } from '../world/schema';
import { intelligence } from '../agents/state';
import { visibleFacts } from '../memory/console';
import { WorldModelGateway } from '../agents/model-gateway';
import { BACKDROPS, parseGeneratedScene } from './scene';
export async function generateScene(world: WorldState, gateway: WorldModelGateway, signal: AbortSignal) {
  const gal = world.gal; if (!gal?.pending || gal.kind !== 'story') throw new Error('没有待续剧情');
  const data = intelligence(world), persona = data.personas[gal.actorId];
  const facts = visibleFacts(world, { kind: 'actor', actorId: gal.actorId }, true).filter(f => f.origin !== 'witness').slice(-8);
  const context = { contextRevision: data.contextRevision, character: { name: world.actors.find(a => a.id === gal.actorId)!.name,
    identity: persona.identity.slice(0, 1600), temperament: persona.temperament.slice(0, 400), background: persona.privateNotes.slice(0, 800) },
    memories: facts.map(f => ({ id: f.id, text: f.text })),
    recent: gal.scenes.slice(-2).map(s => ({ title: s.title, beats: s.beats.map(b => b.text).join('\n').slice(-900) })),
    playerAction: gal.pending.input, backgrounds: BACKDROPS };
  const { value } = await gateway.request({ purpose: 'scene', actorId: gal.actorId, tick: world.tick, maxOutput: 1024,
    system: '续写互动视觉小说。尊重角色性格与玩家行动。只输出JSON：{"title":"场景标题","background":"提供的背景名之一","beats":[{"speaker":"角色名或旁白","text":"一段50至100字对白/描写"}],"choices":[{"label":"简短行动","intent":"具体行动含义"}]}。每场2至4段，每段不超过160字，结尾2至4个有区别的行动选择。不输出HTML、脚本、数值补丁。',
    context, factIds: facts.map(f => f.id) }, signal);
  return parseGeneratedScene(value);
}
