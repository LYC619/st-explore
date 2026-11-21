import type { STRawMessage } from '../types/chat';
import type { TavernHost } from '../lib/roleplay/frame';
import type { DraftCheckpoint } from '../lib/roleplay/draft';
export type Host = TavernHost;
export type RequestHost = Pick<Host, 'request'>;
export interface RecoveryState {
  chat: STRawMessage[]; chat_metadata: Record<string, unknown>;
  name1: string; name2: string; getCurrentChatId(): string | undefined;
}
export interface DraftState extends RecoveryState { printMessages(): Promise<void>; saveChatConditional(): Promise<void> }
export interface DraftSnapshot { draft: DraftCheckpoint; changed: boolean; conflict: boolean }
export interface RestoredDraft extends DraftSnapshot { chat: STRawMessage[]; input: string }
export type StatusHost = Pick<Host, 'isGenerating' | 'isForeground' | 'subscribeActivity'>;
export interface PollPage {
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(id: number): void;
  addEventListener: Window['addEventListener']; removeEventListener: Window['removeEventListener'];
}
