import { getBuiltinPromptDefault, getBuiltinPrompt, formatBuiltinPrompt } from '@/lib/builtin-prompts';
/**
 * 故事树 AI 辅助：从选定聊天楼层生成/更新事实节点。
 * 借鉴 st-memory-wizzard 的「现有树大纲 → LLM 输出 JSON ops → 幂等 apply」链路，
 * 但节点用稳定 id 主键，AI 只用人类可读 path 定位，apply 时把 path 解析成 id。
 * 纯逻辑（组装 messages / 解析 ops / apply），不触网、无副作用，便于单测。
 */

import type { ChatSession } from '@/types/chat';
import type { StoryNode } from '@/types/story-tree';
import { isStoryNodeType } from '@/types/story-tree';
import type { ChatCompletionMessage } from '@/lib/llm';
import { addNode, updateNode, childrenOf, buildOutline, findById } from '@/lib/story-tree-model';

export interface TreeOp {
  op: 'insert' | 'update' | 'archive';
  /** insert: 父节点路径（斜杠分隔，空/缺省=根） */
  parent?: string;
  /** insert: 新节点标题 */
  title?: string;
  /** insert: 提示/别名 */
  hint?: string;
  /** insert: 正文；update: 追加到现有正文的文本 */
  content?: string;
  /** insert/update: 标签（逗号分隔或数组） */
  keywords?: string | string[];
  /** update/archive: 目标节点路径 */
  path?: string;
  /** insert: 节点类型（character/location/item/event，非法值忽略） */
  type?: string;
}

/** 默认填树 system prompt（UI 允许用户查看/修改，改后仍需保持 JSON ops 输出约定） */
export const DEFAULT_TREE_FILL_PROMPT = getBuiltinPromptDefault('tree.fill');

/** 组装 AI 填树请求的 messages（systemPrompt 缺省用内置默认，UI 可传用户改过的版本） */
export function buildTreeFillMessages(
  nodes: StoryNode[],
  floorText: string,
  extraInstruction?: string,
  systemPrompt?: string
): ChatCompletionMessage[] {
  const outline = buildOutline(nodes, { includeArchived: false }) || '（当前树为空）';
  const instr = extraInstruction?.trim() ? formatBuiltinPrompt('tree.instruction', { instruction: extraInstruction.trim() }) : '';
  const userContent = formatBuiltinPrompt('tree.input', { outline, chat: floorText, instruction: instr });
  return [
    { role: 'system', content: systemPrompt?.trim() || getBuiltinPrompt('tree.fill') },
    { role: 'user', content: userContent },
  ];
}

/** 从 AI 输出解析 ops（去 markdown 围栏，容错） */
export function parseTreeOps(output: string): TreeOp[] {
  let text = output.trim();
  // 去 ```json ... ``` 围栏
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  // 若前后有杂物，尝试截取第一个 { 到最后一个 }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first > 0 || last < text.length - 1) {
    if (first >= 0 && last > first) text = text.slice(first, last + 1);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return []; }
  const ops = (parsed as { ops?: unknown })?.ops;
  if (!Array.isArray(ops)) return [];
  return ops.filter((o): o is TreeOp =>
    !!o && typeof o === 'object' && typeof (o as TreeOp).op === 'string'
  );
}

