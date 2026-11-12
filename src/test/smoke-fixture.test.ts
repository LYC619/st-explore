import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('route asset smoke fixture', () => {
  it('covers the route shell and each asset entry point', () => {
    const fixture = JSON.parse(readFileSync(
      resolve(process.cwd(), 'scripts/smoke/fixtures/route-assets.json'),
      'utf8',
    )) as { rootMarker: string; routes: string[] };

    expect(fixture.rootMarker).toBe('id="root"');
    expect(new Set(fixture.routes).size).toBe(fixture.routes.length);
    expect(fixture.routes).toEqual(expect.arrayContaining([
      '/',
      '/library',
      '/presets',
      '/presets?mode=select',
      '/tools',
      '/chat',
      '/assets',
      '/assets?tab=worldbook',
      '/assets?tab=preset',
      '/assets?tab=regex',
      '/settings',
    ]));
  });
});
