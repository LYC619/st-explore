import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_PROMPTS, formatBuiltinPrompt, getBuiltinPrompt, getBuiltinPromptDefault, resetBuiltinPrompt, saveBuiltinPrompt } from '@/lib/builtin-prompts';
import { getBuiltinTemplate } from '@/lib/summary-templates';
import { buildSummaryMessages } from '@/lib/summary-engine';
import { buildIntroMessages, buildRatingMessages } from '@/lib/character-ai';
import { normalizeCharacterCard } from '@/lib/png-parser';
import { BUILTIN_RATING_TEMPLATE, copyRatingTemplate } from '@/lib/rating-templates';
import { buildTreeFillMessages } from '@/lib/story-tree-ai';
import { buildChapterSuggestMessages } from '@/lib/novel-view';
import type { ChatSession } from '@/types/chat';

const norm = normalizeCharacterCard({ name: '爱丽丝', description: '图书管理员' });
const session: ChatSession = { id: 's', title: '图书馆', createdAt: 1, character: { name: '爱丽丝' }, user: { name: '旅人' },
  messages: [{ id: 'm', role: 'user', content: '我来到图书馆。' }] };
beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('built-in prompt persistence and actual request assembly', () => {
  it('keeps every default restorable and rejects missing source placeholders', () => {
    for (const prompt of BUILTIN_PROMPTS) {
      saveBuiltinPrompt(prompt.id, `${prompt.content}\n自用要求`);
      expect(getBuiltinPrompt(prompt.id)).toContain('自用要求');
      resetBuiltinPrompt(prompt.id);
      expect(getBuiltinPrompt(prompt.id)).toBe(prompt.content);
    }
    expect(() => saveBuiltinPrompt('rewrite.input', '{{content}}')).toThrow(/instruction/);
    expect(() => saveBuiltinPrompt('character.intro', '  ')).toThrow(/不能为空/);
  });

  it('reuses legacy worldbook/tree values and does not resurrect them after reset', () => {
    localStorage.setItem('st-wb-update-prompt', '旧世界书自定义');
    localStorage.setItem('st-story-tree-fill-prompt', '旧故事树自定义');
    expect(getBuiltinPrompt('worldbook.update')).toBe('旧世界书自定义');
    expect(buildTreeFillMessages([], '正文')[0].content).toBe('旧故事树自定义');
    saveBuiltinPrompt('tree.fill', `${getBuiltinPromptDefault('tree.fill')}\n新版`);
    expect(localStorage.getItem('st-story-tree-fill-prompt')).toContain('新版');
    resetBuiltinPrompt('tree.fill');
    resetBuiltinPrompt('worldbook.update');
    expect(localStorage.getItem('st-story-tree-fill-prompt')).toBeNull();
    expect(getBuiltinPrompt('worldbook.update')).toBe(getBuiltinPromptDefault('worldbook.update'));
  });

  it('changes subsequent intro and rating requests without mutating independent template copies', () => {
    const copy = copyRatingTemplate(BUILTIN_RATING_TEMPLATE);
    saveBuiltinPrompt('character.intro', '只写人物身份');
    expect(buildIntroMessages({ norm }).messages[0].content).toBe('只写人物身份');
    saveBuiltinPrompt('character.rating', '重点看可玩性');
    saveBuiltinPrompt('character.rating.hint.0', '核对角色背景');
    const rating = buildRatingMessages({ norm, template: BUILTIN_RATING_TEMPLATE }).messages[0].content;
    expect(rating).toContain('重点看可玩性');
    expect(rating).toContain('核对角色背景');
    expect(rating).toContain('"dimensions"');
    expect(buildRatingMessages({ norm, template: copy }).messages[0].content).not.toContain('重点看可玩性');
  });

  it('uses customized summary and chapter instructions, expanding only the intended macros', () => {
    saveBuiltinPrompt('builtin-volume', '{{char}}与{{user}}的第{{volume}}卷：只记关键事件');
    const template = getBuiltinTemplate('builtin-volume')!.content;
    const result = buildSummaryMessages({ session, floorStart: 0, floorEnd: 0, template, volumeNumber: 2 });
    expect(result.messages.at(-1)?.content).toBe('爱丽丝与旅人的第2卷：只记关键事件');
    saveBuiltinPrompt('novel.chapters', `${getBuiltinPromptDefault('novel.chapters')}\n按场景划分`);
    expect(buildChapterSuggestMessages({ session })[0].content).toContain('按场景划分');
    expect(formatBuiltinPrompt('rewrite.input', { content: '{{instruction}} $&', instruction: '保留原文' }))
      .toBe('【当前内容】：\n{{instruction}} $&\n\n【修改要求】：\n保留原文');
  });

  it('reports failed storage writes instead of pretending the prompt was saved', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage full'); });
    expect(() => saveBuiltinPrompt('character.intro', '新版本')).toThrow('storage full');
    expect(getBuiltinPrompt('character.intro')).toBe(getBuiltinPromptDefault('character.intro'));
  });
});
