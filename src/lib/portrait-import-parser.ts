import { buildPortraitLinks, type PortraitLinkRules } from './portrait-cloud';
import { parsePortraitList, type PortraitParseResult } from './portrait-list-parser';
import { extractPortraitExample, type PortraitExampleRule } from './portrait-example-rule';

export type PortraitImportRequest = (PortraitLinkRules & { mode?: 'advanced' }) | { mode: 'auto'; source: string; host?: string; rule?: PortraitExampleRule };
export function processPortraitImport(request: PortraitImportRequest): PortraitParseResult {
  if (new TextEncoder().encode(request.source).byteLength > 512_000) throw new Error('输入超过 512 KB，请分批导入');
  if (request.mode !== 'auto') {
    return { items: buildPortraitLinks(request).map(link => ({ ...link,
      file: new URL(link.url).pathname.split('/').pop() ?? '', nameSource: 'explicit' })), failed: [], skipped: [] };
  }
  const lines = request.source.split(/\r?\n/);
  const adapted = request.rule ? lines.map(line => {
    try { const fields = extractPortraitExample(line, request.rule!); return fields.name ? `${fields.name}: ${fields.file}` : fields.file; }
    catch { return line; }
  }).join('\n') : request.source;
  const result = parsePortraitList(adapted, request.host);
  return { ...result, items: result.items.map(item => ({ ...item, raw: lines[item.line - 1] })),
    failed: result.failed.map(issue => ({ ...issue, text: lines[issue.line - 1] })) };
}
