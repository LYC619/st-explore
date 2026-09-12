import type { Repo } from '@/lib/repo';
import { KeyedSerialQueue } from '@/lib/keyed-serial-queue';
import { exportWorldBook, parseWorldBook, type WorldBookItem } from '@/types/worldbook';
import { exportPreset, parsePreset } from '@/lib/preset-parser';
import type { PresetItem } from '@/types/preset';
import { digest } from './fingerprint';

interface AssetOptions {
  worldbooks: Repo<WorldBookItem>;
  presets: Repo<PresetItem>;
  isCurrent?: () => boolean;
}
const writes = new KeyedSerialQueue();
type RawWorld = { entries: Record<string, Record<string, unknown>>; [key: string]: unknown };

function names<T extends { id: string; title: string }>(items: T[]) {
  const result = new Map<string, T>();
  for (const item of items) {
    let name = items.filter(other => other.title === item.title).length > 1 ? `${item.title} · ${item.id.slice(-6)}` : item.title;
    if (result.has(name)) name += ` · ${item.id}`;
    result.set(name, item);
  }
  return result;
}
function validName(name: string) {
  // eslint-disable-next-line no-control-regex -- Reject control bytes in asset names.
  if (typeof name !== 'string' || !name.trim() || name.length > 256 || /[\x00-\x1f]/.test(name)) throw new Error('资产名称无效');
}

/** The original editor reads/writes the existing library records. Names are display aliases, never disk paths. */
export async function createRoleplayAssets(options: AssetOptions) {
  const [worlds, savedPresets] = await Promise.all([options.worldbooks.list(), options.presets.list()]);
  const worldMap = names(worlds);
  const presetMap = names(savedPresets);
  const assertCurrent = () => { if (options.isCurrent && !options.isCurrent()) throw new Error('文件库已切换'); };
  const worldVersion = (item: WorldBookItem) => exportWorldBook(item.worldbook);
  const presetVersion = (item: PresetItem) => exportPreset(item.preset);
  // A read by a tool must not advance the baseline of an older, unversioned editor.
  const legacyWorldVersions = new Map([...worldMap].map(([name, item]) => [name, digest(worldVersion(item))]));

  return {
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
      return { ...JSON.parse(worldVersion(item)), _ste_revision: digest(worldVersion(item)) };
    },
    async saveWorld(name: string, data: unknown) {
      validName(name);
      if (!data || typeof data !== 'object' || !('entries' in data) || typeof data.entries !== 'object' || !data.entries) throw new Error('世界书缺少条目');
      const raw = structuredClone(data) as Record<string, unknown>;
      const expected = raw._ste_revision;
      delete raw._ste_revision;
      const parsed = parseWorldBook(raw);
      return writes.enqueue(`world:${name}`, async () => {
        assertCurrent();
        const previous = worldMap.get(name);
        const current = previous ? await options.worldbooks.get(previous.id) : undefined;
        if (previous && (!current || (typeof expected === 'string' ? expected : legacyWorldVersions.get(name)) !== digest(worldVersion(current)))) throw new Error('世界书已被其他编辑修改，请重新打开后保存');
        const item: WorldBookItem = { ...current, id: current?.id ?? crypto.randomUUID(), title: current?.title ?? name,
          createdAt: current?.createdAt ?? Date.now(), updatedAt: Date.now(), worldbook: parsed };
        assertCurrent();
        await options.worldbooks.put(item);
        worldMap.set(name, item);
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
      });
    },
    async savePreset(name: string, data: unknown) {
      validName(name);
      const parsed = parsePreset(structuredClone(data));
      await writes.enqueue(`preset:${name}`, async () => {
        assertCurrent();
        const previous = presetMap.get(name);
        const current = previous ? await options.presets.get(previous.id) : undefined;
        if (previous && (!current || presetVersion(previous) !== presetVersion(current))) throw new Error('预设已被其他编辑修改，请重新打开后保存');
        const item: PresetItem = { ...current, id: current?.id ?? crypto.randomUUID(), title: current?.title ?? name,
          createdAt: current?.createdAt ?? Date.now(), updatedAt: Date.now(), preset: parsed };
        assertCurrent();
        await options.presets.put(item);
        presetMap.set(name, item);
      });
    },
    async deletePreset(name: string) {
      await writes.enqueue(`preset:${name}`, async () => {
        assertCurrent();
        const previous = presetMap.get(name);
        if (!previous) throw new Error('内置预设请另存后编辑');
        const current = await options.presets.get(previous.id);
        if (current && presetVersion(previous) !== presetVersion(current)) throw new Error('预设已被其他编辑修改，请重新打开');
        await options.presets.remove(previous.id);
        presetMap.delete(name);
      });
    },
  };
}
