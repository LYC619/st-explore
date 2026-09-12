import type { Repo } from '@/lib/repo';
import { KeyedSerialQueue } from '@/lib/keyed-serial-queue';
import { getVaultEpoch } from '@/lib/vault/active';
import { ruleToSTScript, stScriptToRule, type STRegexScript } from '@/lib/st-regex-interop';
import type { AssetRef } from '@/types/archive';
import type { RegexRule } from '@/types/chat';
import type { RegexCollectionItem } from '@/types/regex';
import { digest, stableJson } from './fingerprint';

export interface RegexAssetLanes {
  globalScripts: STRegexScript[];
  embeddedScripts: STRegexScript[];
}
type Lane = keyof RegexAssetLanes;
export interface RegexAssetSnapshot extends RegexAssetLanes {
  revisions: Record<string, string>;
  assets: { assetId: string; title: string; lane: Lane; revision: string }[];
  missingAssetIds: string[];
}
export interface RegexAssetSaveInput extends Partial<RegexAssetLanes> {
  /** Carry the revisions from the editor's own read, including when a lane becomes empty. */
  revisions: Record<string, string>;
}
export interface RegexAssetSaveResult extends Partial<RegexAssetLanes> {
  revisions: Record<string, string>;
}
export interface RoleplayRegexAssetsOptions {
  regexes: Repo<RegexCollectionItem>;
  storyAssets?: readonly AssetRef[];
  characterAssets?: readonly AssetRef[];
  isCurrent?: () => boolean;
}

const lanes = ['globalScripts', 'embeddedScripts'] as const;
const prefix = 'ste-regex-asset-';
const queues = new WeakMap<Repo<RegexCollectionItem>, KeyedSerialQueue>();
const revisionOf = (item: RegexCollectionItem) => digest(stableJson(item));
const scriptId = (assetId: string, ruleId: string) => prefix + digest(stableJson([assetId, ruleId]));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function scripts(value: unknown): STRegexScript[] {
  if (!Array.isArray(value) || value.some(item => !object(item) || typeof item.scriptName !== 'string'
    || typeof item.findRegex !== 'string' || typeof item.replaceString !== 'string'
    || !Array.isArray(item.placement) || item.placement.some(position => !Number.isSafeInteger(position))
    || item.id !== undefined && typeof item.id !== 'string')) throw new Error('正则脚本格式无效');
  return value as STRegexScript[];
}

/**
 * Project linked collections into ST's two editable lanes. Story references win duplicate IDs.
 * read() returns asset overlays to append to the ordinary lists and an editor revision sidecar.
 * save() accepts either complete edited lane, writes linked rules, and returns only that lane's
 * ordinary scripts for the host to persist. An omitted lane is untouched. Keep returned revisions
 * with that same editor; a background read must not replace an older editor's revision sidecar.
 */
