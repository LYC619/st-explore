import type { NormalizedPreset, PromptBlock } from '@/types/preset';
import { DEFAULT_CHARACTER_ID } from '@/types/preset';
import type { WorldBook, WorldBookEntry } from '@/types/worldbook';
import type { STCharacterCard } from '@/lib/png-parser';
import { normalizeCharacterCard } from '@/lib/png-parser';
import type { ChatCompletionMessage } from '@/components/ai-tools/useOpenAI';
import { estimateTokens, getActiveOrder, substituteVars } from './preset-parser';
import { collectWorldbookEntries, insertAtDepth } from './summary-engine';
import { inspectPresetScripts } from './preset-catalog';

export type PlaygroundWorldMode = 'keywords' | 'constant' | 'all';
export interface PlaygroundInput {
  preset: NormalizedPreset;
  messages: ChatCompletionMessage[];
  character?: STCharacterCard;
  worldbook?: WorldBook;
  worldMode?: PlaygroundWorldMode;
  userName?: string;
  persona?: string;
}
const text = (value: unknown) => typeof value === 'string' ? value : '';
const role = (value: unknown): ChatCompletionMessage['role'] => value === 'user' || value === 1 ? 'user' : value === 'assistant' || value === 2 ? 'assistant' : 'system';

function keywordMatches(key: string, corpus: string, entry: WorldBookEntry): boolean {
  if (!key.trim()) return false;
  const flags = entry.caseSensitive ? 'u' : 'iu';
  if (key.startsWith('/') && key.lastIndexOf('/') > 0) {
    const end = key.lastIndexOf('/');
    try { return new RegExp(key.slice(1, end), key.slice(end + 1).replace(/[gy]/g, '')).test(corpus); } catch { return false; }
  }
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(entry.matchWholeWords ? `(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])` : escaped, flags).test(corpus);
}

/** One scan of explicit temporary messages; recursive, vector and timed activation belong to the full ST runtime. */
export function selectPlaygroundWorldEntries(worldbook: WorldBook, messages: ChatCompletionMessage[], mode: PlaygroundWorldMode): WorldBookEntry[] {
  if (mode !== 'keywords') return collectWorldbookEntries(worldbook, mode);
  return Object.values(worldbook.entries).filter(entry => {
    if (entry.enabled === false) return false;
    if (entry.constant) return true;
    if (entry.vectorized) return false;
    const depth = entry.scanDepth;
    if (typeof depth === 'number' && depth <= 0) return false;
    const corpus = (typeof depth === 'number' && depth > 0 ? messages.slice(-depth) : messages).map(message => message.content).join('\n');
    if (!(entry.key ?? []).some(key => keywordMatches(key, corpus, entry))) return false;
    if (!entry.selective || !entry.keysecondary?.length) return true;
    const matches = entry.keysecondary.map(key => keywordMatches(key, corpus, entry));
    if (entry.selectiveLogic === 1) return !matches.every(Boolean);
    if (entry.selectiveLogic === 2) return !matches.some(Boolean);
    if (entry.selectiveLogic === 3) return matches.every(Boolean);
    return matches.some(Boolean);
  });
}

