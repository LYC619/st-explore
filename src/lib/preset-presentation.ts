import type { PresetCatalog } from '@/types/preset';

export type PresetHintField = 'models' | 'version' | 'series' | 'purposes';
export interface PresetIdentityHint {
  field: PresetHintField;
  source: 'filename' | 'configuration';
  text: string;
}
export interface PresetIdentity {
  displayName: string;
  series?: string;
  version?: string;
  models: string[];
  purposes: string[];
  evidence: PresetIdentityHint[];
}
export interface PresetPresentation extends PresetIdentity {
  author?: string;
  inferred: Record<PresetHintField, boolean>;
}

const modelMatchers: [string, RegExp][] = [
  ['Claude', /(?:^|[^a-z])claude(?=$|[^a-z])/i],
  ['Gemini', /(?:^|[^a-z])gemini(?=$|[^a-z])|哈基米|哈吉米/i],
  ['DeepSeek', /(?:^|[^a-z])deepseek(?=$|[^a-z])|深度求索/i],
  ['GPT', /(?:^|[^a-z])(?:chat)?gpt(?=$|[^a-z])/i],
  ['Qwen', /(?:^|[^a-z])qwen(?=$|[^a-z])|通义千问/i],
  ['Llama', /(?:^|[^a-z])llama(?=$|[^a-z])/i],
];
const modelWords = /\b(?:claude|gemini|deepseek|(?:chat)?gpt|qwen|llama)\b|哈基米|哈吉米|深度求索|通义千问/gi;
const modelsIn = (text: string) => modelMatchers.filter(([, pattern]) => pattern.test(text)).map(([model]) => model);
const nonempty = (value?: string) => typeof value === 'string' ? value.trim() || undefined : undefined;
const labels = (values?: string[]) => [...new Set((values ?? []).map(value => value.trim()).filter(Boolean))];

/** The explicitly configured name is shared by file exports and the built-in ST. */
export function presetName(item: { title: string; catalog?: Partial<PresetCatalog> }): string {
  return nonempty(item.catalog?.name) ?? nonempty(item.title) ?? '未命名预设';
}

const tidy = (text: string) => text.replace(/[_]+/g, ' ').replace(/[【】[\]]/g, ' ')
  .replace(/\s+/g, ' ').replace(/^[\s.·,，:：/-]+|[\s.·,，:：/-]+$/g, '').trim();

function filenameLabel(title: string): string {
  return title.replace(/\.json$/i, '').replace(/(?:\s*[_-]?\(\d+\))+\s*$/, '')
    .replace(/^\d{1,2}\.(?=[a-z\u3400-\u9fff])/i, '').trim();
}

function withoutCategoryLabels(title: string): string {
  return title.replace(/[【[]([^\]】]+)[】\]]/g, (whole, text: string) => {
    const remainder = text.replace(modelWords, '').replace(/\b(?:pro|flash|sonnet|opus|haiku)\b/gi, '');
    if (modelsIn(text).length && !/[a-z\u3400-\u9fff]/i.test(remainder)) return '';
    if (/^(?:工具[-\s·]*)?(?:总结|写卡|文风|游玩)$/.test(text.trim())) return '';
    return whole;
  }).trim();
}

/** Inactive *_model fields are often ST defaults; they are not compatibility evidence. */
function configuredModel(raw?: Record<string, unknown>): string {
  if (!raw) return '';
  const source = typeof raw.chat_completion_source === 'string' ? raw.chat_completion_source : '';
  const aliases: Record<string, string> = { makersuite: 'google', google: 'google' };
  const field = source ? `${aliases[source] ?? source}_model` : 'model';
  return typeof raw[field] === 'string' ? raw[field] as string : '';
}

function releaseToken(text: string): { value: string; index: number; length: number } | undefined {
  // An edition named after a model belongs to the release only after an explicit preset name.
  const edition = /(?:Gemini|Claude|DeepSeek|GPT|Qwen|Llama)\s+\d+(?:\.\d+)*(?:\s+[A-Z](?![a-z]))?\s*$/i.exec(text);
  if (edition && /预设\s*[-_·]?\s*$/.test(text.slice(0, edition.index))) {
    return { value: edition[0].trim(), index: edition.index, length: edition[0].length };
  }
  const candidates: RegExp[] = [
    /(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])(?=$|[^\d])/g,
    /(?:0?[1-9]|1[0-2])月(?:0?[1-9]|[12]\d|3[01])日/g,
    /(?:ver(?:sion)?|v)\s*\d{1,3}(?:\.\d{1,3}){0,3}(?![\d.])/gi,
    /(?<![\d.])\d{1,3}(?:\.\d{1,3}){1,3}(?![\d.])/g,
    /(?<!\d)(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?=$|[^\d])/g,
  ];
  for (const pattern of candidates) {
    for (const match of text.matchAll(pattern)) {
      const prefix = text.slice(0, match.index);
      // A leading step number, model generation or card format is not a preset release.
      if (!prefix.trim() || /(?:用于|适用|格式|\bfor)\s*$/i.test(prefix)) continue;
      const explicitRelease = /^(?:ver(?:sion)?|v)\s*\d/i.test(match[0]);
      if (!explicitRelease && /(?:claude|gemini|(?:chat)?gpt|deepseek|qwen|llama|sonnet|opus|haiku|grok|r1|o1|o3|哈基米|哈吉米)\s*[-_]?\s*$/i.test(prefix)) continue;
      return { value: match[0].replace(/\s/g, ''), index: match.index, length: match[0].length };
    }
  }
  return undefined;
}

