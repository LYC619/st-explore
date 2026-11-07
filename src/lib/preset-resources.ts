import { sha256 } from 'js-sha256';
import type { NormalizedPreset, PresetItem } from '@/types/preset';
import type { RegexCollectionItem } from '@/types/regex';
import { getCurrentRepo } from './repo';
import { getVaultEpoch } from './vault/active';
import { updatePreset } from './preset-db';
import { exportPreset, parsePreset } from './preset-parser';
import { presetContentFingerprint } from './preset-catalog';
import { presetName } from './preset-presentation';
import { ruleToSTScript } from './st-regex-interop';
import { stableJson } from './roleplay/fingerprint';
import { KeyedSerialQueue } from './keyed-serial-queue';

export interface PresetScriptResource {
  key: string; name: string; content: string; info: string; raw: Record<string, unknown>;
  segments: Array<string | number>;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Read script data without evaluating it, including folders and unknown author fields. */
export function listPresetEmbeddedScripts(preset: NormalizedPreset): PresetScriptResource[] {
  const resources: PresetScriptResource[] = [], seen = new Set<object>();
  let visited = 0;
  function walk(value: unknown, segments: Array<string | number>, depth: number) {
    if (!value || typeof value !== 'object' || depth > 16 || ++visited > 20000 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { value.forEach((child,index) => walk(child,[...segments,index],depth+1)); return; }
    const raw = value as Record<string, unknown>;
    if (raw.type === 'script' && typeof raw.content === 'string') {
      resources.push({key: JSON.stringify(segments), segments, name: typeof raw.name === 'string' ? raw.name : '未命名脚本',
        content: raw.content, info: typeof raw.info === 'string' ? raw.info : '', raw: structuredClone(raw)});
      return;
    }
    for (const [key,child] of Object.entries(raw)) walk(child,[...segments,key],depth+1);
  }
  walk(preset.originalData,[],0);
  return resources;
}

interface PresetRegexCopy extends RegexCollectionItem { presetSource?: { presetId: string; contentHash: string } }
const reads = new KeyedSerialQueue();
/** Explicit library extraction. Repeated reads retain a user-edited copy instead of replacing it. */
export async function readPresetEmbeddedRegex(presetId: string): Promise<RegexCollectionItem> {
  const epoch = getVaultEpoch(), presets = getCurrentRepo<PresetItem>('presets'), regexes = getCurrentRepo<PresetRegexCopy>('regexes');
  const check = () => { if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，读取已停止'); };
  return reads.enqueue(`${epoch}:${presetId}`, async () => {
    check(); const preset = await presets.get(presetId); check();
    if (!preset) throw new Error('预设已不存在，请重新读取');
    if (!preset.preset.regexRules.length) throw new Error('此预设没有内嵌正则');
    const contentHash = sha256(stableJson(preset.preset.regexRules.map(ruleToSTScript)));
    const id = `preset-regex-${sha256(`${presetId}\0${contentHash}`).slice(0,32)}`;
    const previous = await regexes.get(id); check();
    if (previous) {
      if (previous.presetSource?.presetId !== presetId || previous.presetSource.contentHash !== contentHash) throw new Error('正则副本身份冲突，请先检查正则库');
      return previous;
    }
    const now = Date.now();
    const item: PresetRegexCopy = { id, title: `${presetName(preset)} · 内嵌正则`, rules: structuredClone(preset.preset.regexRules),
      presetSource: {presetId,contentHash}, createdAt:now, updatedAt:now };
    check(); await regexes.put(item); check(); return item;
  });
}

function changeScript(base: PresetItem, key: string, patch: {name: string; content: string; info: string} | null): Promise<PresetItem> {
  const source = listPresetEmbeddedScripts(base.preset).find(resource => resource.key === key);
  if (!source || !source.segments.length) return Promise.reject(new Error('来源脚本已变化，请重新读取'));
  if (patch && !patch.name.trim()) return Promise.reject(new Error('请填写脚本名称'));
  return updatePreset(base.id, latest => {
    if (presetContentFingerprint(latest.preset) !== presetContentFingerprint(base.preset)) throw new Error('预设内容已在其他位置修改，当前脚本草稿已保留');
    const raw = JSON.parse(exportPreset(latest.preset)) as Record<string, unknown>;
    let parent: unknown = raw;
    for (const segment of source.segments.slice(0,-1)) {
      if (!parent || typeof parent !== 'object') throw new Error('来源脚本已变化，请重新读取');
      parent = (parent as Record<string | number,unknown>)[segment];
    }
    const leaf = source.segments.at(-1)!;
    if (!parent || typeof parent !== 'object') throw new Error('来源脚本已变化，请重新读取');
    const current = (parent as Record<string | number,unknown>)[leaf];
    if (!object(current) || current.type !== 'script') throw new Error('来源脚本已变化，请重新读取');
    if (patch) (parent as Record<string | number,unknown>)[leaf] = {...current, name:patch.name.trim(), content:patch.content, info:patch.info};
    else if (Array.isArray(parent) && typeof leaf === 'number') parent.splice(leaf,1);
    else delete (parent as Record<string | number,unknown>)[leaf];
    return {...latest, preset: parsePreset(raw), autoSaved:false, updatedAt:Date.now()};
  });
}

export function updatePresetEmbeddedScript(base: PresetItem, key: string, patch: {name: string; content: string; info: string}) { return changeScript(base,key,patch); }
export function removePresetEmbeddedScript(base: PresetItem, key: string) { return changeScript(base,key,null); }
