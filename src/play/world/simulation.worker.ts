import { stepWorld } from './simulation';
import type { Intervention, WorldState } from './schema';

self.onmessage = (event: MessageEvent<{ state: WorldState; command?: Intervention; options?: { deferPlans?: boolean } }>) => {
  try { self.postMessage({ result: stepWorld(event.data.state, event.data.command, event.data.options) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
