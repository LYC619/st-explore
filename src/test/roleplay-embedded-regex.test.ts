import { afterEach, expect, it } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { getCurrentRepo } from '@/lib/repo';
import { buildCharacterFromCard } from '@/lib/archive-db';
import { stScriptToRule } from '@/lib/st-regex-interop';
import { embeddedRegexState, withoutEmbeddedRegex } from '@/lib/roleplay/embedded-regex';
import type { RegexCollectionItem } from '@/types/regex';

afterEach(() => setActiveVault(null));

it('matches one no-ID original with normalized ST defaults while preserving an independent equal script', async () => {
  setActiveVault(createVault(createMemFs()));
  const source = { scriptName: '规则', findRegex: '/x/g', replaceString: '', placement: [2] };
  const independent = { ...source, id: 'independent' };
  const character = buildCharacterFromCard({ spec: 'chara_card_v2', data: { name: '角色', extensions: { regex_scripts: [source, independent] } } });
  character.assets = [{ kind: 'regex', assetId: 'embedded', relations: ['embedded'] }];
  const regexes = getCurrentRepo<RegexCollectionItem>('regexes');
  await regexes.put({ id: 'embedded', title: '内嵌正则', createdAt: 1, updatedAt: 1,
    rules: [stScriptToRule({ ...source, id: 'asset-rule' })] });
  const state = await embeddedRegexState(character, regexes);
  expect(state.suppressedEmbeddedScripts).toEqual([source]);
  expect(withoutEmbeddedRegex([{ ...source, id: 'upstream-assigned' }, independent], state)).toEqual([independent]);
});