export function createRoleplayRegexAssets(options: RoleplayRegexAssetsOptions) {
  const { regexes } = options;
  const epoch = getVaultEpoch();
  const queue = queues.get(regexes) ?? new KeyedSerialQueue();
  queues.set(regexes, queue);
  const references = new Map<string, Lane>();
  for (const [lane, refs] of [[lanes[0], options.storyAssets], [lanes[1], options.characterAssets]] as const) {
    for (const ref of refs ?? []) {
      if (ref.kind !== 'regex') continue;
      if (typeof ref.assetId !== 'string' || !ref.assetId) throw new Error('正则资产引用无效');
      if (!references.has(ref.assetId)) references.set(ref.assetId, lane);
    }
  }
  const history = new Map<string, Map<string, RegexCollectionItem>>();
  const identities = new Map<string, { assetId: string; ruleId: string; lane: Lane }>();
  let visible = new Set<string>();
  let hasRead = false;

  function check() {
    if (getVaultEpoch() !== epoch || options.isCurrent?.() === false) throw new Error('文件库或故事已切换，正则资产操作已停止');
  }
  function remember(item: RegexCollectionItem): string {
    const ids = new Set<string>();
    for (const rule of item.rules) {
      if (typeof rule.id !== 'string' || !rule.id || ids.has(rule.id)) throw new Error(`正则集规则身份无效或重复：${item.title}`);
      ids.add(rule.id);
      identities.set(scriptId(item.id, rule.id), { assetId: item.id, ruleId: rule.id, lane: references.get(item.id)! });
    }
    const revision = revisionOf(item);
    const versions = history.get(item.id) ?? new Map<string, RegexCollectionItem>();
    versions.set(revision, structuredClone(item)); history.set(item.id, versions);
    return revision;
  }

  return {
    read(): Promise<RegexAssetSnapshot> {
      return queue.enqueue('assets', async () => {
        check();
        const items = await Promise.all([...references.keys()].map(id => regexes.get(id)));
        check();
        const result: RegexAssetSnapshot = { globalScripts: [], embeddedScripts: [], revisions: Object.create(null), assets: [], missingAssetIds: [] };
        let index = 0;
        for (const [assetId, lane] of references) {
          const item = items[index++];
          if (!item) { result.missingAssetIds.push(assetId); continue; }
          if (item.id !== assetId) throw new Error('正则资产身份不匹配');
          const revision = remember(item);
          result.revisions[assetId] = revision;
          result.assets.push({ assetId, title: item.title, lane, revision });
          result[lane].push(...item.rules.map(rule => ({ ...ruleToSTScript(rule), id: scriptId(assetId, rule.id) })));
        }
        visible = new Set(result.assets.map(item => item.assetId)); hasRead = true;
        return structuredClone(result);
      });
    },
    save(input: RegexAssetSaveInput): Promise<RegexAssetSaveResult> {
      const value = structuredClone(input);
      return queue.enqueue('assets', async () => {
        check();
        if (!hasRead) throw new Error('请先读取正则资产再保存');
        if (!object(value) || !object(value.revisions) || Object.values(value.revisions).some(version => typeof version !== 'string')) {
          throw new Error('正则资产版本无效，请重新读取');
        }
        const submitted = lanes.filter(lane => value[lane] !== undefined);
        if (!submitted.length) throw new Error('未提供待保存的正则脚本');
        const bases = new Map<string, RegexCollectionItem>();
        const desired = new Map<string, { script: STRegexScript; rule: RegexRule }[]>();
        for (const [assetId, lane] of references) {
          if (!submitted.includes(lane)) continue;
          const revision = Object.hasOwn(value.revisions, assetId) ? value.revisions[assetId] : undefined;
          if (!revision && !visible.has(assetId)) continue;
          const base = revision ? history.get(assetId)?.get(revision) : undefined;
          if (!base) throw new Error(`正则资产版本无效，请重新读取：${assetId}`);
          bases.set(assetId, base); desired.set(assetId, []);
        }
        const result: RegexAssetSaveResult = { revisions: { ...value.revisions } };
        const seen = new Set<string>();
        for (const lane of submitted) {
          const ordinary: STRegexScript[] = [];
          for (const incoming of scripts(value[lane])) {
            const identity = incoming.id ? identities.get(incoming.id) : undefined;
            if (!identity) {
              if (incoming.id?.startsWith(prefix)) throw new Error('正则脚本属于未读取或已失效的关联资产');
              ordinary.push(incoming); continue;
            }
            if (identity.lane !== lane) throw new Error('关联正则资产不能跨作用域移动，请调整资产引用');
            if (seen.has(incoming.id!)) throw new Error('关联正则脚本身份重复');
            seen.add(incoming.id!);
            const base = bases.get(identity.assetId);
            const rule = base?.rules.find(item => item.id === identity.ruleId);
            if (!rule) throw new Error('正则脚本与编辑器版本不匹配，请重新读取');
            // ST's native editor reconstructs its known fields and may omit extension fields.
            const restored = { ...ruleToSTScript(rule), ...incoming, id: rule.id };
            desired.get(identity.assetId)!.push({ script: restored, rule });
          }
          result[lane] = ordinary;
        }
        const changed = [...bases].filter(([id, base]) => stableJson(desired.get(id)!.map(item => item.script))
          !== stableJson(base.rules.map(ruleToSTScript)));
        // Preflight all touched collections before the first write, including whole-list deletions.
        const current = await Promise.all(changed.map(([id]) => regexes.get(id)));
        check();
        for (let i = 0; i < changed.length; i++) {
          const [id, base] = changed[i];
          if (!current[i] || revisionOf(current[i]!) !== revisionOf(base)) throw new Error(`正则资产已被修改或删除，请重新读取：${id}`);
        }
        for (const [id, base] of changed) {
          const latest = await regexes.get(id);
          check();
          if (!latest || revisionOf(latest) !== revisionOf(base)) throw new Error(`正则资产已被修改或删除，请重新读取：${id}`);
          const next: RegexCollectionItem = { ...latest, updatedAt: Date.now(),
            rules: desired.get(id)!.map(({ script, rule }) => ({ ...rule, ...stScriptToRule(script) })) };
          await regexes.put(next);
          result.revisions[id] = remember(next);
        }
        return structuredClone(result);
      });
    },
  };
}

export type RoleplayRegexAssets = ReturnType<typeof createRoleplayRegexAssets>;
