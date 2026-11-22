import { scopedKey } from '@/lib/vault/vault-scope';

export type ReviewTab = 'overview' | 'notes' | 'stories' | 'volume' | 'diary' | 'tree';
export interface ReviewCharacterSession { storyId?: string; storyScroll?: number; scroll: Partial<Record<ReviewTab, number>> }
export interface ReviewSession {
  selectedId?: string;
  tab: ReviewTab;
  onlyWithStories: boolean;
  directoryScroll: number;
  characters: Map<string, ReviewCharacterSession>;
}
// Deliberately contains navigation context only, and never persists archive data.
const sessions = new Map<string, ReviewSession>();
export function getReviewSession(scope = scopedKey('library-review')): ReviewSession {
  let session = sessions.get(scope);
  if (!session) {
    session = { tab: 'overview', onlyWithStories: false, directoryScroll: 0, characters: new Map() };
    sessions.set(scope, session);
  }
  return session;
}
