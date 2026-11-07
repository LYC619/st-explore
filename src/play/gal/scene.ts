import type { WorldState } from '../world/schema';
export const BACKDROPS = ['mist', 'forest', 'mountain', 'coast', 'town', 'rain', 'dusk', 'night', 'garden', 'snow', 'sanctuary', 'dawn'] as const;
export type Backdrop = typeof BACKDROPS[number];
export interface Beat { id: string; text: string; speaker?: string; next?: string }
export interface Choice { id: string; label: string; intent: string; command?: 'face' | 'avoid' }
export interface Scene { id: string; title: string; background: Backdrop; beats: Beat[]; entry: string; choices: Choice[] }
export interface GalState {
  kind: 'story' | 'encounter'; revision: number; actorId: string; scenes: Scene[]; activeSceneId: string; beatId: string;
  choices: { sceneId: string; choiceId: string; text: string }[];
  pending?: { id: string; sceneId: string; choiceId: string; input: string };
  encounterId?: string; backgroundAsset?: string; portraitAsset?: string;
}
export function currentScene(gal: GalState): Scene { return gal.scenes.find(s => s.id === gal.activeSceneId)!; }
export function currentBeat(gal: GalState): Beat { return currentScene(gal).beats.find(b => b.id === gal.beatId)!; }
export function validateScene(value: unknown): asserts value is Scene {
  const s = value as Scene, short = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (!s || !short(s.id, 100) || !short(s.title, 100) || !BACKDROPS.includes(s.background) || !Array.isArray(s.beats) || s.beats.length < 1 || s.beats.length > 12
    || !Array.isArray(s.choices) || s.choices.length < 2 || s.choices.length > 4) throw new Error('剧场场景格式无效');
  const ids = new Set(s.beats.map(b => b.id));
  if (ids.size !== s.beats.length || !ids.has(s.entry)) throw new Error('对白节点重复或入口缺失');
  for (const b of s.beats) if (!short(b.id, 100) || !short(b.text, 1200) || b.speaker !== undefined && !short(b.speaker, 60) || b.next !== undefined && !ids.has(b.next)) throw new Error('对白存在断边或超长文本');
  let next: string | undefined = s.entry; const visited = new Set<string>();
  while (next) { if (visited.has(next)) throw new Error('对白不能循环'); visited.add(next); next = s.beats.find(b => b.id === next)!.next; }
  if (visited.size !== s.beats.length) throw new Error('存在不可达对白');
  if (new Set(s.choices.map(c => c.id)).size !== s.choices.length) throw new Error('选项标识重复');
  for (const c of s.choices) if (!short(c.id, 100) || !short(c.label, 80) || !short(c.intent, 400) || c.command !== undefined && !['face', 'avoid'].includes(c.command)) throw new Error('选项格式无效');
}
export function validateGal(world: WorldState): void {
  const g = world.gal; if (!g) return;
  if (!['story', 'encounter'].includes(g.kind) || !Number.isSafeInteger(g.revision) || g.revision < 0 || !world.actors.some(a => a.id === g.actorId)
    || !Array.isArray(g.scenes) || !g.scenes.length || g.scenes.length > 24 || !Array.isArray(g.choices) || g.choices.length > 100
    || g.choices.some(c => !c || typeof c.sceneId !== 'string' || typeof c.choiceId !== 'string' || typeof c.text !== 'string' || c.text.length > 400)
    || g.backgroundAsset !== undefined && !/^[a-f0-9]{64}$/.test(g.backgroundAsset) || g.portraitAsset !== undefined && !/^[a-f0-9]{64}$/.test(g.portraitAsset)) throw new Error('剧场进度无效');
  g.scenes.forEach(validateScene);
  if (new Set(g.scenes.map(s => s.id)).size !== g.scenes.length || !currentScene(g) || !currentBeat(g)) throw new Error('剧场断点不存在');
  if (g.pending && (g.pending.sceneId !== g.activeSceneId || typeof g.pending.id !== 'string' || typeof g.pending.input !== 'string' || g.pending.input.length > 400 || typeof g.pending.choiceId !== 'string')) throw new Error('待续选项无效');
  if (g.kind === 'encounter' && (!world.adventure?.encounter || world.adventure.encounter.id !== g.encounterId || world.adventure.control?.actorId !== g.actorId)) throw new Error('剧场与世界遭遇已脱节');
}
export function sceneFromText(title: string, speaker: string, text: string, background: Backdrop = 'mist'): Scene {
  const chunks = text.replace(/<[^>]*>/g, '').trim().match(/[\s\S]{1,280}/g)?.slice(0, 10) ?? ['风停在此刻，等待你的第一句话。'];
  return { id: crypto.randomUUID(), title: title.slice(0, 100), background, entry: 'b0', beats: chunks.map((text, i) => ({ id: 'b' + i, text, ...(speaker ? { speaker: speaker.slice(0, 60) } : {}), ...(i < chunks.length - 1 ? { next: 'b' + (i + 1) } : {}) })),
    choices: [{ id: 'ask', label: '走近，听听对方的故事', intent: '走近对方，询问眼下的事情' }, { id: 'observe', label: '留意周围，寻找线索', intent: '仔细观察此处环境，寻找值得注意的线索' }] };
}
export function startGal(world: WorldState, scene: Scene, kind: GalState['kind'], actorId: string): WorldState {
  validateScene(scene); const next = structuredClone(world);
  next.gal = { kind, actorId, revision: 0, scenes: [scene], activeSceneId: scene.id, beatId: scene.entry, choices: [],
    ...(kind === 'encounter' ? { encounterId: world.adventure?.encounter?.id } : {}) };
  validateGal(next); return next;
}
export function encounterTheater(world: WorldState): WorldState {
  const encounter = world.adventure?.encounter, control = world.adventure?.control;
  if (!encounter || !control) throw new Error('此刻没有等待选择的遭遇');
  const actor = world.actors.find(a => a.id === control.actorId)!;
  const scene = sceneFromText(encounter.title, '', `${world.regions[encounter.region].name}，${actor.name}停下脚步。\n${encounter.description}`, world.setting === 'sanctuary' ? 'sanctuary' : 'forest');
  scene.choices = [{ id: 'face', label: '上前应对', intent: `气血风险 ${encounter.kind === 'beast' ? `${encounter.danger}～${encounter.danger * 2}` : 5}；最多 ${encounter.reward} 份当地物资`, command: 'face' }, { id: 'avoid', label: '谨慎退避', intent: '离开眼前的遭遇，保留物资与气血', command: 'avoid' }];
  return startGal(world, scene, 'encounter', actor.id);
}
export function advanceBeat(world: WorldState, expected: number): WorldState {
  const next = structuredClone(world), gal = next.gal;
  if (!gal || gal.revision !== expected || gal.pending) throw new Error('对白进度已变化');
  const beat = currentBeat(gal); if (!beat.next) return world;
  gal.beatId = beat.next; gal.revision++; return next;
}
export function stageChoice(world: WorldState, expected: number, choiceId: string, freeText?: string): WorldState {
  const next = structuredClone(world), gal = next.gal;
  if (!gal || gal.revision !== expected || gal.pending || currentBeat(gal).next) throw new Error('选项已经处理或还未读到这里');
  const scene = currentScene(gal), choice = scene.choices.find(c => c.id === choiceId);
  const input = choiceId === 'free' ? freeText?.trim() : choice?.intent;
  if (!input || input.length > 400 || gal.choices.some(c => c.sceneId === scene.id)) throw new Error('此选项已失效或输入过长');
  gal.pending = { id: crypto.randomUUID(), sceneId: scene.id, choiceId, input }; gal.revision++; return next;
}
export function acceptScene(world: WorldState, pendingId: string, scene: Scene): WorldState {
  validateScene(scene); const next = structuredClone(world), gal = next.gal;
  if (!gal?.pending || gal.pending.id !== pendingId || gal.scenes.some(s => s.id === scene.id)) throw new Error('剧情请求已过期');
  gal.choices = [...gal.choices.slice(-99), { sceneId: gal.pending.sceneId, choiceId: gal.pending.choiceId, text: gal.pending.input }];
  gal.scenes = [...gal.scenes.slice(-23), scene]; gal.activeSceneId = scene.id; gal.beatId = scene.entry; gal.revision++; delete gal.pending; return next;
}
/** Provider output is rebuilt from a tiny declarative schema. No HTML/scripts/media URLs/state patches are accepted. */
export function parseGeneratedScene(value: unknown): Scene {
  const v = value as { title?: string; background?: Backdrop; beats?: { speaker?: string; text?: string }[]; choices?: { label?: string; intent?: string }[] };
  if (!v || !Array.isArray(v.beats) || !Array.isArray(v.choices)) throw new Error('剧情输出格式不完整');
  const scene: Scene = { id: crypto.randomUUID(), title: v.title!, background: v.background!, entry: 'b0',
    beats: v.beats.map((b, i) => ({ id: `b${i}`, text: b?.text ?? '', ...(b?.speaker ? { speaker: b.speaker } : {}), ...(i < v.beats!.length - 1 ? { next: `b${i + 1}` } : {}) })),
    choices: v.choices.map((c, i) => ({ id: `c${i}`, label: c?.label ?? '', intent: c?.intent ?? '' })) };
  validateScene(scene); return scene;
}
