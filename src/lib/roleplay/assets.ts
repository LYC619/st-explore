import type { Repo } from '@/lib/repo';
import { KeyedSerialQueue } from '@/lib/keyed-serial-queue';
import { exportWorldBook, parseWorldBook, type WorldBookItem } from '@/types/worldbook';
import { exportPreset, parsePreset } from '@/lib/preset-parser';
import type { PresetItem } from '@/types/preset';
import { digest } from './fingerprint';
import { isPresetRetired } from '@/lib/preset-tag-values';
import { presetName } from '@/lib/preset-presentation';

interface AssetOptions {
  worldbooks: Repo<WorldBookItem>;
  presets: Repo<PresetItem>;
  isCurrent?: () => boolean;
}
const writes = new KeyedSerialQueue();
type RawWorld = { entries: Record<string, Record<string, unknown>>; [key: string]: unknown };

function names<T extends { id: string; title: string }>(items: T[], label: (item: T) => string = item => item.title) {
  const result = new Map<string, T>();
  for (const item of items) {
    const title = label(item);
    let name = items.filter(other => label(other) === title).length > 1 ? `${title} · ${item.id.slice(-6)}` : title;
    if (result.has(name)) name += ` · ${item.id}`;
    result.set(name, item);
  }
  return result;
}
function validName(name: string) {
  // eslint-disable-next-line no-control-regex -- Reject control bytes in asset names.
  if (typeof name !== 'string' || !name.trim() || name.length > 256 || /[\x00-\x1f]/.test(name)) throw new Error('资产名称无效');
}
const presetLabel = (item: PresetItem) => [presetName(item), item.catalog?.version, item.catalog?.variant]
  .filter((value, index, all) => value && (index === 0 || !all[0]?.includes(value))).join(' · ');