export function parseTreeOpsResult(output: string): { status: 'ok' | 'refused' | 'invalid-json' | 'empty'; ops: TreeOp[] } {
  if (/^(抱歉|对不起|我无法|我不能|sorry|i (cannot|can't|can’t))/i.test(output.trim())) return { status: 'refused', ops: [] };
  const first = output.indexOf('{'), last = output.lastIndexOf('}');
  try { JSON.parse(output.slice(first, last + 1)); } catch { return { status: 'invalid-json', ops: [] }; }
  const ops = parseTreeOps(output).filter(op => op.op === 'insert' ? typeof op.title === 'string' && !!op.title.trim()
    : (op.op === 'update' || op.op === 'archive') && typeof op.path === 'string' && !!op.path.trim());
  return { status: ops.length ? 'ok' : 'empty', ops };
}

const toTags = (kw: string | string[] | undefined): string[] => {
  if (!kw) return [];
  const arr = Array.isArray(kw) ? kw : kw.split(',');
  return arr.map((s) => s.trim()).filter(Boolean);
};

/** 卷/阶段小节标题前缀：节点正文里用 `## <label>` 分段，切视图时按卷展现状态变化 */
const SECTION_PREFIX = '## ';

export interface ContentSection {
  /** 小节标题（不含 `## ` 前缀）；null = 小节标题之前的引言部分 */
  label: string | null;
  body: string;
}

/**
 * 把节点正文按 `## <标题>` 切成小节（供分卷展示）。
 * 无任何小节标题时返回单个 {label:null, body:全文}。纯函数，便于单测与渲染复用。
 */
export function splitContentSections(content: string): ContentSection[] {
  const text = content ?? '';
  const lines = text.split('\n');
  const sections: ContentSection[] = [];
  let cur: ContentSection = { label: null, body: '' };
  const buf: string[] = [];
  const flush = () => { cur.body = buf.join('\n').trim(); if (cur.body || cur.label) sections.push(cur); buf.length = 0; };
  for (const line of lines) {
    if (line.startsWith(SECTION_PREFIX)) {
      flush();
      cur = { label: line.slice(SECTION_PREFIX.length).trim(), body: '' };
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections.length ? sections : [{ label: null, body: text.trim() }];
}

/**
 * 把新事实并入正文：给定卷/阶段 label 时，追加到该卷小节下（小节已存在则续写，不存在则新建 `## label` 段）；
 * 无 label 时退化为整体追加（保持旧行为）。返回新正文，不改入参。
 */
export function appendToSection(content: string, label: string | undefined, addition: string): string {
  const add = addition.trim();
  if (!add) return content;
  const base = (content ?? '').trim();
  if (!label?.trim()) {
    return base ? `${base}\n${add}` : add;
  }
  const heading = `${SECTION_PREFIX}${label.trim()}`;
  const sections = splitContentSections(base);
  const hit = sections.find((s) => s.label === label.trim());
  if (hit) {
    hit.body = hit.body ? `${hit.body}\n${add}` : add;
    return sections
      .map((s) => (s.label == null ? s.body : `${SECTION_PREFIX}${s.label}\n${s.body}`))
      .filter(Boolean)
      .join('\n\n');
  }
  return base ? `${base}\n\n${heading}\n${add}` : `${heading}\n${add}`;
}

/** 按 path 找节点 id（沿路径逐段匹配 title；找不到返回 undefined） */
function findIdByPath(nodes: StoryNode[], path: string): string | undefined {
  const segs = path.split('/').map((s) => s.trim()).filter(Boolean);
  if (!segs.length) return undefined;
  let parentId: string | null = null;
  let curId: string | undefined;
  for (const seg of segs) {
    const match: StoryNode | undefined = childrenOf(nodes, parentId).find((n) => n.title === seg);
    if (!match) return undefined;
    curId = match.id;
    parentId = match.id;
  }
  return curId;
}

/** 确保父路径存在（逐段创建缺失类目，标 category 类型——它们是结构容器，不该出现在卡片等实体视图里），返回末段 id（parent 为空=根，返回 null） */
function ensureParentPath(nodes: StoryNode[], parentPath: string | undefined): { nodes: StoryNode[]; parentId: string | null } {
  const segs = (parentPath ?? '').split('/').map((s) => s.trim()).filter(Boolean);
  let cur = nodes;
  let parentId: string | null = null;
  for (const seg of segs) {
    const existing: StoryNode | undefined = childrenOf(cur, parentId).find((n) => n.title === seg);
    if (existing) { parentId = existing.id; continue; }
    const { nodes: next, node } = addNode(cur, parentId, { title: seg, type: 'category' });
    cur = next;
    parentId = node.id;
  }
  return { nodes: cur, parentId };
}

export interface ApplyResult {
  nodes: StoryNode[];
  inserted: number;
  updated: number;
  archived: number;
  skipped: number;
}

/**
 * 幂等地把 ops 应用到 nodes（不改入参）。
 * - insert：确保父路径存在；若父下已有同名节点则合并（正文追加、标签并集）而非重复建。
 * - update：按 path 定位（找不到跳过），正文追加、标签并集。
 * - archive：按 path 定位，置 archived=true。
 * - opts.sectionLabel：给定时，**仅角色(character)节点**的新增/追加正文归到 `## <label>` 小节下
 *   （如「第2卷 · 楼层 50~99」）——角色需要逐卷呈现变化过程；事件/地点/物品等
 *   保持平文追加，避免一条事实被卷标题切碎、时间轴/卡片显示乱序。
 */
export function applyTreeOps(
  nodes: StoryNode[],
  ops: TreeOp[],
  opts: { sectionLabel?: string } = {}
): ApplyResult {
  let cur = nodes;
  let inserted = 0, updated = 0, archived = 0, skipped = 0;

  const mergeInto = (id: string, content: string | undefined, tags: string[]) => {
    const node = findById(cur, id)!;
    // 分卷小节只给角色节点用；其余类型平文追加
    const label = node.type === 'character' ? opts.sectionLabel : undefined;
    const newContent = content?.trim()
      ? appendToSection(node.content, label, content)
      : node.content;
    const newTags = Array.from(new Set([...node.tags, ...tags]));
    cur = updateNode(cur, id, { content: newContent, tags: newTags });
  };

  for (const op of ops) {
    if (op.op === 'insert') {
      const title = op.title?.trim();
      if (!title) { skipped++; continue; }
      const ensured = ensureParentPath(cur, op.parent);
      cur = ensured.nodes;
      const twin = childrenOf(cur, ensured.parentId).find((n) => n.title === title);
      if (twin) {
        // 同名已存在 → 合并而非重复插入；顺带补上缺失的类型标注（影响分卷判定）
        const type = isStoryNodeType(op.type) ? op.type : undefined;
        if (type && !twin.type) cur = updateNode(cur, twin.id, { type });
        mergeInto(twin.id, op.content, toTags(op.keywords));
        updated++;
      } else {
        const type = isStoryNodeType(op.type) ? op.type : undefined;
        const { nodes: next, node } = addNode(cur, ensured.parentId, {
          title,
          hint: op.hint ?? '',
          content: appendToSection('', type === 'character' ? opts.sectionLabel : undefined, op.content ?? ''),
          tags: toTags(op.keywords),
          ...(type ? { type } : {}),
        });
        cur = next;
        void node;
        inserted++;
      }
    } else if (op.op === 'update') {
      const id = op.path ? findIdByPath(cur, op.path) : undefined;
      if (!id) { skipped++; continue; }
      mergeInto(id, op.content, toTags(op.keywords));
      updated++;
    } else if (op.op === 'archive') {
      const id = op.path ? findIdByPath(cur, op.path) : undefined;
      if (!id) { skipped++; continue; }
      cur = updateNode(cur, id, { archived: true });
      archived++;
    } else {
      skipped++;
    }
  }

  return { nodes: cur, inserted, updated, archived, skipped };
}

/** 楼层区间 → 文本（与总结引擎同款说话人前缀格式） */
export function floorsToText(session: ChatSession, start: number, end: number): string {
  const lo = Math.max(0, Math.min(start, end));
  const hi = Math.min(session.messages.length - 1, Math.max(start, end));
  const lines: string[] = [];
  for (let i = lo; i <= hi; i++) {
    const m = session.messages[i];
    if (!m) continue;
    const isUser = m.role === 'user' || m.is_user === true;
    const name = isUser ? (session.user?.name || 'User') : (session.character?.name || 'Character');
    lines.push(`${name}: ${m.content}`);
  }
  return lines.join('\n\n');
}

/** 预览用：把 ops 渲染成人类可读摘要行 */
export function describeOps(ops: TreeOp[]): string[] {
  return ops.map((o) => {
    if (o.op === 'insert') return `+ 新增「${o.parent ? o.parent + '/' : ''}${o.title ?? '?'}」`;
    if (o.op === 'update') return `~ 更新「${o.path ?? '?'}」`;
    if (o.op === 'archive') return `⊘ 归档「${o.path ?? '?'}」`;
    return `? 未知操作`;
  });
}
