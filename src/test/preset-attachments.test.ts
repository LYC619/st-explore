import { expect, it } from 'vitest';
import { embedPresetAttachment } from '@/lib/preset-attachments';
import { classifyPresetAttachment } from '@/lib/preset-package';
import { exportPreset, parsePreset } from '@/lib/preset-parser';

const base = () => parsePreset({ prompts: [], prompt_order: [], extensions: { keep: { unknown: true } } });
const regex = { id: 'r', scriptName: 'cleanup', findRegex: 'a', replaceString: 'b', placement: [2], future: { keep: true } };
const script = { type: 'script', id: 's', name: 'helper', content: 'throw new Error("never execute")', enabled: true, future: ['keep'] };
const folder = { type: 'folder', id: 'folder', name: 'author folder', folded: true, scripts: [script], future: 42 };

it.each([regex, [regex], { scripts: [regex] }, { regex_scripts: [regex] }, { extensions: { regex_scripts: [regex] } }])('embeds common regex exports idempotently and keeps original attachment data', value => {
  const before = base(), file = { id: 'file', kind: 'regex' as const, name: 'regex.json', text: JSON.stringify(value) };
  expect(classifyPresetAttachment(file.name, file.text)).toBe('regex');
  const embedded = embedPresetAttachment(before, file);
  expect(() => embedPresetAttachment(embedded, file)).not.toThrow();
  const out = JSON.parse(exportPreset(embedPresetAttachment(embedded, file)));
  expect(out.extensions.regex_scripts).toHaveLength(1);
  expect(out.extensions.regex_scripts[0]).toMatchObject(regex);
  expect(out.extensions.keep).toEqual({ unknown: true });
  expect(before).toEqual(base());
  expect(JSON.parse(file.text)).toEqual(value);
});

it.each([script, [script], folder, { scripts: [folder] }, { tavern_helper: { scripts: [folder] } }, { extensions: { tavern_helper: { scripts: [folder] } } }])('embeds common helper exports and preserves folders and unknown fields', value => {
  const file = { id: 'file', kind: 'script' as const, name: 'helper.json', text: JSON.stringify(value) };
  expect(classifyPresetAttachment(file.name, file.text)).toBe('script');
  const embedded = embedPresetAttachment(base(), file);
  const out = JSON.parse(exportPreset(embedPresetAttachment(embedded, file)));
  expect(out.extensions.tavern_helper.scripts).toEqual([value === script || Array.isArray(value) ? script : folder]);
});

it('rejects conflicting IDs inside existing script folders and preserves unsafe extension shapes', () => {
  const embedded = embedPresetAttachment(base(), { id: 'f', kind: 'script', name: 'folder.json', text: JSON.stringify(folder) });
  const before = structuredClone(embedded);
  expect(() => embedPresetAttachment(embedded, { id: 's', kind: 'script', name: 'conflict.json', text: JSON.stringify({ ...script, content: 'different' }) })).toThrow('ID 冲突');
  expect(embedded).toEqual(before);
  const unusual = parsePreset({ prompts: [], prompt_order: [], extensions: { tavern_helper: ['must retain'] } });
  expect(() => embedPresetAttachment(unusual, { id: 's', kind: 'script', name: 'script.json', text: JSON.stringify(script) })).toThrow('格式');
  expect(unusual.originalData.extensions).toEqual({ tavern_helper: ['must retain'] });
});

it('wraps raw JavaScript as disabled data without running it', () => {
  const embedded = embedPresetAttachment(base(), { id: 's', kind: 'script', name: 'script.mjs', text: 'throw new Error("never execute")' });
  expect(JSON.parse(exportPreset(embedded)).extensions.tavern_helper.scripts).toMatchObject([{ type: 'script', name: 'script', enabled: false, content: 'throw new Error("never execute")' }]);
});