/** Read-only adapter of STE's preset/order/macros/depth primitives. Never executes extensions or writes assets. */
export function buildPresetPlaygroundRequest(input: PlaygroundInput) {
  const { preset } = input;
  const card = input.character ? normalizeCharacterCard(input.character) : undefined;
  const userName = input.userName?.trim() || 'User', charName = card?.name || 'Assistant';
  const warnings = new Set<string>();
  const unsupportedMacros = new Set<string>();
  const variables = new Map<string, string>();
  const recent = [...input.messages].reverse();
  const known: Record<string, string> = {
    chardescription: card?.description ?? '', charpersonality: card?.personality ?? '', scenario: card?.scenario ?? '',
    persona: input.persona ?? '', personadescription: input.persona ?? '', mesexamples: card?.messageExample ?? '',
    charsystemprompt: card?.systemPrompt ?? '', charjailbreak: card?.postHistoryInstructions ?? '',
    lastmessage: input.messages.at(-1)?.content ?? '', lastusermessage: recent.find(message => message.role === 'user')?.content ?? '',
    lastcharmessage: recent.find(message => message.role === 'assistant')?.content ?? '', newline: '\n', noop: '',
  };
  const macro = (source: string, original = '') => {
    let value = substituteVars(source, charName, userName);
    for (let pass = 0; pass < 8; pass++) {
      const before = value;
      value = value.replace(/\{\{([^{}]+)\}\}/g, (whole, expression: string) => {
        const [command, name, ...parts] = expression.split('::');
        const key = command.trim().toLowerCase();
        if (key === 'original') return original;
        if (Object.hasOwn(known, key)) return known[key];
        if (key === 'trim') return '';
        if (/^(?:setvar|setglobalvar|getvar|getglobalvar|addvar|addglobalvar)$/.test(key) && name) {
          const variable = `${key.includes('global') ? 'global:' : ''}${name.trim()}`;
          if (key.startsWith('get')) return variables.get(variable) ?? '';
          const content = parts.join('::');
          variables.set(variable, key.startsWith('add') ? String(Number(variables.get(variable) || 0) + Number(content || 0)) : content);
          return '';
        }
        unsupportedMacros.add(command.trim()); return whole;
      });
      if (value === before) break;
    }
    return value;
  };
  const group = preset.promptOrder.find(group => group.character_id === DEFAULT_CHARACTER_ID) ?? preset.promptOrder[0];
  const order = group ? getActiveOrder(preset, group.character_id) : preset.prompts.map(block => ({ identifier: block.identifier, enabled: block.enabled !== false }));
  if (!group) warnings.add('预设没有激活顺序，按提示词条目顺序试用。');
  const blocks = new Map(preset.prompts.map(block => [block.identifier, block]));
  const enabled = order.filter(entry => entry.enabled).flatMap(entry => blocks.has(entry.identifier) ? [blocks.get(entry.identifier)!] : []);
  const entries = input.worldbook ? selectPlaygroundWorldEntries(input.worldbook, input.messages, input.worldMode ?? 'keywords') : [];
  const wbAt = (...positions: number[]) => entries.filter(entry => positions.includes(entry.position)).sort((a,b) => b.order - a.order).map(entry => entry.content).filter(Boolean).join('\n\n');
  const worldBefore = wbAt(0), worldAfter = wbAt(1, 4, 5), exampleBefore = wbAt(2), exampleAfter = wbAt(3);
  if (entries.some(entry => [4, 5].includes(entry.position))) warnings.add('作者注释位置的世界书条目暂放在角色设定之后。');
  if (input.worldbook && Object.values(input.worldbook.entries).some(entry => entry.vectorized || entry.sticky || entry.cooldown || entry.delay || entry.probability < 100 || entry.group)) warnings.add('关键词试用不运行向量、递归、分组概率和延迟触发；完整效果请在聊天页验证。');
  let history = input.messages.map(message => ({ ...message }));
  const injections: { message: ChatCompletionMessage; depth: number; order: number }[] = entries.filter(entry => entry.position === 6)
    .map(entry => ({ message: { role: role(entry.role), content: entry.content }, depth: entry.depth ?? 4, order: entry.order }));
  for (const block of enabled.filter(block => !block.marker && block.injection_position === 1)) {
    injections.push({ message: { role: role(block.role), content: text(block.content) }, depth: block.injection_depth ?? 4, order: typeof block.injection_order === 'number' ? block.injection_order : 100 });
  }
  // Insert farthest from the end first so later insertions retain their original-history depth.
  for (const injection of injections.sort((a,b) => b.depth - a.depth || a.order - b.order)) {
    if (injection.message.content.trim()) history = insertAtDepth(history, injection.message, injection.depth);
  }
  const messages: ChatCompletionMessage[] = [];
  let hasHistory = false;
  const used = new Set<string>();
  const push = (content: string, messageRole: ChatCompletionMessage['role'] = 'system') => { if (content.trim()) messages.push({ role: messageRole, content }); };
  const markerContent: Record<string, string> = {
    worldInfoBefore: worldBefore, worldInfoAfter: worldAfter,
    charDescription: card?.description ?? '', charPersonality: card?.personality ?? '', scenario: card?.scenario ?? '',
    dialogueExamples: [exampleBefore, card?.messageExample, exampleAfter].filter(Boolean).join('\n\n'),
    personaDescription: input.persona ?? '',
  };
  const promptContent = (block: PromptBlock) => {
    const original = text(block.content);
    const override = block.identifier === 'main' ? card?.systemPrompt : block.identifier === 'jailbreak' ? card?.postHistoryInstructions : undefined;
    return override && block.forbid_overrides !== true ? override.replace(/\{\{original\}\}/gi, () => original) : original;
  };
  for (const block of enabled) {
    if (!block.marker && block.injection_position === 1) continue;
    if (block.marker) {
      used.add(block.identifier);
      if (block.identifier === 'chatHistory') { messages.push(...history); hasHistory = true; }
      else if (Object.hasOwn(markerContent, block.identifier)) push(markerContent[block.identifier], role(block.role));
    } else push(promptContent(block), role(block.role));
  }
  if (!hasHistory) { messages.push(...history); warnings.add('预设未启用聊天历史插槽，本次消息追加到提示词末尾。'); }
  if (card && !['charDescription', 'charPersonality', 'scenario'].some(key => used.has(key))) warnings.add('此预设未启用角色设定插槽，所选角色只有名称宏参与。');
  if ((worldBefore && !used.has('worldInfoBefore')) || (worldAfter && !used.has('worldInfoAfter')) || ((exampleBefore || exampleAfter) && !used.has('dialogueExamples'))) warnings.add('部分世界书位置对应的预设插槽未启用，该部分没有注入。');
  if (preset.regexRules.some(rule => !rule.disabled) || inspectPresetScripts(preset.originalData).length) warnings.add('本试用不执行随包正则、酒馆助手脚本和 HTML／宏脚本；相关效果请在聊天页验证。');
  // Macro effects follow the final prompt order, including variables set in earlier preset blocks.
  for (const message of messages) message.content = macro(message.content);
  if (unsupportedMacros.size) warnings.add(`未支持的宏保持原文：${[...unsupportedMacros].slice(0, 8).join('、')}。`);
  const settings = preset.originalData;
  const request: Record<string, unknown> = { ...settings, messages, stream: true, user_name: userName, char_name: charName };
  if (typeof settings.openai_max_tokens === 'number') request.max_tokens = settings.openai_max_tokens;
  // Dynamic tools supplied by ST extensions have no executor in this temporary conversation.
  for (const key of ['tools', 'tool_choice', 'parallel_tool_calls']) delete request[key];
  return { request, messages, warnings: [...warnings], worldEntryCount: entries.length, tokenEstimate: messages.reduce((sum, message) => sum + estimateTokens(message.content), 0) };
}
