import { describe, expect, it } from 'vitest';
import { DEFAULT_ENTRY, exportWorldBook, parseWorldBook, type WorldBook } from '@/types/worldbook';
import { changeWorldbookUid } from '@/lib/worldbook-uid';
import { applyEntryFilters, type EntryFilterCriteria } from '@/hooks/use-entry-filters';

const book = (): WorldBook => ({ entries: {
  '10': { ...DEFAULT_ENTRY, uid: 10, content: '保留正文', extension: { enabled: true } },
  '2': { ...DEFAULT_ENTRY, uid: 2, content: '另一条' },
} });

describe('worldbook UID editing', () => {
  it('preserves stable selection keys and exports the new UID without losing data', () => {
    const original = book();
    const changed = changeWorldbookUid(original, '10', 0);
    expect(changed.entries['10'].uid).toBe(0);
    expect(original.entries['10'].uid).toBe(10);
    const parsed = parseWorldBook(JSON.parse(exportWorldBook(changed)));
    expect(Object.keys(parsed.entries)).toEqual(['0', '2']);
    expect(parsed.entries['0']).toMatchObject({ uid: 0, content: '保留正文', extension: { enabled: true } });
  });
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid UID %s', uid => {
    expect(() => changeWorldbookUid(book(), '10', uid)).toThrow('非负安全整数');
  });
  it('rejects duplicate UID and stale selection without overwriting entries', () => {
    expect(() => changeWorldbookUid(book(), '10', 2)).toThrow('已被占用');
    expect(() => changeWorldbookUid(book(), 'missing', 9)).toThrow('不存在');
  });
  it('sorts UID numerically in both directions independent of stable keys', () => {
    const entries = Object.entries(changeWorldbookUid(book(), '10', 1).entries);
    const criteria: EntryFilterCriteria = { searchQuery: '', searchScope: 'all', filterConstant: false,
      filterKeyword: false, filterVector: false, filterEnabled: false, filterDisabled: false,
      filterPosition: 'all', sortMode: 'uid' };
    expect(applyEntryFilters(entries, criteria).map(([, e]) => e.uid)).toEqual([1, 2]);
    expect(applyEntryFilters(entries, { ...criteria, sortMode: 'uid-desc' }).map(([, e]) => e.uid)).toEqual([2, 1]);
  });
});
