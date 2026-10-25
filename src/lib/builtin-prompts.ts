import { BUILTIN_PROMPTS } from './builtin-prompt-defaults';

export { BUILTIN_PROMPTS } from './builtin-prompt-defaults';
export const BUILTIN_PROMPT_CHANGE = 'ste-builtin-prompt-change';
const PREFIX = 'ste-builtin-prompt:';

function definition(id: string) {
  const result = BUILTIN_PROMPTS.find(prompt => prompt.id === id);
  if (!result) throw new Error(`未知内置提示词：${id}`);
  return result;
}

export function getBuiltinPromptDefault(id: string): string {
  return definition(id).content;
}

export function validateBuiltinPrompt(id: string, content: string): string | null {
  const prompt = definition(id);
  if (!content.trim()) return '提示词不能为空；如需撤销修改，请恢复默认。';
  const missing = prompt.required?.filter(token => !content.includes(token)) ?? [];
  return missing.length ? `请保留必要变量或输出字段：${missing.join('、')}` : null;
}

/** App-level preferences, shared across vaults, like the pre-existing worldbook/tree editors. */
export function getBuiltinPrompt(id: string): string {
  const prompt = definition(id);
  try {
    // Reuse legacy slots, avoiding copies that could later diverge or resurrect after reset.
    const saved = localStorage.getItem(prompt.legacyKey ?? PREFIX + id);
    return saved?.trim() ? saved : prompt.content;
  } catch {
    return prompt.content;
  }
}

/** Throws on storage failure, so the UI never reports a successful save that was not persisted. */
export function saveBuiltinPrompt(id: string, content: string): void {
  const error = validateBuiltinPrompt(id, content);
  if (error) throw new Error(error);
  const prompt = definition(id);
  const key = prompt.legacyKey ?? PREFIX + id;
  if (content === prompt.content) localStorage.removeItem(key);
  else localStorage.setItem(key, content);
  window.dispatchEvent(new Event(BUILTIN_PROMPT_CHANGE));
}

export function resetBuiltinPrompt(id: string): void {
  const prompt = definition(id);
  localStorage.removeItem(prompt.legacyKey ?? PREFIX + id);
  window.dispatchEvent(new Event(BUILTIN_PROMPT_CHANGE));
}

/** One pass: source text containing macros is data and must never be expanded recursively. */
export function formatBuiltinPrompt(id: string, values: Record<string, string | number>): string {
  return getBuiltinPrompt(id).replace(/\{\{([a-zA-Z][\w]*)\}\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : token);
}
