import { describe, expect, it, vi } from 'vitest';
import { applyMvuPatch, buildStatusPreview, mergeBeautifySettings, DEFAULT_BEAUTIFY } from '@/lib/beautify';
import { normalizeHelperSettings } from '@/lib/roleplay/helper-settings';

describe('beautification templates', () => {
  it('applies MVU JSON Patch atomically without modifying the original', () => {
    const data = { trust: 3, bag: ['a'], nested: { health: 10 } };
    expect(applyMvuPatch(data, [{ op: 'replace', path: '/trust', value: 6 },
      { op: 'add', path: '/bag/-', value: 'b' }, { op: 'remove', path: '/nested/health' }]))
      .toEqual({ trust: 6, bag: ['a', 'b'], nested: {} });
    expect(data.trust).toBe(3);
    expect(() => applyMvuPatch(data, [{ op: 'replace', path: '/trust', value: 9 }, { op: 'replace', path: '/missing', value: 1 }])).toThrow();
    expect(data.trust).toBe(3);
  });
  it('rejects prototype paths and unsupported operations rather than executing source strings', () => {
    expect(() => applyMvuPatch({}, [{ op: 'add', path: '/__proto__/bad', value: 1 }])).toThrow();
    expect(() => applyMvuPatch({}, [{ op: 'eval', path: '/', value: 'alert(1)' }])).toThrow();
    expect(({} as Record<string, unknown>).bad).toBeUndefined();
  });
  it('renders user values and titles as inert text in the preview', () => {
    const html = buildStatusPreview({ ...DEFAULT_BEAUTIFY, title: '<script>oops</script>', fields: [{ label: '<img>', path: 'name' }] }, { name: '<svg onload=alert(1)>' });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<svg');
    expect(html).toContain('&lt;svg');
  });
  it('updates only its own scripts and preserves existing script settings', () => {
    const existing = normalizeHelperSettings({ scripts: [{ type: 'script', id: 'user', name: '原有脚本', content: '1', enabled: true, grants: ['read'], data: { keep: 1 } }] });
    const changed = mergeBeautifySettings(existing, { ...DEFAULT_BEAUTIFY, statusEnabled: true, mvuEnabled: true });
    expect(changed.scripts[0]).toEqual(existing.scripts[0]);
    expect(changed.scripts.find(s => s.id === 'ste-beautify-status')).toMatchObject({ enabled: true, grants: ['read'], data: { ste_widget: { mode: 'inline' } } });
    expect(changed.scripts.find(s => s.id === 'ste-beautify-mvu')).toMatchObject({ enabled: true, grants: ['read', 'write'] });
    expect(mergeBeautifySettings(changed, DEFAULT_BEAUTIFY).scripts).toHaveLength(3);
  });
  it('runs generated MVU source and does not reapply a patch to the same candidate', async () => {
    const settings = mergeBeautifySettings(normalizeHelperSettings({}), { ...DEFAULT_BEAUTIFY, mvuEnabled: true });
    const source = settings.scripts.find(s => s.id === 'ste-beautify-mvu')!.content;
    const latest = { message_id: 1, role: 'assistant', message: '<JSONPatch>[{"op":"replace","path":"/trust","value":9}]</JSONPatch>', data: {} };
    const messages = [{ message_id: 0, role: 'assistant', data: { stat_data: { trust: 3 } } }, latest];
    let current: Record<string, unknown> = {};
    const write = vi.fn((value: Record<string, unknown>) => { current = value; });
    const listeners = new Map<string, () => Promise<void>>();
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    await new AsyncFunction('getChatMessages', 'getVariables', 'replaceVariables', 'flushHelperWrites', 'eventOn', 'tavern_events', source)(
      () => structuredClone(messages), () => structuredClone(current), write, async () => {},
      (event: string, listener: () => Promise<void>) => listeners.set(event, listener), { GENERATION_ENDED: 'ended', MESSAGE_SWIPED: 'swiped' },
    );
    expect(current.stat_data).toEqual({ trust: 9 });
    expect(write).toHaveBeenCalledTimes(1);
    await listeners.get('ended')!();
    expect(write).toHaveBeenCalledTimes(1);
    latest.message = '<JSONPatch>[{"op":"replace","path":"/trust","value":4}]</JSONPatch>';
    await listeners.get('swiped')!();
    expect(current.stat_data).toEqual({ trust: 4 });
  });
});
