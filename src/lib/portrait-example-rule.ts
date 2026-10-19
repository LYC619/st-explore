export interface PortraitExampleField { left: string; right: string }
export interface PortraitExampleRule { version: 1; name?: PortraitExampleField; file: PortraitExampleField }
export interface PortraitExampleSpan { start: number; end: number }

export function buildPortraitExampleRule(sample: string, name: PortraitExampleSpan | null, file: PortraitExampleSpan): PortraitExampleRule {
  if (sample.length > 8192) throw new Error('示例行过长');
  const fields = [{ kind: 'file' as const, ...file }, ...(name ? [{ kind: 'name' as const, ...name }] : [])].sort((a, b) => a.start - b.start);
  for (const field of fields) if (!Number.isSafeInteger(field.start) || !Number.isSafeInteger(field.end) || field.start < 0 || field.end <= field.start || field.end > sample.length) throw new Error('请选择有效片段');
  if (fields.length === 2 && fields[0].end > fields[1].start) throw new Error('名称和文件片段不能重叠');
  const result: PortraitExampleRule = { version: 1, file: { left: '', right: '' } };
  fields.forEach((field, index) => {
    result[field.kind] = { left: sample.slice(index ? fields[index - 1].end : 0, field.start),
      right: sample.slice(field.end, index + 1 < fields.length ? fields[index + 1].start : sample.length) };
  });
  // A single sample must at least reproduce its own fields without ambiguous delimiters.
  extractPortraitExample(sample, result); return result;
}

function extract(text: string, field: PortraitExampleField): string {
  let start = 0;
  if (field.left) {
    const found = text.indexOf(field.left); if (found < 0 || text.indexOf(field.left, found + 1) >= 0) throw new Error('左分隔符缺失或有歧义');
    start = found + field.left.length;
  }
  let end = text.length;
  if (field.right) {
    end = text.indexOf(field.right, start); if (end < 0 || text.indexOf(field.right, end + 1) >= 0) throw new Error('右分隔符缺失或有歧义');
  }
  const value = text.slice(start, end).trim(); if (!value) throw new Error('片段为空'); return value;
}

export function extractPortraitExample(text: string, rule: PortraitExampleRule): { name?: string; file: string } {
  if (text.length > 8192) throw new Error('示例行过长');
  if (rule.version !== 1 || !rule.file || rule.file.left.length > 8192 || rule.file.right.length > 8192) throw new Error('不支持的示例规则');
  return { ...(rule.name ? { name: extract(text, rule.name) } : {}), file: extract(text, rule.file) };
}
