import type { STRawMessage } from '../types/chat';
import type { HelperGrant, HelperSettings } from '../lib/roleplay/helper-settings';
import type { STRegexScript } from '../lib/st-regex-interop';
import type { DraftCheckpoint } from '../lib/roleplay/draft';

/** Only explicitly modelled envelopes cross the opaque helper frame boundary. */
export interface PublicMessage {
  message_id: number; name: string; role: string; is_hidden: boolean; message: string;
  data: Record<string, unknown>; extra: Record<string, unknown>; swipe_id: number;
  swipes: string[]; swipes_data: Record<string, unknown>[]; swipes_info: Record<string, unknown>[];
}
export interface HelperSnapshot {
  messages: PublicMessage[]; sources: string[]; variables: Record<string, unknown>;
  globalVariables: Record<string, unknown>; scriptData: Record<string, unknown>; user: string; character: string;
}
export interface HelperInitial {
  snapshot: HelperSnapshot; grants: HelperGrant[]; scriptId: string | null; messageId: number | null;
  events: Record<string, string>;
}
export interface VariableOption { type: 'chat' | 'global' | 'script' | 'message'; message_id?: number | 'latest'; script_id?: string }
export interface ResolvedVariableOption { type: VariableOption['type']; message_id?: number }
export interface MessagePatch { message_id: number; message?: string; data?: Record<string, unknown>; extra?: Record<string, unknown>; is_hidden?: boolean }
export interface GenerateOptions { user_input?: string; should_stream?: boolean; should_silence?: boolean; ordered_prompts?: { role: string; content: string }[] }
export interface HelperRequests {
  replaceVariables: { option: ResolvedVariableOption; expected: string; value: Record<string, unknown>; source?: string };
  setChatMessages: { messages: unknown[]; options?: { refresh?: string }; sources: string[]; baselines: Pick<PublicMessage, 'data' | 'extra'>[] };
  substitute: { text: string };
  triggerSlash: { command: string };
  generate: GenerateOptions;
  generateRaw: GenerateOptions;
}
export type HelperRequest = { [K in keyof HelperRequests]: { kind: 'request'; id: number; method: K; args: HelperRequests[K] } }[keyof HelperRequests];
export type HelperToHost = HelperRequest | { kind: 'ready' } | { kind: 'height'; height: number }
  | { kind: 'error'; message: string } | { kind: 'event-done'; id: number; error?: string };
export type HostToHelper = { kind: 'reply'; id: number; result?: unknown; error?: string; snapshot: HelperSnapshot }
  | { kind: 'event'; id: number; name: string; args: unknown[]; snapshot: HelperSnapshot }
  | { kind: 'snapshot'; snapshot: HelperSnapshot };
export type HelperEnvelope<T = HelperToHost | HostToHelper> = T & { steHelper: string };
export type RawMessage = STRawMessage;

/** Unified discriminated-union protocol for Tavern lifecycle events reported to the parent STE host. */
export type TavernProcessEvent =
  | { kind: 'start'; id?: string; type: string }
  | { kind: 'world'; id?: string; detail: { world: string; uid: string | number; name?: string; constant?: boolean }[] }
  | { kind: 'bind'; id?: string; messageId: string; candidateId?: string; floor: number }
  | { kind: 'processed'; id?: string; detail: { content?: string; variables?: unknown } }
  | { kind: 'stop'; id?: string }
  | { kind: 'end'; id?: string };

/** Discriminated union of STE host bridge RPC messages exchanged between the embedded Tavern frame and parent host. */
export type TavernHostMessage =
  | { path: '/ste/draft'; body: { chatKey: string } }
  | { path: '/ste/draft/capture'; body: { chatKey: string; chat: unknown[]; input: string; editor?: { index: number; text: string } } }
  | { path: '/ste/draft/restore'; body: { chatKey: string } }
  | { path: '/ste/draft/discard'; body: { chatKey: string } }
  | { path: '/ste/helpers'; body?: undefined }
  | { path: '/ste/helpers/save'; body: { chatKey: string; revision: string; settings: HelperSettings } }
  | { path: '/ste/helpers/import'; body: { chatKey: string; revision: string; scripts: unknown } }
  | { path: '/ste/regex-assets'; body?: undefined }
  | { path: '/ste/regex-assets/save'; body: { chatKey?: string; revisions: Record<string, string>; globalScripts?: STRegexScript[]; embeddedScripts?: STRegexScript[] } }
  | { path: '/ste/runtime'; body?: { mode?: string; memoryOwner?: string } }
  | { path: '/ste/runtime/status'; body?: undefined }
  | { path: '/ste/runtime/retry-memory'; body?: undefined }
  | { path: '/ste/runtime/reset-context'; body?: undefined }
  | { path: '/ste/runtime/confirm-candidate'; body: { turnId: string; messageId: string; candidateId: string; content?: string } }
  | { path: '/ste/configuration'; body?: { restore?: boolean; mainProfileId?: string; toolProfileId?: string } }
  | { path: '/ste/extensions'; body?: undefined }
  | { path: '/ste/extensions/install'; body: { bytes: number[] } }
  | { path: '/ste/extensions/remove'; body?: undefined }
  | { path: '/ste/extensions/package'; body?: undefined }
  | { path: '/ste/extensions/helper/install'; body: { bytes: number[] } }
  | { path: '/ste/extensions/helper/remove'; body?: undefined }
  | { path: '/ste/extensions/helper/package'; body?: undefined }
  | { path: '/ste/story-package/export'; body?: undefined }
  | { path: '/ste/story-package/preview'; body: { text: string } }
  | { path: '/ste/story-package/import'; body: { token: string } }
  | { path: '/ste/open-story'; body: { storyId: string } }
  | { path: '/ste/open-url'; body: { url: string } }
  | { path: '/ste/branches'; body?: undefined }
  | { path: '/ste/memory'; body?: undefined }
  | { path: '/ste/memory/save'; body: { path: string; body: string; expectedDigest: string | null } }
  | { path: '/ste/worldbook-versions'; body?: undefined }
  | { path: '/ste/worldbook-versions/effective'; body?: undefined }
  | { path: '/ste/worldbook-versions/accept'; body: { id: string } }
  | { path: '/ste/worldbook-versions/reject'; body: { id: string } }
  | { path: '/ste/story-worlds'; body?: undefined }
  | { path: '/ste/library/refresh'; body?: undefined }
  | { path: '/ste/manage-profiles'; body?: undefined }
  | { path: '/ste/manage'; body: { target: string } }
  | { path: '/ste/invoke'; body: { command: string; args?: Record<string, unknown> } };

