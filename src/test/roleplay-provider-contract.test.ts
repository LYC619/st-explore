import { expect, it } from 'vitest';
import { prepareCompletion } from '@/lib/roleplay/provider';

const profile = { model: 'fixture', apiUrl: 'https://fixture.invalid/chat/completions', apiKey: '' };
const prepare = (extra: Record<string, unknown>) => prepareCompletion(profile, { messages: [{ role: 'user', content: 'Synthetic summary' }], ...extra }).body;

it('maps ST schema value and default strictness to the custom provider envelope', () => {
  const value = { type: 'object', properties: { summary: { type: 'string' } } };
  expect(prepare({ json_schema: { name: 'summary', value } }).response_format).toEqual({ type: 'json_schema', json_schema: { name: 'summary', strict: true, schema: value } });
  expect(prepare({ json_schema: { name: 'summary', strict: false, value } }).response_format).toMatchObject({ json_schema: { strict: false } });
});

it('converts numeric ST logprobs before custom YAML overrides', () => {
  expect(prepare({ logprobs: 5 })).toMatchObject({ logprobs: true, top_logprobs: 5 });
  expect(prepare({ logprobs: 5, custom_include_body: 'logprobs: false\ntop_logprobs: 2' })).toMatchObject({ logprobs: false, top_logprobs: 2 });
  expect(prepare({ logprobs: true, top_logprobs: 3 })).toMatchObject({ logprobs: true, top_logprobs: 3 });
});

it('applies exclusions last, including the generated response format', () => {
  expect(prepare({ json_schema: { name: 'summary', value: {} }, custom_exclude_body: '- response_format' })).not.toHaveProperty('response_format');
});
