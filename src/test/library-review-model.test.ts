import { describe, expect, it } from 'vitest';
import type { StoryIndexEntry } from '@/lib/archive-index';
import type { SummaryItem } from '@/types/summary';
import { groupReviewRecords, reviewStories } from '@/components/library/review/review-model';
import { getReviewSession } from '@/components/library/review/review-session';

const story = (id: string, extra = {}): StoryIndexEntry => ({ id, characterId: 'a', title: id, createdAt: 1, updatedAt: 1, markers: [], floorCount: 0, meta: { modelsUsed: [], playTimeMs: null }, ...extra });
const record = (id: string, extra = {}): SummaryItem => ({ id, bookId: 's1', bookTitle: 's1', title: id, kind: 'volume', floorStart: 0, floorEnd: 10, createdAt: 1, updatedAt: 1, content: id, ...extra });

describe('review aggregation', () => {
  it('uses story IDs and never attaches an orphan by its title', () => {
    const groups = groupReviewRecords([story('s1')], [record('owned'), record('orphan', { bookId: null }), record('other', { bookId: 's2', bookTitle: 's1' })], 'volume');
    expect(groups.flatMap(g => g.branches.flatMap(b => b.records.map(r => r.id)))).toEqual(['owned']);
  });
  it('shows main, known branches and explicitly deleted branches in that order', () => {
    const groups = groupReviewRecords([story('s1', { branchIndex: [{ id: 'live', name: '另一种结局' }] })], [record('deleted', { branchId: 'gone' }), record('live', { branchId: 'live' }), record('main')], 'volume');
    expect(groups[0].branches.map(b => [b.name, b.deleted])).toEqual([['主线', false], ['另一种结局', false], ['已删除分支 · gone', true]]);
  });
  it('orders summaries by volume, floors, creation time and ID; unnumbered entries come last', () => {
    const groups = groupReviewRecords([story('s1')], [record('manual'), record('v2', { volumeNumber: 2 }), record('later', { volumeNumber: 1, floorStart: 3 }), record('newer', { volumeNumber: 1, createdAt: 4 }), record('older', { volumeNumber: 1 })], 'volume');
    expect(groups[0].branches[0].records.map(r => r.id)).toEqual(['older', 'newer', 'later', 'v2', 'manual']);
  });
  it('orders diary by creation time independently of volumes and edits', () => {
    const groups = groupReviewRecords([story('s1')], [record('new', { kind: 'diary', createdAt: 5, volumeNumber: 1 }), record('old', { kind: 'diary', createdAt: 1, volumeNumber: 10, updatedAt: 9 }), record('summary')], 'diary');
    expect(groups[0].branches[0].records.map(r => r.id)).toEqual(['old', 'new']);
  });
  it('keeps the established viewed-first story order and only the selected character', () => {
    expect(reviewStories([story('new', { createdAt: 3 }), story('foreign', { characterId: 'b' }), story('old'), story('viewed', { lastViewedAt: 5 })], 'a').map(s => s.id)).toEqual(['viewed', 'old', 'new']);
  });
});

describe('review session', () => {
  it('remembers tab, selection and separate positions only within its vault session', () => {
    const a = getReviewSession('vault-a-model');
    expect(a.tab).toBe('overview');
    a.tab = 'volume'; a.selectedId = 'a';
    a.characters.set('a', { storyId: 's1', scroll: { volume: 312, diary: 91 } });
    expect(getReviewSession('vault-a-model').characters.get('a')).toEqual({ storyId: 's1', scroll: { volume: 312, diary: 91 } });
    expect(getReviewSession('vault-b-model').tab).toBe('overview');
    expect(getReviewSession('vault-b-model').characters.size).toBe(0);
  });
});
