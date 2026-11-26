import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCatalog, checkSourceText } from './check.mjs';

test('rejects missing, renamed, added interpolation slots, or untranslated CJK in English values', () => {
  assert.equal(checkCatalog({ '删除 {{name}}': 'Delete {{name}}' }).length, 0);
  assert.equal(checkCatalog({ '{{char}} 对 {{user}}': '{{user}} meets {{char}}' }).length, 0);
  assert.equal(checkCatalog({ '删除 {{name}}': 'Delete' }).length, 1);
  assert.equal(checkCatalog({ '删除 {{name}}': 'Delete {{other}}' }).length, 1);
  assert.equal(checkCatalog({ '删除': '' }).length, 1);
  assert.equal(checkCatalog({ '提示': 'Still 中文 here' }).length, 1);
});

test('catches raw CJK JSX punctuation, raw Chinese tr() args, and module-scope locale freezes', () => {
  const catalog = { '保存': 'Save', '共 {{v0}} 项{{v1}}': 'Total {{v0}}{{v1}}', '备选 ({{v0}})': 'Alternates ({{v0}})' };
  assert.equal(checkSourceText('src/Foo.tsx', 'export const X = () => <span>{tr("保存")}</span>;', catalog).errors.length, 0);

  const punct = checkSourceText('src/Foo.tsx', 'export const X = () => <span>{tr("保存")}（3）</span>;', catalog);
  assert.ok(punct.errors.some(e => e.includes('raw CJK punctuation')));

  const rawArg = checkSourceText('src/Foo.tsx', 'export const X = () => <span>{tr("共 {{v0}} 项{{v1}}", { v0: 1, v1: "，失败 2 张" })}</span>;', catalog);
  assert.ok(rawArg.errors.some(e => e.includes('raw Chinese interpolation value')));

  const topTr = checkSourceText('src/Foo.ts', 'export const LABEL = tr("保存");', catalog);
  assert.ok(topTr.errors.some(e => e.includes('module-scope tr()')));

  const topGetter = checkSourceText('src/Foo.ts', 'export const DESC = EDITOR_TOOL_COPY.chat;', catalog);
  assert.ok(topGetter.errors.some(e => e.includes('module-scope getter read')));
});
