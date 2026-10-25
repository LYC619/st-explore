import { getBuiltinPromptDefault, getBuiltinPrompt } from '@/lib/builtin-prompts';
/**
 * 总结提示词模板：内置模板（代码常量，不入库）+ 自定义模板（IndexedDB summaryTemplates store）。
 *
 * 内置模板结构改编自实测有效的 ST 注入式总结/日记提示词，做了入库洁化：
 * 主角名改 {{user}} 宏、亲密向字段中性化。私人版本可粘贴「另存为自定义模板」使用（存本地不进仓库）。
 *
 * 模板在生成时作为聊天历史最末一条 user 消息（D0 位置）注入；
 * {{char}}/{{user}}/{{volume}} 宏由 summary-engine 在组装时替换。
 */

import type { SummaryKind, SummaryTemplate } from '@/types/summary';
import { getAllSummaryTemplates } from '@/lib/summary-db';

export interface BuiltinSummaryTemplate {
  /** builtin- 前缀，与自定义模板（stpl_ 前缀）id 空间区分 */
  id: string;
  title: string;
  kind: SummaryKind | 'any';
  content: string;
  builtin: true;
}

export type AnySummaryTemplate = BuiltinSummaryTemplate | SummaryTemplate;

export function isBuiltinTemplate(t: AnySummaryTemplate): t is BuiltinSummaryTemplate {
  return 'builtin' in t && t.builtin === true;
}

const VOLUME_TEMPLATE = getBuiltinPromptDefault('builtin-volume');

const DIARY_TEMPLATE = getBuiltinPromptDefault('builtin-diary');

const DIY_TEMPLATE = getBuiltinPromptDefault('builtin-diy');

const NOVELIZE_TEMPLATE = getBuiltinPromptDefault('builtin-novelize');

export const BUILTIN_SUMMARY_TEMPLATES: BuiltinSummaryTemplate[] = [
  { id: 'builtin-volume', title: '分卷存档节点（内置）', kind: 'volume', content: VOLUME_TEMPLATE, builtin: true },
  { id: 'builtin-diary', title: '角色日记（内置）', kind: 'diary', content: DIARY_TEMPLATE, builtin: true },
  { id: 'builtin-diy', title: 'DIY 创作起点（内置）', kind: 'diy', content: DIY_TEMPLATE, builtin: true },
  { id: 'builtin-novelize', title: '小说化润色（内置）', kind: 'diy', content: NOVELIZE_TEMPLATE, builtin: true },
];

export function getBuiltinTemplate(id: string): BuiltinSummaryTemplate | undefined {
  const template = BUILTIN_SUMMARY_TEMPLATES.find((t) => t.id === id);
  return template ? { ...template, content: getBuiltinPrompt(template.id) } : undefined;
}

/** 各呈现类型的默认模板 id */
export function defaultTemplateIdForKind(kind: SummaryKind): string {
  return `builtin-${kind}`;
}

/** kind 匹配规则：模板 kind 与目标一致，或模板为 any（通用） */
export function templateMatchesKind(t: { kind: SummaryKind | 'any' }, kind: SummaryKind): boolean {
  return t.kind === kind || t.kind === 'any';
}

/** 列出某呈现类型可用的全部模板：内置在前，自定义（含 AI 工具页存入的 any）在后 */
export async function listTemplatesForKind(kind: SummaryKind): Promise<AnySummaryTemplate[]> {
  const custom = await getAllSummaryTemplates();
  return [
    ...BUILTIN_SUMMARY_TEMPLATES.filter((t) => templateMatchesKind(t, kind)).map(t => ({ ...t, content: getBuiltinPrompt(t.id) })),
    ...custom.filter((t) => templateMatchesKind(t, kind)),
  ];
}
