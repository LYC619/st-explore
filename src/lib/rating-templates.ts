import { getBuiltinPromptDefault, getBuiltinPrompt } from '@/lib/builtin-prompts';
/**
 * 评分模板：内置模板（代码常量，不可改可复制）+ 自定义模板（IndexedDB）。
 * 定稿第四章：三种打分方式（手动/模板/AI）共用模板的维度与权重；
 * AI 评分时 prompt + 维度清单由 character-ai 引擎组装进提示词。
 */
import type { RatingTemplateItem, RatingDimension } from '@/types/rating';
import { generateRatingTemplateId } from '@/types/rating';
import { getAllRatingTemplates } from '@/lib/rating-db';

export const BUILTIN_RATING_TEMPLATE: RatingTemplateItem = {
  id: 'builtin-rating-standard',
  title: '通用角色卡评分（内置）',
  dimensions: [
    { name: '设定完整度', weight: 25, hint: getBuiltinPromptDefault('character.rating.hint.0') },
    { name: '开场白与文笔', weight: 20, hint: getBuiltinPromptDefault('character.rating.hint.1') },
    { name: '角色魅力', weight: 25, hint: getBuiltinPromptDefault('character.rating.hint.2') },
    { name: '可玩性', weight: 20, hint: getBuiltinPromptDefault('character.rating.hint.3') },
    { name: '世界观一致性', weight: 10, hint: getBuiltinPromptDefault('character.rating.hint.4') },
  ],
  prompt: getBuiltinPromptDefault('character.rating'),
  builtin: true,
  createdAt: 0,
  updatedAt: 0,
};

export const BUILTIN_RATING_TEMPLATES: RatingTemplateItem[] = [BUILTIN_RATING_TEMPLATE];

/** 列出全部可用模板：内置在前，自定义在后 */
export async function listRatingTemplates(): Promise<RatingTemplateItem[]> {
  const custom = await getAllRatingTemplates();
  return [...BUILTIN_RATING_TEMPLATES.map(resolveRatingTemplate), ...custom];
}

/** 复制模板为自定义副本（内置不可改 → 复制后随便改） */
export function copyRatingTemplate(src: RatingTemplateItem): RatingTemplateItem {
  src = resolveRatingTemplate(src);
  const now = Date.now();
  return {
    id: generateRatingTemplateId(),
    title: `${src.title.replace(/（内置）$/, '')} 副本`,
    dimensions: src.dimensions.map((d): RatingDimension => ({ ...d })),
    prompt: src.prompt,
    createdAt: now,
    updatedAt: now,
  };
}

/** 自定义模板独立；内置模板在读取/生成时应用当前偏好。 */
export function resolveRatingTemplate(template: RatingTemplateItem): RatingTemplateItem {
  if (template.id !== BUILTIN_RATING_TEMPLATE.id || !template.builtin) return template;
  return { ...template, prompt: getBuiltinPrompt('character.rating'),
    dimensions: template.dimensions.map((dimension, index) => ({ ...dimension, hint: getBuiltinPrompt(`character.rating.hint.${index}`) })) };
}
