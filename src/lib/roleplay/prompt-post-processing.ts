/** Port of TauriTavern 9693a4e prompt_post_processing.rs (AGPL-3.0).
 * Keep this at the provider boundary so presets and Agent/cache see the same envelope.
 */
type Message = Record<string, unknown> & { role: string; content: unknown };
const MODES = new Set(['claude', 'merge', 'merge_tools', 'semi', 'semi_tools', 'strict', 'strict_tools', 'single']);
const PLACEHOLDER = "Let's get started.";
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const plain = (message: Message) => Object.keys(message).length === 2 && typeof message.content === 'string';

export function postProcessPrompt(messages: unknown[], mode: unknown, names: Record<string, unknown>): unknown[] {
  const selected = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
  if (!MODES.has(selected)) return messages;
  const tools = selected.endsWith('_tools');
  const strict = selected.startsWith('semi') || selected.startsWith('strict') || selected === 'single';
  const placeholders = selected.startsWith('strict');
  const single = selected === 'single';
  const user = String(names.user_name ?? '').trim(), character = String(names.char_name ?? '').trim();
  const groups = Array.isArray(names.group_names) ? names.group_names.filter((n): n is string => typeof n === 'string').map(n => n.trim()).filter(Boolean) : [];
  const prefix = (content: string, name: string, group = false) => !name || content.startsWith(`${name}: `)
    || group && groups.some(n => content.startsWith(`${n}: `)) ? content : `${name}: ${content}`;

  function merge(input: unknown[], enforce: boolean, toSingle: boolean): Message[] {
    const media = new Map<string, unknown>();
    function normalize(value: unknown): string {
      if (typeof value === 'string') return value;
      if (value == null) return '';
      if (!Array.isArray(value)) return JSON.stringify(value);
      return value.map(part => {
        if (typeof part === 'string') return part;
        if (!object(part)) return '';
        if (part.type === 'text') return typeof part.text === 'string' ? part.text : '';
        if (['image_url', 'video_url', 'audio_url'].includes(String(part.type))) {
          const token = `__STE_MEDIA_${crypto.randomUUID()}__`; media.set(token, part); return token;
        }
        return '';
      }).join('\n\n');
    }
    const normalized = input.filter(object).map(value => {
      const message = structuredClone(value);
      let role = String(message.role ?? 'user').trim().toLowerCase();
      let content = normalize(message.content);
      const name = typeof message.name === 'string' ? message.name.trim() : undefined;
      if (role === 'system' && name === 'example_assistant') content = prefix(content, character, true);
      else if (role === 'system' && name === 'example_user') content = prefix(content, user);
      else if (role !== 'system' && name !== undefined) content = prefix(content, name);
      if (role === 'tool' && !tools) role = 'user';
      if (toSingle) {
        if (role === 'assistant') content = prefix(content, character, true);
        else if (role === 'user') content = prefix(content, user);
        role = 'user';
      }
      delete message.name;
      if (!tools) { delete message.tool_calls; delete message.tool_call_id; }
      return { ...message, role, content } as Message;
    });
    const result: Message[] = [];
    for (const message of normalized) {
      const last = result.at(-1);
      if (last && plain(last) && plain(message) && message.role !== 'tool' && message.content && last.role === message.role) {
        last.content = `${last.content}\n\n${message.content}`;
      } else result.push(message);
    }
    if (!result.length) result.push({ role: 'user', content: PLACEHOLDER });
    for (const message of result) {
      const content = String(message.content);
      if (![...media.keys()].some(token => content.includes(token))) continue;
      const parts: Record<string, unknown>[] = [];
      for (const segment of content.split('\n\n')) {
        if (media.has(segment)) parts.push(media.get(segment) as Record<string, unknown>);
        else if (parts.at(-1)?.type === 'text') parts.at(-1)!.text += `\n\n${segment}`;
        else parts.push({ type: 'text', text: segment });
      }
      message.content = parts;
    }
    if (enforce) {
      result.forEach((message, index) => { if (index > 0 && message.role === 'system') message.role = 'user'; });
      if (placeholders) {
        if (result[0].role === 'system' && result[1]?.role !== 'user') result.splice(1, 0, { role: 'user', content: PLACEHOLDER });
        else if (!['system', 'user'].includes(result[0].role)) result.unshift({ role: 'user', content: PLACEHOLDER });
      }
      return merge(result, false, false);
    }
    return result;
  }
  return merge(messages, strict, single);
}
