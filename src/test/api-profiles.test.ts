import { beforeEach, describe, it, expect } from 'vitest';
import {
  loadApiProfiles, getActiveProfile, loadAPIConfig, saveAPIConfig, clearAPIConfig,
  persistProfiles, DEFAULT_API_URL, DEFAULT_MODEL, type ApiProfile,
  storeProfileModelsIfCurrent,
  activateApiModel, getActiveModelSelection, getAPIConfigForSelection, setProfileModelFavorite, profileModels,
} from '@/components/ai-tools/api-profiles';

const PROFILES_KEY = 'st-beautifier-api-profiles';
const ACTIVE_KEY = 'st-beautifier-api-active-profile';

beforeEach(() => {
  localStorage.clear();
});

describe('api-profiles 持久化层', () => {
  it('模型切换保存服务与模型，旧请求快照和另一服务保持独立', () => {
    persistProfiles([
      { id: 'a', name: '甲', apiKey: 'fixture-a', apiUrl: 'https://a.example/v1/chat/completions', model: 'a1', favoriteModels: ['a2'] },
      { id: 'b', name: '乙', apiKey: 'fixture-b', apiUrl: 'https://b.example/v1/chat/completions', model: 'b1' },
    ], 'a');
    const snapshot = getAPIConfigForSelection(getActiveModelSelection());
    expect(activateApiModel({ profileId: 'b', model: ' b2 ' })).toBe(true);
    expect(getActiveModelSelection()).toEqual({ profileId: 'b', model: 'b2' });
    expect(snapshot).toEqual({ apiKey: 'fixture-a', apiUrl: 'https://a.example/v1/chat/completions', model: 'a1' });
    expect(loadApiProfiles().profiles[0].model).toBe('a1');
    expect(getAPIConfigForSelection({ profileId: 'gone', model: 'b2' })).toBeUndefined();
  });

  it('常用与自定义模型不随服务列表刷新丢失，也不改变活跃配置', () => {
    const profile = { id: 'a', name: '甲', apiKey: 'fixture', apiUrl: DEFAULT_API_URL, model: 'a1', modelList: ['a1', 'a2'] };
    persistProfiles([profile], 'a');
    expect(setProfileModelFavorite('a', ' custom-x ', true)).toBe(true);
    expect(setProfileModelFavorite('a', 'custom-x', true)).toBe(true);
    storeProfileModelsIfCurrent(profile, [' a3 ', 'a3', '']);
    const saved = getActiveProfile();
    expect(saved.favoriteModels).toEqual(['custom-x']);
    expect(profileModels(saved)).toEqual(['a1', 'custom-x', 'a3']);
    expect(saved.model).toBe('a1');
    setProfileModelFavorite('a', 'custom-x', false);
    expect(getActiveProfile().favoriteModels).toEqual([]);
  });

  it('never writes a late model list into the new active connection or a changed address', () => {
    const original = { id: 'a', name: 'A', apiUrl: 'https://a.example/v1/chat/completions', apiKey: 'fixture-key', model: 'a' };
    const other = { ...original, id: 'b', name: 'B', apiUrl: 'https://b.example/v1/chat/completions', model: 'b' };
    persistProfiles([original, other], 'b');
    expect(storeProfileModelsIfCurrent(original, ['a1'])).toBe(true);
    expect(getActiveProfile()).toMatchObject({ id: 'b', model: 'b' });
    expect(loadApiProfiles().profiles[0].modelList).toEqual(['a1']);
    persistProfiles([{ ...original, apiUrl: 'https://new.example/v1/chat/completions' }, other], 'b');
    expect(storeProfileModelsIfCurrent(original, ['stale'])).toBe(false);
    expect(loadApiProfiles().profiles[0].modelList).toBeUndefined();
  });
  it('从旧单配置 4 个 key 一次性迁移成「默认」提供商并清掉旧 key', () => {
    localStorage.setItem('st-beautifier-openai-key', 'sk-legacy');
    localStorage.setItem('st-beautifier-api-url', 'https://relay.example/v1/chat/completions');
    localStorage.setItem('st-beautifier-api-model', 'gpt-legacy');
    localStorage.setItem('st-beautifier-model-list', JSON.stringify(['a', 'b']));

    const { profiles, activeId } = loadApiProfiles();

    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe('默认');
    expect(profiles[0].apiKey).toBe('sk-legacy');
    expect(profiles[0].apiUrl).toBe('https://relay.example/v1/chat/completions');
    expect(profiles[0].model).toBe('gpt-legacy');
    expect(profiles[0].modelList).toEqual(['a', 'b']);
    expect(activeId).toBe(profiles[0].id);
    // 旧 key 已清理
    expect(localStorage.getItem('st-beautifier-openai-key')).toBeNull();
    expect(localStorage.getItem('st-beautifier-model-list')).toBeNull();
  });

  it('无任何配置时迁移出一个空的默认提供商（缺省地址/模型）', () => {
    const { profiles } = loadApiProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].apiKey).toBe('');
    expect(profiles[0].apiUrl).toBe(DEFAULT_API_URL);
    expect(profiles[0].model).toBe(DEFAULT_MODEL);
  });

  it('坏 JSON 当作未初始化，走迁移而非抛错', () => {
    localStorage.setItem(PROFILES_KEY, '{不是合法 JSON');
    const { profiles } = loadApiProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe('默认');
  });

  it('activeId 指向不存在的提供商时回退到第一个', () => {
    const ps: ApiProfile[] = [
      { id: 'p1', name: 'A', apiKey: 'k1', apiUrl: DEFAULT_API_URL, model: 'm1' },
      { id: 'p2', name: 'B', apiKey: 'k2', apiUrl: DEFAULT_API_URL, model: 'm2' },
    ];
    localStorage.setItem(PROFILES_KEY, JSON.stringify(ps));
    localStorage.setItem(ACTIVE_KEY, 'gone');

    const { activeId } = loadApiProfiles();
    expect(activeId).toBe('p1');
    expect(getActiveProfile().id).toBe('p1');
  });

  it('saveAPIConfig / loadAPIConfig 只写读活跃提供商', () => {
    const ps: ApiProfile[] = [
      { id: 'p1', name: 'A', apiKey: 'k1', apiUrl: DEFAULT_API_URL, model: 'm1' },
      { id: 'p2', name: 'B', apiKey: 'k2', apiUrl: DEFAULT_API_URL, model: 'm2' },
    ];
    persistProfiles(ps, 'p2');

    saveAPIConfig({ apiKey: 'k2-new', apiUrl: 'https://x/y', model: 'm2-new' });

    const cfg = loadAPIConfig();
    expect(cfg).toEqual({ apiKey: 'k2-new', apiUrl: 'https://x/y', model: 'm2-new' });
    // p1 不受影响
    const { profiles } = loadApiProfiles();
    expect(profiles.find((p) => p.id === 'p1')?.apiKey).toBe('k1');
  });

  it('clearAPIConfig 清空活跃提供商凭据但保留该提供商与其名称', () => {
    const ps: ApiProfile[] = [
      { id: 'p1', name: '主号', apiKey: 'k1', apiUrl: 'https://x/y', model: 'm1', modelList: ['a'] },
    ];
    persistProfiles(ps, 'p1');

    clearAPIConfig();

    const { profiles } = loadApiProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe('主号');
    expect(profiles[0].apiKey).toBe('');
    expect(profiles[0].apiUrl).toBe(DEFAULT_API_URL);
    expect(profiles[0].model).toBe(DEFAULT_MODEL);
    expect(profiles[0].modelList).toEqual([]);
  });
});
