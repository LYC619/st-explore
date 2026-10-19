import { expect, it } from 'vitest';
import { parsePortraitList } from '@/lib/portrait-list-parser';
import { buildPortraitPreview, recommendPortraitRow, loadPortraitImportPreferences, savePortraitImportPreferences } from '@/lib/portrait-import-preferences';
import type { ArchiveCharacter } from '@/types/archive';
import { processPortraitImport } from '@/lib/portrait-import-parser';
import { buildPortraitExampleRule } from '@/lib/portrait-example-rule';
const character = { id: 'c', portraitRows: [{ id: 'a', title: 'Andrea', items: [] }, { id: 'b', title: 'Andrea happy', items: [] }, { id: 'j', title: '乔伊', items: [] }] } as unknown as ArchiveCharacter;
it('recommends only a unique longest prefix within this character', () => {
  expect(recommendPortraitRow('Andrea_happy_微笑', character.portraitRows!)).toBe('b');
  expect(recommendPortraitRow('未匹配', character.portraitRows!)).toBeNull();
  expect(recommendPortraitRow('乔伊害羞', [...character.portraitRows!, { id: 'j2', title: '乔 伊', items: [] }])).toBeNull();
});
it('retains edits for unchanged raw lines but never transfers a name or row to a changed source line', () => {
  const first = buildPortraitPreview(parsePortraitList('乔伊害羞_abcd.png\n坏行'), [], character);
  first[0] = { ...first[0], name: '手改名字', rowId: 'a', manualName: true, manualRow: true };
  const next = buildPortraitPreview(parsePortraitList('新行\n乔伊害羞_abcd.png\n坏行'), first, character);
  expect(next[1]).toMatchObject({ name: '手改名字', rowId: 'a' }); expect(next[0].name).not.toBe('手改名字');
  const changed = buildPortraitPreview(parsePortraitList('乔伊开心_efgh.png'), first, character);
  expect(changed[0]).toMatchObject({ name: '乔伊开心', rowId: 'j' });
});
it('stores versioned settings without source text', () => {
  localStorage.clear(); savePortraitImportPreferences({ version: 1, mode: 'auto', host: 'https://files.catbox.moe/', pattern: '', template: '', encode: true });
  expect(loadPortraitImportPreferences()).toMatchObject({ mode: 'auto', version: 1 });
  expect(JSON.stringify(loadPortraitImportPreferences())).not.toContain('source');
});

it('advanced rows retain exact matches and original line numbers across reordered names', () => {
  const rules = { mode: 'advanced' as const, pattern: '^([^:\\r\\n]+): (.+)$', template: 'https://image.example/$2', encode: true };
  const parsed = processPortraitImport({ ...rules, source: '\nAlice: abcd.png\n\nAlice: efgh.png' });
  expect(parsed.items.map(item => [item.line, item.raw])).toEqual([[2, 'Alice: abcd.png'], [4, 'Alice: efgh.png']]);
  const before = buildPortraitPreview(parsed, [], character);
  before[0] = { ...before[0], name: '手改名称', manualName: true, url: 'https://image.example/manual.png', manualUrl: true, rowId: 'a', manualRow: true };
  const after = buildPortraitPreview(processPortraitImport({ ...rules, source: 'Alice: efgh.png\n\n\nAlice: abcd.png' }), before, character);
  expect(after[0]).toMatchObject({ line: 1, url: 'https://image.example/efgh.png', name: 'Alice' });
  expect(after[1]).toMatchObject({ line: 4, url: 'https://image.example/manual.png', name: '手改名称', rowId: 'a' });
  expect(buildPortraitPreview(processPortraitImport({ ...rules, source: 'Alice: ijkl.png' }), before, character)[0])
    .toMatchObject({ url: 'https://image.example/ijkl.png', name: 'Alice', rowId: null });
});
it('selects repaired failed rows after applying a sample rule while preserving deliberate valid-row deselection', () => {
  const text = '姓名【乔伊】 文件【abcd.png】';
  const before = buildPortraitPreview(parsePortraitList(text), [], character);
  const start = text.indexOf('abcd');
  const rule = buildPortraitExampleRule(text, { start: 3, end: 5 }, { start, end: start + 8 });
  const result = processPortraitImport({ mode: 'auto', source: text, rule });
  const repaired = buildPortraitPreview(result, before, character);
  expect(repaired[0].selected).toBe(true);
  repaired[0].selected = false;
  expect(buildPortraitPreview(result, repaired, character)[0].selected).toBe(false);
});