/** Read-only suggestions: no author guesses, no persistence and no inspection of prompt/script prose. */
export function inferPresetIdentity(title: string, originalData?: Record<string, unknown>): PresetIdentity {
  const filename = filenameLabel(title);
  const name = withoutCategoryLabels(filename);
  const evidence: PresetIdentityHint[] = [];
  const namedModels = modelsIn(filename);
  const activeModel = configuredModel(originalData);
  const models = namedModels.length ? namedModels : modelsIn(activeModel);
  if (models.length) evidence.push({ field: 'models', source: namedModels.length ? 'filename' : 'configuration', text: namedModels.length ? filename : activeModel });
  const purposes = (['写卡', '总结', '文风', '游玩'] as const).filter(purpose => filename.includes(purpose));
  if (purposes.length) evidence.push({ field: 'purposes', source: 'filename', text: filename });
  const token = releaseToken(name);
  const version = token?.value;
  const prefix = token ? tidy(name.slice(0, token.index).replace(modelWords, '')) : '';
  const series = prefix.length >= 2 && /[a-z\u3400-\u9fff]/i.test(prefix) && !/^(?:preset|default|预设|配置|通用)$/i.test(prefix) ? prefix : undefined;
  if (version) evidence.push({ field: 'version', source: 'filename', text: filename });
  if (series) evidence.push({ field: 'series', source: 'filename', text: filename });
  const withoutRelease = token ? `${name.slice(0, token.index)} ${name.slice(token.index + token.length)}` : name;
  const displayName = tidy(withoutRelease.replace(/(?:^|[\s_-])(?:Claude|Gemini|DeepSeek|GPT|Qwen|Llama)\s*$/i, '')) || tidy(filename) || title;
  return { displayName, series, version, models, purposes, evidence };
}

/** Accepts full records and bounded catalog summaries; confirmed metadata wins field by field without author->series pollution. */
export function getPresetPresentation(item: {
  title: string;
  catalog?: Partial<PresetCatalog>;
  preset?: { originalData: Record<string, unknown> };
  presetIdentity?: PresetIdentity;
}): PresetPresentation {
  const hints = item.presetIdentity ?? inferPresetIdentity(item.title, item.preset?.originalData);
  const catalog = item.catalog;
  const models = labels(catalog?.models), purposes = labels(catalog?.purposes);
  const version = nonempty(catalog?.version), series = nonempty(catalog?.series);
  return {
    ...hints,
    displayName: nonempty(catalog?.name) ?? hints.displayName,
    author: nonempty(catalog?.author),
    version: catalog?.versionConfirmed ? version : (version ?? hints.version),
    series: catalog?.seriesConfirmed ? series : (series ?? hints.series),
    models: models.length || catalog?.modelsConfirmed === true ? models : hints.models,
    purposes: purposes.length ? purposes : hints.purposes,
    inferred: {
      version: !version && catalog?.versionConfirmed !== true && !!hints.version,
      series: !series && catalog?.seriesConfirmed !== true && !!hints.series,
      models: !models.length && catalog?.modelsConfirmed !== true && !!hints.models.length,
      purposes: !purposes.length && !!hints.purposes.length,
    },
  };
}

export function presetSeriesKey(item: Parameters<typeof getPresetPresentation>[0]): string {
  const p = getPresetPresentation(item);
  return `${p.author ?? ''}\0${p.series || p.displayName}`.toLocaleLowerCase();
}

function parseVersionTuple(raw?: string): number[] | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cnDate = /^(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日$/.exec(trimmed);
  if (cnDate) return [Number(cnDate[1] || 0), Number(cnDate[2]), Number(cnDate[3])];
  const isoDate = /^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(trimmed);
  if (isoDate) return [Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3])];
  const semver = /^(?:ver(?:sion)?|v)?\s*(\d+(?:\.\d+)*)(?:\s*([a-z]))?$/i.exec(trimmed);
  if (semver) {
    const nums = semver[1].split('.').map(Number);
    if (semver[2]) nums.push(semver[2].toLowerCase().charCodeAt(0) - 96);
    return nums;
  }
  return null;
}

/** 语义化版本／日期比较器（返回值 > 0 表示 a 比 b 新） */
export function comparePresetVersions(a?: string, b?: string): number {
  const va = (a ?? '').trim();
  const vb = (b ?? '').trim();
  if (va === vb) return 0;
  if (!va) return -1;
  if (!vb) return 1;
  const ta = parseVersionTuple(va);
  const tb = parseVersionTuple(vb);
  if (ta && tb) {
    const len = Math.max(ta.length, tb.length);
    for (let i = 0; i < len; i++) {
      const diff = (ta[i] ?? 0) - (tb[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }
  return va.localeCompare(vb, 'zh-CN', { numeric: true });
}
