import { describe, expect, it } from 'vitest';
import { db, expectContent, go, kinds, mount, setupNavigation } from './asset-navigation-test-support';

setupNavigation();
describe.each(kinds)('%s query regression', (kind) => {
  it('loads a new identity on the existing route', async () => {
    await mount(kind);
    await expectContent(kind, 'A');
    await go('?assetId=B&view=list');
    expect(db[kind].get).toHaveBeenCalledWith('B');
    await expectContent(kind, 'B');
  });
});
