import { describe, expect, it } from 'vitest';
import { loadSettingsSection, saveSettingsSection } from '@/lib/settings-navigation';

describe('settings navigation', () => {
  it('defaults invalid or unset values to ai and restores a saved section', () => {
    localStorage.clear();
    expect(loadSettingsSection()).toBe('ai');

    localStorage.setItem('ste-settings-section', 'invalid');
    expect(loadSettingsSection()).toBe('ai');

    saveSettingsSection('data');
    expect(loadSettingsSection()).toBe('data');
  });
});
