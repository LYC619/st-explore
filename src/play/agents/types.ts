export interface Persona {
  identity: string; temperament: string; privateNotes: string; ambition: string;
  source?: { characterId: string; hash: string; name: string; importedAt: number };
}
export interface WorldFact {
  id: string; type: 'promise' | 'status' | 'event' | 'secret'; subject: string; text: string;
  visibility: 'public' | 'private'; owner?: string; knownBy: string[];
  status: 'enabled' | 'disabled' | 'pending' | 'deleted'; origin: 'manual' | 'witness' | 'model' | 'import';
  tick: number; eventId?: string; source?: { storyId: string; branchId?: string; floor?: number; summaryId?: string };
  expiresAt?: number; revision: number; previousStatus?: Exclude<WorldFact['status'], 'deleted'>;
}
export interface WorldAISettings {
  mode: 'rules' | 'ai'; profileId: string; model: string; narration: boolean; reflectionEvery: number;
  maxCalls: number; maxTokens: number; requestTimeoutMs: number; outputTokens?: number;
}
export interface WorldRequestReceipt {
  id: string; runId: string; purpose: 'plan' | 'narrative' | 'reflection' | 'scene'; actorId?: string;
  tick: number; contextRevision: number; factIds: string[]; model: string;
  reserved: number; charged: number; estimated: boolean; status: 'reserved' | 'completed' | 'failed' | 'cancelled';
  inputTokens?: number; outputTokens?: number; elapsedMs?: number;
  outcome?: 'accepted' | 'rejected';
}
export interface WorldRunBudget { id: string; startedAt: number; calls: number; charged: number; maxCalls: number; maxTokens: number }
export interface WorldIntelligence {
  version: 1; contextRevision: number; settings: WorldAISettings; personas: Record<string, Persona>;
  facts: WorldFact[]; receipts: WorldRequestReceipt[]; budget?: WorldRunBudget; cursor: number;
  /** Only public prose. Private reasoning belongs to the request's scoped diagnostics. */
  narratives: { tick: number; text: string; eventIds: string[] }[];
}
export type Perspective = { kind: 'director' } | { kind: 'observer' } | { kind: 'actor'; actorId: string };
