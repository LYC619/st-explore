import { sha256 } from 'js-sha256';
import type { PresetCatalog, PresetItem, PresetStatus, NormalizedPreset } from '@/types/preset';
import { exportPreset } from './preset-parser';
import { getPresetPresentation, inferPresetIdentity, type PresetIdentity } from './preset-presentation';
import { stableJson } from './roleplay/fingerprint';
import { getPresetTags } from './preset-tag-values';

export const PRESET_STATUS_LABELS: Record<PresetStatus, string> = {
  unreviewed: '待整理', testing: '待试用', active: '在用', reserve: '备用', retired: '过期',
};
export const PRESET_MODELS = ['Claude', 'Gemini', 'DeepSeek', 'GPT'];
export const PRESET_PURPOSES = ['游玩', '写卡', '总结', '文风'];
export function splitCatalogLabels(value: string): string[] {
  return [...new Set(value.split(/[,，、;；\n]/).map(value => value.trim()).filter(Boolean))];
}
export function normalizeModel(value: string): string {
  return PRESET_MODELS.find(model => model.toLowerCase() === value.trim().toLowerCase()) ?? value.trim();
}
export function normalizePresetCatalog(catalog: PresetCatalog = {}): PresetCatalog {
  const next = { ...catalog };
  for (const key of ['name', 'author', 'series', 'version', 'variant', 'sourceUrl', 'publishedAt', 'originId'] as const) {
    const value = next[key];
    next[key] = typeof value === 'string' ? value.trim() || undefined : undefined;
  }
  for (const key of ['models', 'purposes', 'tags', 'representativeCards'] as const) {
    const values = next[key];
    next[key] = [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string').map(value => key === 'models' ? normalizeModel(value) : value.trim()).filter(Boolean))];
  }
  for (const key of ['notes', 'releaseNotes', 'modelNotes'] as const) next[key] = typeof next[key] === 'string' ? next[key] : '';
  next.status = next.status && Object.hasOwn(PRESET_STATUS_LABELS, next.status) ? next.status : 'unreviewed';
  next.tags = getPresetTags(next);
  next.favorite = next.favorite === true;
  next.modelBasis = next.modelBasis === 'author' ? 'author' : 'manual';
  if (next.seriesConfirmed !== true) delete next.seriesConfirmed;
  if (next.versionConfirmed !== true) delete next.versionConfirmed;
  return next;
}
export function presetContentFingerprint(preset: NormalizedPreset): string {
  const raw = JSON.parse(exportPreset(preset));
  delete raw.__ste;
  return sha256(stableJson(raw));
}

/** Only structure is inspected; script strings are never evaluated. */
export function inspectPresetScripts(value: unknown): { name: string; path: string; content: string }[] {
  const result: { name: string; path: string; content: string }[] = [];
  const seen = new Set<object>();
  let visited = 0;
  function walk(value: unknown, path: string, depth: number) {
    if (!value || typeof value !== 'object' || depth > 16 || ++visited > 20000 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { value.forEach((child, index) => walk(child, `${path}[${index}]`, depth + 1)); return; }
    const obj = value as Record<string, unknown>;
    if (obj.type === 'script' && typeof obj.content === 'string') {
      result.push({ name: typeof obj.name === 'string' ? obj.name : '未命名脚本', path, content: obj.content });
      return;
    }
    for (const [key, child] of Object.entries(obj)) walk(child, path ? `${path}.${key}` : key, depth + 1);
  }
  walk(value, '', 0);
  return result;
}

export function suggestPresetModels(title: string, preset: NormalizedPreset): string[] {
  return inferPresetIdentity(title, preset.originalData).models;
}

export interface PresetCatalogSummary extends Omit<PresetCatalog, 'notes' | 'releaseNotes' | 'modelNotes'> {
  noteExcerpt?: string;
  releaseExcerpt?: string;
}
export function summarizePresetCatalog(catalog?: PresetCatalog): PresetCatalogSummary | undefined {
  if (!catalog) return undefined;
  const fields = normalizePresetCatalog(catalog);
  return {
    name: fields.name?.slice(0, 180), author: fields.author?.slice(0, 180), series: fields.series?.slice(0, 180), version: fields.version?.slice(0, 120), variant: fields.variant?.slice(0, 120),
    status: fields.status, favorite: fields.favorite, modelBasis: fields.modelBasis, updatedAt: fields.updatedAt,
    sourceUrl: fields.sourceUrl?.slice(0, 2000), publishedAt: fields.publishedAt?.slice(0, 20), originId: fields.originId?.slice(0, 180),
    models: fields.models?.slice(0, 30).map(value => value.slice(0, 120)), modelsConfirmed: fields.modelsConfirmed === true,
    ...(fields.seriesConfirmed ? { seriesConfirmed: true } : {}),
    ...(fields.versionConfirmed ? { versionConfirmed: true } : {}),
    purposes: fields.purposes?.slice(0, 30).map(value => value.slice(0, 80)),
    tags: fields.tags?.slice(0, 50).map(value => value.slice(0, 80)),
    representativeCards: fields.representativeCards?.slice(0, 20).map(value => value.slice(0, 120)),
    noteExcerpt: fields.notes?.replace(/\s+/g, ' ').slice(0, 180),
    releaseExcerpt: fields.releaseNotes?.replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').slice(0, 200) };
}
export function presetOptionLabel(item: Pick<PresetItem, 'title' | 'catalog'> & { preset?: PresetItem['preset']; presetIdentity?: PresetIdentity }): string {
  const p = getPresetPresentation(item), c = item.catalog;
  const parts = [p.displayName];
  for (const value of [p.version, c?.variant, p.author, ...p.models]) {
    if (value && !parts.some(part => part.toLocaleLowerCase().includes(value.toLocaleLowerCase()))) parts.push(value);
  }
  return `${c?.favorite ? '★ ' : ''}${parts.join(' · ')}`;
}
