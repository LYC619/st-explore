import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseJsonl } from '@/lib/adapters/st/chat-jsonl';
import { streamPresetPlayground } from '@/lib/preset-playground-stream';
import { createLLMClient, geminiAdapter } from '@/lib/llm';
import { createDiagnosticReporter, diagnosticForError, safeErrorTag, sanitizeDiagnostic } from '@/lib/diagnostics';

function listProductionSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'test' || entry === '__tests__') continue;
      results.push(...listProductionSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

const srcRoot = resolve(process.cwd(), 'src');
const productionFiles = listProductionSourceFiles(srcRoot);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('privacy redline static source audit', () => {
  it('verifies no reportDiagnostic call passes forbidden prose, card, or credential keys', () => {
    const forbiddenKeyPattern = /\b(?:message|body|content|prompt|apiKey|authorization|headers|rawText|chat|card|secret|password|token)\s*:/i;
    const violations: string[] = [];
    for (const file of productionFiles) {
      const text = readFileSync(file, 'utf8');
      const matches = text.matchAll(/reportDiagnostic\s*\(([\s\S]*?)\)/g);
      for (const match of matches) {
        if (forbiddenKeyPattern.test(match[1])) {
          violations.push(`${relative(srcRoot, file)}: ${match[0].slice(0, 120)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('verifies no production console.* call dumps raw chat lines, prose, or credentials', () => {
    const unsafeConsoleArgPattern = /\b(?:line|apiKey|authorization|messages|rawText|card\.data)\b/i;
    const violations: string[] = [];
    for (const file of productionFiles) {
      const text = readFileSync(file, 'utf8');
      const lines = text.split(/\r?\n/);
      lines.forEach((sourceLine, index) => {
        const match = /console\.(?:log|warn|error|info|debug)\s*\(([^)]*)\)/.exec(sourceLine);
        if (!match) return;
        // Strip quoted string literals so static messages like 'JSONL line' don't false-positive,
        // while identifiers/interpolations like `, line)` or `${apiKey}` are strictly caught.
        const argsWithoutLiterals = match[1]
          .replace(/'(?:\\.|[^'\\])*'/g, "''")
          .replace(/"(?:\\.|[^"\\])*"/g, '""');
        if (unsafeConsoleArgPattern.test(argsWithoutLiterals)) {
          violations.push(`${relative(srcRoot, file)}:${index + 1}: ${sourceLine.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('verifies no production throw new Error echoes API keys or raw remote provider error bodies', () => {
    const unsafeThrowPattern = /throw\s+new\s+Error\s*\([^)]*(?:apiKey|authorization|x-api-key|x-goog-api-key|body\?\.error\?\.message)/i;
    const violations: string[] = [];
    for (const file of productionFiles) {
      const text = readFileSync(file, 'utf8');
      const lines = text.split(/\r?\n/);
      lines.forEach((sourceLine, index) => {
        if (unsafeThrowPattern.test(sourceLine)) {
          violations.push(`${relative(srcRoot, file)}:${index + 1}: ${sourceLine.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('verifies Gemini adapter never places API keys in request URLs', () => {
    const req = geminiAdapter.buildRequest({
      config: {
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models?key=leaked-query-secret',
        apiKey: 'AIza-private-synthetic-key',
        model: 'gemini-2.5-flash',
      },
      messages: [{ role: 'user', content: 'PRIVATE_PROSE_CANARY' }],
      stream: true,
    });
    expect(req.url).not.toContain('leaked-query-secret');
    expect(req.url).not.toContain('AIza-private-synthetic-key');
    expect(req.url).not.toContain('key=');
    expect(req.headers['x-goog-api-key']).toBe('AIza-private-synthetic-key');
  });
});

describe('privacy redline runtime regression checks', () => {
  it('never logs raw malformed JSONL chat content to console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const canary = 'PRIVATE_CHAT_CANARY_SHOULD_NEVER_LOG';
    const result = parseJsonl(`{"user_name":"U","character_name":"C"}\n{broken ${canary}`);
    expect(result.diagnostics.invalidLines).toBe(1);
    const logged = warn.mock.calls.flat().map(String).join(' ');
    expect(logged).not.toContain(canary);
  });

  it('never repeats remote error bodies or secrets in streamPresetPlayground failures', async () => {
    const secret = 'sk-SYNTHETIC-PLAYGROUND-SECRET';
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: `Invalid key ${secret} with PRIVATE_CARD_TEXT` } }), { status: 401 }),
    ));
    let thrown: unknown;
    try {
      await streamPresetPlayground(
        { apiUrl: 'https://synthetic.invalid/v1/chat/completions', apiKey: secret, model: 'test' },
        { messages: [{ role: 'user', content: 'PRIVATE_CARD_TEXT' }] },
        new AbortController().signal,
        () => {},
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('HTTP 401');
    expect(message).not.toContain(secret);
    expect(message).not.toContain('PRIVATE_CARD_TEXT');
  });

  it('keeps API keys and private text out of LLMError messages, serialized errors, and diagnostics across all protocols', async () => {
    const secret = 'sk-SYNTHETIC-MULTI-SECRET';
    const privateProse = 'PRIVATE_STORY_SECRET_LINE';
    const endpoints = [
      { apiUrl: 'https://api.openai.com/v1/chat/completions', apiKey: secret, model: 'gpt-4o-mini' },
      { apiUrl: 'https://api.anthropic.com/v1/messages', apiKey: secret, model: 'claude-sonnet-4-5' },
      { apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models', apiKey: secret, model: 'gemini-2.5-flash' },
    ];
    for (const cfg of endpoints) {
      const client = createLLMClient({
        transport: async () => new Response(JSON.stringify({ error: { message: `${secret} ${privateProse}` } }), { status: 401 }),
      });
      let caught: unknown;
      try {
        await client.complete(cfg, [{ role: 'user', content: privateProse }]);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      const serialized = `${(caught as Error).message} ${JSON.stringify(caught)}`;
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain(privateProse);
    }

    const emitted: unknown[] = [];
    const reporter = createDiagnosticReporter(event => { emitted.push(event); });
    const parseErr = new SyntaxError(`Unexpected token "${privateProse}" near ${secret}`);
    expect(safeErrorTag(parseErr)).toBe('SyntaxError');
    reporter.report(diagnosticForError(parseErr, 'parse', `C:/vault/${privateProse}.json`));
    reporter.report(sanitizeDiagnostic({ event: 'model', operation: 'request', host: secret, model: privateProse, category: 'permission' }));
    const dumped = JSON.stringify(emitted);
    expect(dumped).not.toContain(secret);
    expect(dumped).not.toContain(privateProse);
  });
});
