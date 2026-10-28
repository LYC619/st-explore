import type { PresetItem, PresetPackageFile } from '@/types/preset';
import { exportPreset, parsePreset } from './preset-parser';
import { sha256 } from 'js-sha256';
import { stableJson } from './roleplay/fingerprint';
import { presetAttachmentRegexEntries } from './preset-package';
import { parseSTRegexImport, ruleToSTScript } from './st-regex-interop';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Merge author resources as data, preserving unknown fields and existing extension settings. */
export function embedPresetAttachment(preset: PresetItem['preset'], file: PresetPackageFile): PresetItem['preset'] {
  if (preset.originalData.extensions !== undefined && preset.originalData.extensions !== null
    && (typeof preset.originalData.extensions !== 'object' || Array.isArray(preset.originalData.extensions))) throw new Error('现有扩展格式无法安全合并，请在编辑区检查');
  const raw = JSON.parse(exportPreset(preset));
  const extensions = raw.extensions = object(raw.extensions);
  let value: unknown;
  try { value = JSON.parse(file.text); }
  catch { if (file.kind !== 'script' || !/\.m?js$/i.test(file.name)) throw new Error('附件不是有效 JSON，请先修正文件'); }
  const nodes = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value.flatMap(nodes);
    const data = object(value);
    return [value, ...(data.type === 'folder' && Array.isArray(data.scripts) ? data.scripts.flatMap(nodes) : [])];
  };
  const merge = (previous: unknown, additions: unknown[]) => {
    if (previous !== undefined && !Array.isArray(previous)) throw new Error('现有扩展格式无法安全合并，请在编辑区检查');
    const result: unknown[] = [...(Array.isArray(previous) ? previous : [])];
    for (const entry of additions) {
      const existing = nodes(result);
      if (existing.some(current => stableJson(current) === stableJson(entry))) continue;
      const addedIds = new Set<unknown>();
      for (const added of nodes(entry)) {
        const id = object(added).id;
        if (!id) continue;
        if (addedIds.has(id) || existing.some(current => object(current).id === id)) throw new Error('附件与内嵌资源 ID 冲突，请先检查内容再合并');
        addedIds.add(id);
      }
      result.push(entry);
    }
    return result;
  };
  if (file.kind === 'regex') {
    const entries = presetAttachmentRegexEntries(value);
    if (!entries) throw new Error('附件缺少正则查找或替换字段');
    // Compare the same ST representation that the preset parser exports, including defaults.
    const normalized = entries.map(entry => ruleToSTScript(parseSTRegexImport({ ...object(entry), id: object(entry).id || sha256(stableJson(entry)).slice(0, 32) })[0]));
    extensions.regex_scripts = merge(extensions.regex_scripts, normalized);
  } else if (file.kind === 'script') {
    const scripts: unknown[] = [];
    const collect = (entry: unknown, depth = 0): unknown[] => {
      if (depth > 16) throw new Error('脚本分组层级过深');
      if (Array.isArray(entry)) return entry.flatMap(child => collect(child, depth + 1));
      const data = object(entry);
      if (data.type === 'script' && typeof data.content === 'string') return [structuredClone(data)];
      if (data.type === 'folder' && Array.isArray(data.scripts)) {
        const children = collect(data.scripts, depth + 1);
        return children.length ? [{ ...structuredClone(data), scripts: children }] : [];
      }
      for (const key of ['scripts', 'content', 'tavern_helper', 'extensions']) if (data[key] && typeof data[key] === 'object') {
        const children = collect(data[key], depth + 1);
        if (children.length) return children;
      }
      return [];
    };
    if (value === undefined) scripts.push({ type: 'script', id: sha256(file.text).slice(0, 32), name: file.name.replace(/\.m?js$/i, ''), content: file.text, enabled: false, info: '', button: { enabled: false, buttons: [] }, data: {} });
    else scripts.push(...collect(value));
    if (!scripts.length) throw new Error('未找到可内置的酒馆助手脚本');
    if (extensions.tavern_helper !== undefined && (extensions.tavern_helper === null || typeof extensions.tavern_helper !== 'object' || Array.isArray(extensions.tavern_helper))) throw new Error('现有酒馆助手扩展格式无法安全合并，请在编辑区检查');
    const helper = object(extensions.tavern_helper);
    extensions.tavern_helper = { ...helper, scripts: merge(helper.scripts, scripts) };
  } else throw new Error('仅正则和脚本可以内置到预设');
  return parsePreset(raw);
}
