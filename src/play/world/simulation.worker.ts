import { stepWorld } from './simulation';
import type { Intervention, WorldState } from './schema';

self.onmessage = (event: MessageEvent<{ state: WorldState; command?: Intervention }>) => {
  try { self.postMessage({ result: stepWorld(event.data.state, event.data.command) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
