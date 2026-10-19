import { buildSummaryMessages, type SummaryEngineInput } from '@/lib/summary-engine';
import { buildTreeFillMessages } from '@/lib/story-tree-ai';
import { estimateTokens } from '@/lib/preset-parser';
import { applyRegexRules, getMessageDepths } from '@/lib/regex-processor';
import type { SummaryItem } from '@/types/summary';
import type { StoryNode } from '@/types/story-tree';
import type { RegexRule } from '@/types/chat';

export function buildScopedTreeRequest(input: Omit<SummaryEngineInput, 'template'> & {
  storyId: string | null; branchId: string | null; nodes: StoryNode[]; references?: SummaryItem[];
  allowCrossBranch?: boolean; processed?: boolean; regexRules?: RegexRule[]; instruction?: string; systemPrompt?: string;
}) {
  const references = (input.references ?? []).filter(record => record.bookId === input.storyId
    && (input.allowCrossBranch || (record.branchId ?? null) === input.branchId));
  const depths = getMessageDepths(input.session.messages);
  const session = input.processed ? { ...input.session, messages: input.session.messages.map(message => ({ ...message,
    content: applyRegexRules(message.content, input.regexRules ?? [], message.role === 'user', depths.get(message.id)) })) } : input.session;
  const skeleton = buildTreeFillMessages(input.nodes, '正文在聊天历史中，请核对原文事实。', input.instruction, input.systemPrompt);
  const refText = references.map(record => `【参考${record.kind === 'diary' ? `日记 · 人物视角：${record.diaryOwner || record.genParams?.diaryOwner || '未指定'}` : '总结'} · ${record.title}】\n${record.content}`).join('\n\n');
  const built = buildSummaryMessages({ ...input, session, priorSummaries: [],
    template: `${skeleton[1].content}\n\n【参考成果（仅作参考，以正文核对事实）】\n${refText || '无'}\n\n严格按系统要求输出 JSON ops，不要输出正文或解释。` });
  const messages = [skeleton[0], ...built.messages];
  return { ...built, messages, tokenEstimate: messages.reduce((sum, message) => sum + estimateTokens(message.content) + 4, 2) };
}
