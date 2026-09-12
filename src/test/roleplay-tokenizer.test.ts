import { describe, expect, it } from 'vitest';
import { tokenizeTavern } from '@/lib/roleplay/tokenizer';

describe('Tavern tokenizer boundary', () => {
  it('encodes known cl100k tokens and decodes Unicode and literal special-token text', () => {
    expect(tokenizeTavern('/api/tokenizers/openai/encode?model=gpt-4', { text: 'Hello world' }))
      .toMatchObject({ count: 2, ids: [9906, 1917] });
    const text = '雨夜，店门开了。<|endoftext|>';
    const encoded = tokenizeTavern('/api/tokenizers/openai/encode?model=gpt-4o', { text });
    expect(tokenizeTavern('/api/tokenizers/openai/decode?model=gpt-4o', { ids: encoded.ids }).text).toBe(text);
  });

  it('matches the upstream OpenAI message framing contract, including batch and names', () => {
    const message = { role: 'user', content: 'Hello world' };
    expect(tokenizeTavern('/api/tokenizers/openai/count?model=gpt-4', [message]).token_count).toBe(9);
    expect(tokenizeTavern('/api/tokenizers/openai/count-batch?model=gpt-4', [message, { ...message, name: 'Alice' }]).token_counts)
      .toEqual([9, 11]);
  });

  it('counts cumulative prefixes and fills the remaining results once ST’s text threshold is reached', () => {
    const result = tokenizeTavern('/api/tokenizers/openai/count-prefix-batch?model=gpt-4', {
      base: 'Hello', suffixes: [' world', ' again', '!'], stop_at: 8,
    });
    expect(result.token_counts).toEqual([9, 9, 9]);
  });

  it('labels the fallback as an estimate and rejects unsupported tokenizer routes', () => {
    expect(tokenizeTavern('/api/tokenizers/openai/count?model=custom-model', [{ role: 'user', content: 'hello' }]))
      .toMatchObject({ estimated: true, encoding: 'o200k_base' });
    expect(() => tokenizeTavern('/api/tokenizers/llama/encode', { text: 'hello' })).toThrow('分词器');
    expect(() => tokenizeTavern('/api/tokenizers/openai/decode', { ids: [-1] })).toThrow();
  });
});
