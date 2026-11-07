import * as cl100k from 'gpt-tokenizer/encoding/cl100k_base';
import * as o200k from 'gpt-tokenizer/encoding/o200k_base';
import { subscribeActiveVault } from '@/lib/vault/active';
import { createTokenCountCache } from './token-count-cache';

const classicCounts = createTokenCountCache(text => cl100k.encode(text, { disallowedSpecial: new Set() }).length);
const modernCounts = createTokenCountCache(text => o200k.encode(text, { disallowedSpecial: new Set() }).length);
subscribeActiveVault(() => { classicCounts.clear(); modernCounts.clear(); });

type ObjectValue = Record<string, unknown>;
const asObject = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const textValue = (value: unknown): string => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);

/** Local budgeting only. This is never used as provider usage or a cache-hit measurement. */
export function tokenizeTavern(path: string, value: unknown): Record<string, unknown> {
  const url = new URL(path, 'https://ste.local');
  if (!url.pathname.startsWith('/api/tokenizers/openai/')) throw new Error('此分词器尚未接入');
  const model = url.searchParams.get('model') ?? '';
  const classic = /^gpt-(?:3\.5|4(?:-|$))/.test(model) && !/^gpt-4(?:o|\.1)/.test(model);
  const codec = classic ? cl100k : o200k;
  const counts = classic ? classicCounts : modernCounts;
  const encode = (text: string) => codec.encode(text, { disallowedSpecial: new Set() });
  const body = asObject(value);
  const metadata = { estimated: true, encoding: classic ? 'cl100k_base' : 'o200k_base' };
  const legacy = model === 'gpt-3.5-turbo-0301';
  function count(messages: unknown[]) {
    let total = legacy ? 12 : 3;
    for (const message of messages) {
      total += legacy ? 4 : 3;
      if (message && typeof message === 'object' && !Array.isArray(message)) {
        for (const [key, field] of Object.entries(message)) {
          total += counts.count(textValue(field));
          if (key === 'name') total += legacy ? -1 : 1;
        }
      } else total += counts.count(textValue(message));
    }
    return total;
  }
  switch (url.pathname.split('/').at(-1)) {
    case 'encode': {
      if (typeof body.text !== 'string') throw new Error('分词文本无效');
      const ids = encode(body.text);
      return { ...metadata, count: ids.length, ids, chunks: ids.map(id => codec.decode([id])) };
    }
    case 'decode': {
      if (!Array.isArray(body.ids) || body.ids.some(id => !Number.isSafeInteger(id) || id < 0)) throw new Error('分词 ID 无效');
      return { ...metadata, text: codec.decode(body.ids), chunks: body.ids.map(id => codec.decode([id])) };
    }
    case 'count':
      if (!Array.isArray(value)) throw new Error('分词消息无效');
      return { ...metadata, token_count: count(value) };
    case 'count-batch':
      if (!Array.isArray(value)) throw new Error('分词消息无效');
      return { ...metadata, token_counts: value.map(message => count([message])) };
    case 'count-prefix-batch': {
      if (typeof body.base !== 'string' || !Array.isArray(body.suffixes) || body.suffixes.some(s => typeof s !== 'string')) throw new Error('分词前缀无效');
      let prefix = body.base;
      let stopped: number | undefined;
      return { ...metadata, token_counts: body.suffixes.map(suffix => {
        if (stopped !== undefined) return stopped;
        prefix += suffix;
        const tokens = count([{ role: 'system', content: prefix }]);
        if (typeof body.stop_at === 'number' && tokens - 1 >= body.stop_at) stopped = tokens;
        return tokens;
      }) };
    }
    default: throw new Error('此分词器接口尚未接入');
  }
}
