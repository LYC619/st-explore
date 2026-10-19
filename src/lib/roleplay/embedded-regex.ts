import type { ArchiveCharacter } from '@/types/archive';
import type { RegexCollectionItem } from '@/types/regex';
import type { Repo } from '@/lib/repo';
import { normalizeCharacterCard } from '@/lib/png-parser';
import { embeddedContentHash } from '@/lib/card-embedded-assets';
import { parseSTRegexImport, ruleToSTScript, type STRegexScript } from '@/lib/st-regex-interop';
import { stableJson } from './fingerprint';

function contentHash(scripts: STRegexScript[]) {
  // Import stores a JSON clone, which omits undefined optional fields.
  const rules: ReturnType<typeof parseSTRegexImport> = JSON.parse(JSON.stringify(parseSTRegexImport(scripts)));
  return embeddedContentHash(rules.map(({ id: _id, ...rule }) => rule));
}

function scriptContent(script: STRegexScript) {
  const { id: _id, ...normalized } = ruleToSTScript(parseSTRegexImport([script])[0]);
  return stableJson(normalized);
}

export async function embeddedRegexState(character: ArchiveCharacter | undefined, regexes: Repo<RegexCollectionItem>) {
  const refs = (character?.assets ?? []).filter(ref => ref.kind === 'regex');
  const items = await Promise.all(refs.map(ref => regexes.get(ref.assetId)));
  const embedded = items.filter((item, index) => item && (refs[index].relations?.includes('embedded')
    || item.embedded?.characterId === character?.id)) as RegexCollectionItem[];
  const linked = embedded.flatMap(item => item.rules.map(ruleToSTScript));
  const ids = new Set(linked.map(script => script.id));
  const original = character ? normalizeCharacterCard(character.card).extensions?.regex_scripts : undefined;
  const scripts: STRegexScript[] = Array.isArray(original) ? original.filter(item => item && typeof item === 'object') : [];
  const originalHash = contentHash(scripts);
  const importedWhole = embedded.some(item => item.embedded?.contentHash === originalHash);
  const counts = new Map<string, number>();
  for (const script of linked) {
    const key = scriptContent(script); counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const suppressedEmbeddedScripts = scripts.filter(script => {
    if (importedWhole || script.id && ids.has(script.id)) return true;
    if (script.id) return false;
    const key = scriptContent(script), count = counts.get(key) ?? 0;
    if (!count) return false;
    counts.set(key, count - 1); return true;
  });
  return { linked, suppressedEmbeddedIds: [...ids], suppressedEmbeddedScripts };
}

/** Remove only identified source counterparts, consuming no-ID copies once. */
export function withoutEmbeddedRegex(scripts: STRegexScript[], state: Awaited<ReturnType<typeof embeddedRegexState>>) {
  const pending = [...state.suppressedEmbeddedScripts];
  const signature = ({ id: _id, ...script }: STRegexScript) => stableJson(script);
  return scripts.filter(script => {
    const index = pending.findIndex(source => source.id ? source.id === script.id : signature(source) === signature(script));
    if (index >= 0) { pending.splice(index, 1); return false; }
    return !state.suppressedEmbeddedIds.includes(script.id);
  });
}