export type TavernBridgeMessage =
  | { channel: 'helper-to-host'; envelope: HelperEnvelope<HelperToHost> }
  | { channel: 'host-to-helper'; envelope: HelperEnvelope<HostToHelper> }
  | { channel: 'process-event'; event: TavernProcessEvent }
  | { channel: 'host-rpc'; call: TavernHostMessage }
  | { channel: 'startup'; message: string; failed: boolean };

export interface DraftResponseSnapshot { draft: DraftCheckpoint; changed: boolean; conflict: boolean }
export interface DraftRestoreResponse extends DraftResponseSnapshot { chat: STRawMessage[]; input: string }
export interface RegexFrontendRule { lane: 'globalScripts' | 'embeddedScripts'; script: STRegexScript }
export interface RegexAssetsSnapshot {
  chatKey?: string;
  globalScripts: STRegexScript[];
  embeddedScripts: STRegexScript[];
  revisions: Record<string, string>;
  suppressedEmbeddedIds: string[];
  suppressedEmbeddedScripts?: STRegexScript[];
  missingAssetIds?: string[];
  frontend?: { rules?: RegexFrontendRule[] } | null;
  frontendScripts?: { id?: string; data?: Record<string, unknown>; [key: string]: unknown }[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const requestMethods = new Set<keyof HelperRequests>(['replaceVariables', 'setChatMessages', 'substitute', 'triggerSlash', 'generate', 'generateRaw']);

function isSnapshot(value: unknown): value is HelperSnapshot {
  return isRecord(value)
    && Array.isArray(value.messages)
    && Array.isArray(value.sources)
    && isRecord(value.variables)
    && isRecord(value.globalVariables)
    && isRecord(value.scriptData)
    && typeof value.user === 'string'
    && typeof value.character === 'string';
}

/** Structural guard; the host additionally checks frame identity, token, grants and revisions. */
export function isHelperToHost(value: unknown): value is HelperEnvelope<HelperToHost> {
  if (!isRecord(value) || typeof value.steHelper !== 'string' || !value.steHelper) return false;
  if (value.kind === 'ready') return true;
  if (value.kind === 'height') return typeof value.height === 'number' && Number.isFinite(value.height);
  if (value.kind === 'error') return typeof value.message === 'string';
  if (value.kind === 'event-done') return Number.isSafeInteger(value.id) && Number(value.id) > 0 && (value.error === undefined || typeof value.error === 'string');
  if (value.kind !== 'request' || !Number.isSafeInteger(value.id) || Number(value.id) <= 0 || !isRecord(value.args)
    || typeof value.method !== 'string' || !requestMethods.has(value.method as keyof HelperRequests)) return false;
  const args = value.args;
  if (value.method === 'replaceVariables') return isRecord(args.option) && ['chat', 'global', 'script', 'message'].includes(String(args.option.type))
    && (args.option.type !== 'message' || Number.isSafeInteger(args.option.message_id)) && typeof args.expected === 'string' && isRecord(args.value)
    && (args.source === undefined || typeof args.source === 'string');
  if (value.method === 'setChatMessages') return Array.isArray(args.messages) && Array.isArray(args.sources)
    && args.sources.every(v => typeof v === 'string') && Array.isArray(args.baselines)
    && args.baselines.every(v => isRecord(v) && isRecord(v.data) && isRecord(v.extra))
    && (args.options === undefined || isRecord(args.options));
  if (value.method === 'substitute') return typeof args.text === 'string';
  if (value.method === 'triggerSlash') return typeof args.command === 'string';
  return (args.user_input === undefined || typeof args.user_input === 'string')
    && (args.should_stream === undefined || typeof args.should_stream === 'boolean')
    && (args.should_silence === undefined || typeof args.should_silence === 'boolean')
    && (args.ordered_prompts === undefined || Array.isArray(args.ordered_prompts)
      && args.ordered_prompts.every(v => isRecord(v) && typeof v.role === 'string' && typeof v.content === 'string'));
}

/** Structural guard for host-to-helper envelopes crossing into the opaque sandbox frame. */
export function isHostToHelper(value: unknown): value is HelperEnvelope<HostToHelper> {
  if (!isRecord(value) || typeof value.steHelper !== 'string' || !value.steHelper) return false;
  if (value.kind === 'snapshot') return isSnapshot(value.snapshot);
  if (value.kind === 'reply') {
    return Number.isSafeInteger(value.id) && Number(value.id) > 0
      && (value.error === undefined || typeof value.error === 'string')
      && isSnapshot(value.snapshot);
  }
  if (value.kind === 'event') {
    return Number.isSafeInteger(value.id) && Number(value.id) > 0
      && typeof value.name === 'string'
      && Array.isArray(value.args)
      && isSnapshot(value.snapshot);
  }
  return false;
}
