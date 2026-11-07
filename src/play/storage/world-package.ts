import { gzipSync, Gunzip, strFromU8, strToU8 } from 'fflate';
import { bytesFromBase64, toBase64, validWorldMedia, type WorldMedia } from '../media/asset';
import { commitId, sealCommit, validCommit, type WorldCommit } from './world-commit';
import { factActive, intelligence } from '../agents/state';
export function mediaRefs(commit: WorldCommit): string[] { return [...new Set([commit.state.gal?.backgroundAsset, commit.state.gal?.portraitAsset].filter((s): s is string => !!s))]; }
export function packCommit(c: WorldCommit): string { return toBase64(gzipSync(strToU8(JSON.stringify(c)), { level: 6 })); }
function unpackCommit(text: string): WorldCommit {
  if (typeof text !== 'string' || text.length > 1_500_000) throw new Error('压缩存档过大');
  const bytes = bytesFromBase64(text), chunks: Uint8Array[] = []; let length = 0;
  const stream = new Gunzip(chunk => { length += chunk.length; if (length > 1024*1024) throw new Error('存档解压超出 1 MB 限额'); chunks.push(chunk); });
  // Bounded feeds let the output cap interrupt a highly compressible hostile stream.
  for (let i=0; i<bytes.length; i+=256) stream.push(bytes.subarray(i,i+256), i+256 >= bytes.length);
  const out = new Uint8Array(length); let offset = 0; for (const c of chunks) { out.set(c,offset); offset+=c.length; }
  return JSON.parse(strFromU8(out));
}
export interface WorldPackage { app: 'ste-world'; version: 2; scope: 'full' | 'public'; codec: 'gzip-per-commit'; entries: string[]; assets: WorldMedia[] }
export function readPackage(text: string): { bundle: WorldPackage; records: () => Generator<WorldCommit> } {
  if (new Blob([text]).size > 32*1024*1024) throw new Error('世界包不能超过 32 MB');
  const bundle = JSON.parse(text) as WorldPackage;
  if (bundle.app !== 'ste-world' || bundle.version !== 2 || bundle.codec !== 'gzip-per-commit' || !['full','public'].includes(bundle.scope)
    || !Array.isArray(bundle.entries) || !bundle.entries.length || bundle.entries.length > 2001 || !Array.isArray(bundle.assets) || bundle.assets.length > 128) throw new Error('世界包格式无效');
  if (!bundle.assets.every(validWorldMedia) || new Set(bundle.assets.map(a => a.id)).size !== bundle.assets.length) throw new Error('世界包素材损坏或重复');
  function* records() { for (const entry of bundle.entries) yield unpackCommit(entry); }
  let previous: WorldCommit | undefined, revision = 0; const available = new Set(bundle.assets.map(a => a.id));
  for (const c of records()) {
    if (!validCommit(c) || c.revision !== revision++ || c.parent !== (previous?.hash ?? null) || previous && (c.worldId !== previous.worldId || c.state.tick !== previous.state.tick + (c.kind === 'step' ? 1 : 0))) throw new Error('世界包历史链不完整');
    if (mediaRefs(c).some(ref => !available.has(ref))) throw new Error('世界包缺少引用的素材'); previous = c;
  }
  return { bundle, records };
}
/** Explicitly public snapshot, not a redacted full history. Drop prose and historical states that could repeat private data. */
export function publicSnapshot(commit: WorldCommit): WorldCommit {
  const state = structuredClone(commit.state); delete state.gal; delete state.adventure;
  const old = intelligence(state); delete state.intelligence;
  const defaults = intelligence(state);
  state.intelligence = { ...defaults, facts: old.facts.filter(f => f.visibility === 'public' && factActive(f, state.tick) && f.type !== 'secret').map(f => ({
    id: f.id, type: f.type, subject: f.subject, text: f.text, visibility: 'public', knownBy: [], status: 'enabled', origin: 'manual', tick: f.tick, revision: 0,
    ...(f.expiresAt !== undefined ? { expiresAt: f.expiresAt } : {}),
  })) };
  // Public locations/inventories survive; private action reasons do not.
  for (const actor of state.actors) if (actor.job) actor.job.reason = '按世界规则继续行动';
  const worldId = crypto.randomUUID();
  return sealCommit({ schema: 1, worldId, id: commitId(worldId,0), revision:0, parent:null, title:commit.title, updatedAt:Date.now(), kind:'create', deleted:false, state, events:[] });
}
