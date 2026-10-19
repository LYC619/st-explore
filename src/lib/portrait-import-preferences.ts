import type { ArchiveCharacter, PortraitRow } from '@/types/archive';
import type { PortraitExampleRule } from './portrait-example-rule';
import type { PortraitParseResult } from './portrait-list-parser';
import { hasPortraitSource, portraitImportSource } from './portrait-import-identity';
import { digest } from './roleplay/fingerprint';
export interface PortraitImportPreferences { version: 1; mode: 'auto' | 'advanced'; host: string; pattern: string; template: string; encode: boolean; rule?: PortraitExampleRule }
const STORAGE_KEY = 'ste.portrait-import.preferences';
export function loadPortraitImportPreferences(): PortraitImportPreferences | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (value?.version !== 1 || !['auto', 'advanced'].includes(value.mode) || typeof value.host !== 'string' || typeof value.pattern !== 'string' || typeof value.template !== 'string') return null;
    return { version: 1, mode: value.mode, host: value.host, pattern: value.pattern, template: value.template, encode: value.encode !== false,
      ...(value.rule?.version === 1 ? { rule: value.rule } : {}) };
  } catch { return null; }
}
export function savePortraitImportPreferences(value: PortraitImportPreferences): void {
  const { version, mode, host, pattern, template, encode, rule } = value;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version, mode, host, pattern, template, encode, rule })); } catch { /* Optional local preferences. */ }
}
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s_\-·]+/g, '');
export function recommendPortraitRow(name: string, rows: PortraitRow[]): string | null {
  const value = normalize(name), matches = rows.filter(row => normalize(row.title) && value.startsWith(normalize(row.title)))
    .sort((a, b) => normalize(b.title).length - normalize(a.title).length);
  if (!matches[0] || (matches[1] && normalize(matches[0].title).length === normalize(matches[1].title).length)) return null;
  return matches[0].id;
}
export interface PortraitPreviewRow {
  id: string; line: number; raw: string; name: string; input: string; url?: string; rowId: string | null;
  selected: boolean; issue?: string; alreadySaved?: boolean; force?: boolean; manualName?: boolean; manualRow?: boolean; manualUrl?: boolean;
}
export function buildPortraitPreview(result: PortraitParseResult, previous: PortraitPreviewRow[], character: ArchiveCharacter): PortraitPreviewRow[] {
  const old = new Map(previous.map(row => [row.id, row])), occurrences = new Map<string, number>();
  const lines = [...result.items.map(item => ({ ...item, issue: undefined as string | undefined })), ...result.failed.map(issue => ({ line: issue.line, raw: issue.text, name: '', url: '', issue: issue.reason }))].sort((a, b) => a.line - b.line);
  return lines.map(item => {
    // Lookahead captures may change the parsed URL without changing match[0].
    const identity = `${item.raw}\n${item.url}`;
    const occurrence = occurrences.get(identity) ?? 0; occurrences.set(identity, occurrence + 1);
    const id = digest(`${identity}\n${occurrence}`), prior = old.get(id);
    const url = prior?.manualUrl ? prior.url : item.url || undefined;
    let alreadySaved = false; try { alreadySaved = !!url && hasPortraitSource(character, portraitImportSource(url)); } catch { /* Invalid rows stay editable. */ }
    const name = prior?.manualName ? prior.name : item.name;
    const issue = (prior?.manualUrl ? prior.issue : item.issue) || (url && !name.trim() ? '名称不能为空' : undefined);
    return { id, line: item.line, raw: item.raw, name, input: prior?.manualUrl ? prior.input : item.url, url,
      rowId: prior?.manualRow ? prior.rowId : recommendPortraitRow(name, character.portraitRows ?? []),
      issue, manualName: prior?.manualName, manualRow: prior?.manualRow, manualUrl: prior?.manualUrl,
      alreadySaved, force: prior?.force, selected: !!url && !issue && !(alreadySaved && !prior?.force)
        && (prior?.url && !prior.issue ? prior.selected : true) };
  });
}
