import { describe, expect, it } from 'vitest';
import {
  clampNovelLocation, findPageForNovelLocation, paginateNovelDocument,
  type NovelChapter,
} from '@/lib/novel-view';

const chapters: NovelChapter[] = [
  { startFloor: 0, endFloor: 0, blocks: [
    { type: 'narration', floor: 0, text: 'A long paragraph with spaces and punctuation. '.repeat(40) },
  ] },
  { title: 'Next', startFloor: 1, endFloor: 1, blocks: [
    { type: 'scene-break', floor: 1, text: '***' },
    { type: 'narration', floor: 1, text: 'The next chapter.' },
  ] },
];

describe('novel logical locations', () => {
  it('preserves source offsets across page splits and chapter boundaries', () => {
    const pages = paginateNovelDocument(chapters, 150);
    const firstChapter = pages.filter(page => page.chapterIndex === 0);
    expect(firstChapter.length).toBeGreaterThan(5);
    let offset = 0;
    for (const page of firstChapter) {
      expect(page.startLocation).toEqual({ blockIndex: 0, offset });
      offset += page.blocks.map(block => block.text).join('').length;
      expect(page.endLocation).toEqual({ blockIndex: 0, offset });
    }
    expect(offset).toBe(chapters[0].blocks[0].text.length);
    expect(pages.at(-1)?.startLocation).toEqual({ blockIndex: 1, offset: 0 });
    expect(pages.at(-1)?.endLocation).toEqual({ blockIndex: 2, offset: 17 });
  });

  it('keeps a long single-floor position through reflow and selects the new page at a boundary', () => {
    const before = paginateNovelDocument(chapters, 150);
    const location = before[5].startLocation;
    const after = paginateNovelDocument(chapters, 240);
    const index = findPageForNovelLocation(after, location);
    expect(index).toBeGreaterThan(0);
    expect(after[index].startLocation.offset).toBeLessThanOrEqual(location.offset);
    expect(after[index].endLocation.offset).toBeGreaterThan(location.offset);
    for (let i = 0; i < after.length; i++) {
      expect(findPageForNovelLocation(after, after[i].startLocation)).toBe(i);
    }
    expect(findPageForNovelLocation(after, after.at(-1)!.endLocation)).toBe(after.length - 1);
    expect(findPageForNovelLocation([], location)).toBe(0);
  });

  it('clamps empty, nonfinite, negative and shortened content locations', () => {
    expect(clampNovelLocation({ blockIndex: 4, offset: 99 }, [])).toEqual({ blockIndex: 0, offset: 0 });
    expect(clampNovelLocation({ blockIndex: Infinity, offset: NaN }, [10])).toEqual({ blockIndex: 0, offset: 0 });
    expect(clampNovelLocation({ blockIndex: -4, offset: -1 }, [10])).toEqual({ blockIndex: 0, offset: 0 });
    expect(clampNovelLocation({ blockIndex: 8, offset: 99 }, [10, 20])).toEqual({ blockIndex: 1, offset: 20 });
  });
});
