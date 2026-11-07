export const RULESET = 'shanhai-1' as const;
export const RESOURCES = ['herb', 'food', 'ore'] as const;
export type Resource = typeof RESOURCES[number];
export const RESOURCE_NAMES: Record<Resource, string> = { herb: '青叶', food: '干粮', ore: '灵石' };
export type Bag = Record<Resource, number>;
export type Action = 'move' | 'gather' | 'rest' | 'train' | 'trade' | 'gift' | 'talk' | 'help';
export const ACTION_NAMES: Record<Action, string> = { move: '行路', gather: '采集', rest: '歇息', train: '修行', trade: '交易', gift: '赠予', talk: '交谈', help: '援助' };
export interface Job { type: Action; remaining: number; duration: number; reason: string; to?: string; resource?: Resource; peer?: string }
export interface Actor {
  id: string; name: string; role: string; color: string; region: string; energy: number; xp: number;
  bag: Bag; goal: string; home: string; specialty: Resource; sociability: number; job?: Job;
  relations: Record<string, number>; lastSocial: number; journeys: number;
}
export interface Region { id: string; name: string; x: number; y: number; stock: Bag; resource: Resource; description: string }
export interface WorldState {
  schema: 1; ruleset: typeof RULESET; tick: number; rng: number;
  weather: { rainUntil: number }; actors: Actor[]; regions: Record<string, Region>;
}
export type Intervention = { type: 'rain'; duration: number }
  | { type: 'supply'; region: string; resource: Resource; amount: number }
  | { type: 'gathering'; region: string };
export interface WorldEvent { id: string; tick: number; kind: string; title: string; detail: string; cause: string; actors: string[]; region: string }
export interface StepResult { state: WorldState; events: WorldEvent[] }
export interface Edge { from: string; to: string; cost: number; ferry?: boolean }
