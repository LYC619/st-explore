import { describe, expect, it } from 'vitest';
import type { ChatMessage, RegexRule } from '@/types/chat';
import { applyRegexRules, convertMessagesToMarkdown, convertMessagesToTxt } from '@/lib/regex-processor';
import { previewRegexRules } from '@/lib/regex-preview';
import { ruleToSTScript, stScriptToRule } from '@/lib/st-regex-interop';
import { buildNovelDocument } from '@/lib/novel-view';

const rule = (patch: Partial<RegexRule> = {}): RegexRule => ({ id: 'depth', name: '范围', findRegex: '/foo/g', replaceString: 'bar', placement: ['all'], disabled: false, ...patch });
const messages: ChatMessage[] = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'user' : 'assistant', content: `foo${i}`, rawData: {} }));

describe('ST message depth', () => {
  it('includes the most recent N messages and excludes the next older message', () => {
    const recent = rule({ maxDepth: 1 });
    expect([0, 1, 2, 3].map(depth => applyRegexRules('foo', [recent], false, depth))).toEqual(['bar', 'bar', 'foo', 'foo']);
    const older = rule({ minDepth: 2 });
    expect([0, 1, 2, 3].map(depth => applyRegexRules('foo', [older], false, depth))).toEqual(['foo', 'foo', 'bar', 'bar']);
  });
  it('uses inclusive ST bounds together with message placement and disabled state', () => {
    const bounded = rule({ minDepth: 1, maxDepth: 2, placement: ['assistant'] });
    expect([0, 1, 2, 3].map(depth => applyRegexRules('foo', [bounded], false, depth))).toEqual(['foo', 'bar', 'bar', 'foo']);
    expect(applyRegexRules('foo', [bounded], true, 1)).toBe('foo');
    expect(applyRegexRules('foo', [{ ...bounded, disabled: true }], false, 1)).toBe('foo');
  });
  it('requires depth for bounded rules but keeps unbounded plain-text behavior', () => {
    expect(applyRegexRules('foo', [rule({ maxDepth: 1 })], false)).toBe('foo');
    expect(applyRegexRules('foo', [rule({ minDepth: -1, maxDepth: null })], false)).toBe('bar');
    expect(applyRegexRules('foo', [rule()], false)).toBe('bar');
  });
  it('applies legacy _raw depth and lets explicit clearing override it', () => {
    const legacy = rule({ _raw: { minDepth: 2, maxDepth: 4 } });
    expect(applyRegexRules('foo', [legacy], false, 0)).toBe('foo');
    const cleared = { ...legacy, minDepth: null, maxDepth: null };
    expect(applyRegexRules('foo', [cleared], false, 0)).toBe('bar');
    expect(ruleToSTScript(cleared)).toMatchObject({ minDepth: null, maxDepth: null });
  });
  it('promotes imported bounds and exports edited bounds instead of stale raw values', () => {
    const imported = stScriptToRule({ scriptName: 'ST', findRegex: 'foo', replaceString: 'bar', placement: [2], minDepth: 2, maxDepth: 5 });
    expect(imported).toMatchObject({ minDepth: 2, maxDepth: 5 });
    const exported = ruleToSTScript({ ...imported, minDepth: null, maxDepth: 1 });
    expect(exported).toMatchObject({ minDepth: null, maxDepth: 1 });
    expect(applyRegexRules('foo', [stScriptToRule(exported)], false, 2)).toBe('foo');
  });
  it('uses the same range decisions in explanatory preview and actual processing', () => {
    const rules = [rule({ minDepth: 2 })];
    for (const depth of [undefined, 0, 1, 2, 4]) {
      const preview = previewRegexRules('foo', rules, false, depth);
      expect(preview.final).toBe(applyRegexRules('foo', rules, false, depth));
      expect(preview.effects[0].applied).toBe(depth !== undefined && depth >= 2);
    }
  });
  it.each([convertMessagesToTxt, convertMessagesToMarkdown])('exports selected messages at their original depth in the full conversation', convert => {
    expect(convert(messages.slice(1, 4), [rule({ maxDepth: 1 })], 'none', [], messages)).toBe('foo1\n\nfoo2\n\nbar3');
    expect(convert(messages, [rule({ minDepth: 2 })], 'none')).toBe('bar0\n\nbar1\n\nbar2\n\nfoo3\n\nfoo4');
  });
  it('keeps novel depth tied to full messages when user floors are hidden', () => {
    const doc = buildNovelDocument(messages, [], { userMode: 'hide', showHidden: false, sceneGapMinutes: 0, regexRules: [rule({ maxDepth: 1 })] });
    expect(doc.flatMap(chapter => chapter.blocks.map(block => block.text))).toEqual(['foo0', 'foo2', 'bar4']);
  });
});
