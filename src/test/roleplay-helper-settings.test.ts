import { describe, expect, it } from 'vitest';
import { importHelperScripts, normalizeHelperSettings } from '@/lib/roleplay/helper-settings';

describe('bounded helper configuration', () => {
  it('imports real script and folder shapes without executing or retaining imported grants', () => {
    const scripts = importHelperScripts({ type: 'folder', name: '状态', scripts: [{ type: 'script', id: 'test', name: '好感度',
      content: 'replaceVariables({trust: 2});', enabled: true, grants: ['read', 'write', 'generate'], data: { stage: 1 },
      button: { enabled: true, buttons: [{ name: '查看', visible: true }] } }] });
    expect(scripts[0]).toMatchObject({ id: 'test', enabled: false, grants: [], data: { stage: 1 },
      button: { enabled: true, buttons: [{ name: '查看', visible: true }] } });
    expect(normalizeHelperSettings({ schema: 1, scripts, html: { enabled: false, grants: [] } }).scripts).toEqual(scripts);
  });

  it('requires supported capabilities and stable unique script identities', () => {
    const script = { id: 'test', type: 'script', name: 'test', content: '1', enabled: true, grants: ['native-files'] };
    expect(() => normalizeHelperSettings({ scripts: [script] })).toThrow(/权限/);
    expect(() => normalizeHelperSettings({ scripts: [{ ...script, grants: [] }, { ...script, grants: [] }] })).toThrow(/重复/);
    expect(() => importHelperScripts({ type: 'script', name: 'bad', content: 1 })).toThrow(/内容/);
  });

  it('bounds count and source size, keeps script data as inert JSON and disables HTML by default', () => {
    expect(normalizeHelperSettings({})).toMatchObject({ schema: 1, scripts: [], html: { enabled: false, grants: [] } });
    expect(() => importHelperScripts(Array.from({ length: 33 }, (_, i) => ({ type: 'script', id: String(i), name: 'test', content: '1' })))).toThrow(/32/);
    expect(() => importHelperScripts({ type: 'script', id: 'big', name: 'big', content: 'x'.repeat(512 * 1024 + 1) })).toThrow(/512/);
  });
});
