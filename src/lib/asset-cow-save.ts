/**
 * 写时复制保存的落库那一半（阶段 F）。
 *
 * `asset-cow.ts` 只做纯决策，不碰存储；这里承接决策结果，把「写哪条记录 + 把角色引用切过去」
 * 收成一处。世界书 / 预设 / 正则三页原本各手抄一份三分支（update / redirect / copy），
 * 骨架逐字符相同，只有载荷字段与提示文案不同——改一处必漏另外两处。
 *
 * 分工：本函数只管落库与引用切换，不管提示与页面状态。三页的 toast 文案已经漂移
 * （「原世界书未改动」/「原预设未改动」/ 正则的原地保存干脆不提示），统一它们是另一件事，
 * 所以返回 { action, targetId, title } 让调用方自己决定说什么、改哪个 state。
 */
import type { AssetKind, ArchiveCharacter } from '@/types/archive';
import { planCowSave, buildDerivedMeta, type CowAssetLike, type CowPlan } from '@/lib/asset-cow';
import { updateCharacterAssetReference } from '@/lib/character-asset-ref';
import { KeyedSerialQueue } from '@/lib/keyed-serial-queue';
import { getVaultEpoch } from '@/lib/vault/active';
import { getPresetTags, isVersionScopedPresetTag } from '@/lib/preset-tag-values';
import type { PresetItem } from '@/types/preset';

const cowWrites = new KeyedSerialQueue();

export type CowSaveContent<T extends CowAssetLike> = Omit<
  T,
  'id' | 'title' | 'derived' | 'createdAt' | 'updatedAt'
>;

export interface CowSaveResult {
  action: CowPlan['action'];
  /** 实际落库的资产 id（副本或原资产） */
  targetId: string;
  /** 落库后这条资产的标题：update = 传入的 title，redirect = 既有副本的标题，copy = 派生名 */
  title: string;
}

export interface CowSaveParams<T extends CowAssetLike> {
  kind: AssetKind;
  /** 当前载入的资产 id。记录内容一律以保存时重读的库内数据为准，不收调用方的快照 */
  baseId: string;
  /** 保存前重读同类资产全集：base 与该角色的既有派生副本都从这里取 */
  reload: () => Promise<T[]>;
  characterId: string;
  characterName: string;
  /** 编辑器里的当前标题（默认只在原地更新时生效；显式重命名时传 titleExplicit=true 一并写入派生副本） */
  title: string;
  titleExplicit?: boolean;
  content: CowSaveContent<T>;
  /** Build a batch edit from the reloaded destination, inside the same COW queue. */
  prepareContent?: (target: T) => CowSaveContent<T> | Promise<CowSaveContent<T>>;
  newId: () => string;
  save: (item: T) => Promise<void>;
  now?: number;
  /** Optional editor revision/ownership guards, checked again immediately before writing. */
  validate?: (target: T, base: T) => void;
  assertCurrent?: () => void;
  validateReference?: (current: ArchiveCharacter, targetId: string) => void;
}

export async function saveAssetWithCow<T extends CowAssetLike>(
  params: CowSaveParams<T>,
): Promise<CowSaveResult> {
  const epoch = getVaultEpoch();
  return cowWrites.enqueue(`${epoch}/${params.kind}/${params.characterId}`, () => {
    if (getVaultEpoch() !== epoch) throw new Error('文件库已切换，资产保存已停止');
    return persistAssetWithCow(params);
  });
}

async function persistAssetWithCow<T extends CowAssetLike>(params: CowSaveParams<T>): Promise<CowSaveResult> {
  const { kind, baseId, reload, characterId, characterName, save } = params;

  params.assertCurrent?.();

  const all = await reload();
  params.assertCurrent?.();
  const base = all.find((a) => a.id === baseId);
  if (!base) {
    throw new Error('这条资产已经不在库里了（可能已被删除），保存已中止');
  }

  const now = params.now ?? Date.now();
  const plan = planCowSave(base, characterId, characterName, all);
  const destination = plan.action === 'redirect' ? all.find(asset => asset.id === plan.targetId)! : base;
  const content = params.prepareContent ? await params.prepareContent(destination) : params.content;
  params.assertCurrent?.();

  let targetId: string;
  let title: string;
  let item: T;

  if (plan.action === 'update') {
    targetId = plan.targetId;
    title = params.title;
    item = {
      ...base,
      ...content,
      title,
      ...(base.derived ? { derived: { ...base.derived, updatedAt: now } } : {}),
      updatedAt: now,
    } as T;
  } else if (plan.action === 'redirect') {
    const copy = all.find((a) => a.id === plan.targetId);
    if (!copy) throw new Error(`找不到派生副本 ${plan.targetId}`);
    targetId = copy.id;
    title = params.titleExplicit && params.title.trim() ? params.title.trim() : copy.title;
    item = {
      ...copy,
      ...content,
      title,
      derived: copy.derived ? { ...copy.derived, updatedAt: now } : copy.derived,
      updatedAt: now,
    } as T;
  } else {
    targetId = params.newId();
    title = params.titleExplicit && params.title.trim() ? params.title.trim() : plan.copyTitle;
    item = {
      ...content,
      id: targetId,
      title,
      derived: buildDerivedMeta(plan.derivedFrom, characterId),
      createdAt: now,
      updatedAt: now,
    } as unknown as T;
    if (kind === 'preset') {
      const original = base as unknown as PresetItem;
      const copy = item as unknown as PresetItem;
      copy.packageFiles = structuredClone(original.packageFiles);
      if (original.catalog) {
        const cleanTags = getPresetTags(original.catalog).filter(tag => !isVersionScopedPresetTag(tag));
        copy.catalog = {
          ...original.catalog,
          series: original.catalog.series || original.title,
          originId: original.id,
          variant: [original.catalog.variant, 'DIY'].filter(Boolean).join(' · '),
          tags: cleanTags,
          favorite: false,
          status: 'testing',
          notes: '',
          updatedAt: now,
        };
      }
    }
  }

  params.validate?.(all.find(asset => asset.id === targetId) ?? base, base);
  params.assertCurrent?.();
  await save(item);
  params.assertCurrent?.();
  try {
    const updatedCharacter = params.validateReference
      ? await updateCharacterAssetReference(characterId, kind, base.id, targetId, now, current => params.validateReference!(current, targetId))
      : await updateCharacterAssetReference(characterId, kind, base.id, targetId, now);
    if (!updatedCharacter) throw new Error('角色可能已被删除');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`资产已保存，但角色引用切换失败：${detail}`);
  }
  return { action: plan.action, targetId, title };
}