/** The original editor reads/writes the existing library records. Names are display aliases, never disk paths. */
export async function createRoleplayAssets(options: AssetOptions) {
  const [worlds, savedPresets] = await Promise.all([options.worldbooks.list(), options.presets.list()]);
  const worldMap = names(worlds);
  const presetMap = names(savedPresets.filter(item => !isPresetRetired(item.catalog)), presetLabel);
  const assertCurrent = () => { if (options.isCurrent && !options.isCurrent()) throw new Error('文件库已切换'); };
  const worldVersion = (item: WorldBookItem) => exportWorldBook(item.worldbook);
  const presetVersion = (item: PresetItem) => exportPreset(item.preset);
  const presetVersions = new Map([...presetMap.values()].map(item => [item.id, presetVersion(item)]));
  const presetOwners = new Map([...presetMap].map(([name, item]) => [name, item.id]));
  // A read by a tool must not advance the baseline of an older, unversioned editor.
  const legacyWorldVersions = new Map([...worldMap].map(([name, item]) => [name, digest(worldVersion(item))]));
  const worldOwners = new Map([...worldMap].map(([name, item]) => [name, item.id]));

  return {
    async refreshWorlds() {
      const next = names(await options.worldbooks.list());
      assertCurrent();
      const renames = Object.fromEntries([...worldMap].flatMap(([name, item]) => {
        const currentName = [...next].find(([, current]) => current.id === item.id)?.[0];
        return currentName && name !== currentName ? [[name, currentName]] : [];
      }));
      worldMap.clear();
      for (const [name, item] of next) {
        worldMap.set(name, item);
        if (!worldOwners.has(name)) {
          worldOwners.set(name, item.id);
          legacyWorldVersions.set(name, digest(worldVersion(item)));
        }
      }
      return renames;
    },
    presetRevisions: () => Object.fromEntries([...presetMap].map(([name, item]) => [name, digest(presetVersion(item))])),
    selectPreset(name: string, revision: string) {
      assertCurrent();
      const item = presetMap.get(name);
      if (!item || revision !== digest(presetVersion(item)) || presetOwners.get(name) !== item.id) throw new Error('预设列表已变化，请重新读取后选择');
      presetVersions.set(item.id, presetVersion(item));
    },
    async refreshPresets() {
      const items = await options.presets.list();
      assertCurrent();
      const next = names(items.filter(item => !isPresetRetired(item.catalog)), presetLabel);
      const renames = Object.fromEntries([...presetMap].flatMap(([name, item]) => {
        const currentName = [...next].find(([, current]) => current.id === item.id)?.[0];
        return currentName && name !== currentName ? [[name, currentName]] : [];
      }));
      presetMap.clear();
      for (const [name, item] of next) {
        presetMap.set(name, item);
        if (!presetOwners.has(name)) presetOwners.set(name, item.id);
        if (!presetVersions.has(item.id)) presetVersions.set(item.id, presetVersion(item));
      }
      return renames;
    },
    worldNames: () => [...worldMap.keys()],
    worldName: (id: string) => [...worldMap].find(([, item]) => item.id === id)?.[0],
    worldId: (name: string) => worldMap.get(name)?.id,
    worldItems: () => [...worldMap.values()].map(item => structuredClone(item)),
    presetName: (id: string) => [...presetMap].find(([, item]) => item.id === id)?.[0],
    presetData: () => new Map([...presetMap].map(([name, item]) => [name, JSON.parse(exportPreset(item.preset)) as Record<string, unknown>])),
    async readWorld(name: string): Promise<RawWorld> {
      assertCurrent();
      const mapped = worldMap.get(name);
      const item = mapped ? await options.worldbooks.get(mapped.id) : undefined;
      if (!item) throw new Error(`世界书不存在：${name}`);
      worldMap.set(name, item);
      return { ...JSON.parse(worldVersion(item)), _ste_revision: digest(worldVersion(item)), _ste_owner: item.id };
    },
    async saveWorld(name: string, data: unknown) {
      validName(name);
      if (!data || typeof data !== 'object' || !('entries' in data) || typeof data.entries !== 'object' || !data.entries) throw new Error('世界书缺少条目');
      const raw = structuredClone(data) as Record<string, unknown>;
      const expected = raw._ste_revision;
      const expectedOwner = raw._ste_owner;
      delete raw._ste_revision;
      delete raw._ste_owner;
      const parsed = parseWorldBook(raw);
      return writes.enqueue(`world:${name}`, async () => {
        assertCurrent();
        const previous = worldMap.get(name);
        const current = previous ? await options.worldbooks.get(previous.id) : undefined;
        if (!current && (typeof expected === 'string' || worldOwners.has(name))) throw new Error('世界书已被删除，请重新打开列表');
        if (current && (typeof expectedOwner === 'string' ? expectedOwner : worldOwners.get(name)) !== current.id) throw new Error('同名世界书已更换，请重新打开列表');
        if (previous && (!current || (typeof expected === 'string' ? expected : legacyWorldVersions.get(name)) !== digest(worldVersion(current)))) throw new Error('世界书已被其他编辑修改，请重新打开后保存');
        const item: WorldBookItem = { ...current, id: current?.id ?? crypto.randomUUID(), title: current?.title ?? name,
          createdAt: current?.createdAt ?? Date.now(), updatedAt: Date.now(), worldbook: parsed };
        assertCurrent();
        await options.worldbooks.put(item);
        worldMap.set(name, item);
        worldOwners.set(name, item.id);
        const revision = digest(worldVersion(item));
        legacyWorldVersions.set(name, revision);
        return { _ste_revision: revision };
      });
    },
    async deleteWorld(name: string) {
      await writes.enqueue(`world:${name}`, async () => {
        assertCurrent();
        const previous = worldMap.get(name);
        if (!previous) throw new Error('世界书不存在');
        const current = await options.worldbooks.get(previous.id);
        if (current && legacyWorldVersions.get(name) !== digest(worldVersion(current))) throw new Error('世界书已被其他编辑修改，请重新打开');
        await options.worldbooks.remove(previous.id);
        worldMap.delete(name);
        legacyWorldVersions.delete(name);
        worldOwners.delete(name);
      });
    },
    async savePreset(name: string, data: unknown) {
      validName(name);
      const parsed = parsePreset(structuredClone(data));
      await writes.enqueue(`preset:${name}`, async () => {
        assertCurrent();
        const previous = presetMap.get(name);
        const current = previous ? await options.presets.get(previous.id) : undefined;
        if (presetOwners.has(name) && presetOwners.get(name) !== previous?.id) throw new Error('预设名称已变化，请重新打开后保存');
        if (previous && (!current || presetVersions.get(previous.id) !== presetVersion(current))) throw new Error('预设已被其他编辑修改，请重新打开后保存');
        const item: PresetItem = { ...current, id: current?.id ?? crypto.randomUUID(), title: current?.title ?? name,
          createdAt: current?.createdAt ?? Date.now(), updatedAt: Date.now(), preset: parsed };
        assertCurrent();
        await options.presets.put(item);
        presetMap.set(name, item);
        presetOwners.set(name, item.id);
        presetVersions.set(item.id, presetVersion(item));
      });
    },
    async deletePreset(name: string) {
      await writes.enqueue(`preset:${name}`, async () => {
        assertCurrent();
        const previous = presetMap.get(name);
        if (!previous) throw new Error('内置预设请另存后编辑');
        const current = await options.presets.get(previous.id);
        if (presetOwners.get(name) !== previous.id || (current && presetVersions.get(previous.id) !== presetVersion(current))) throw new Error('预设已被其他编辑修改，请重新打开');
        await options.presets.remove(previous.id);
        presetMap.delete(name);
        // Only a successful explicit deletion releases the alias. Background refreshes
        // keep tombstones so a stale editor cannot recreate an externally renamed asset.
        presetOwners.delete(name);
        presetVersions.delete(previous.id);
      });
    },
  };
}
