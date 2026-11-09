// API 提供商的持久化与领域逻辑（无 UI）。
// 全应用唯一的 AI 配置数据层：多提供商存 localStorage，客户端镜像到系统配置目录。
// 拆自原 APIConfigCard.tsx（阶段8.1 codex P2.1：把 460 行 God 组件的持久化层独立、可单测）。
import { canPersistApiProfiles, mirrorApiProfilesToSystem } from '@/lib/vault/sensitive-config';
import { notifyApiProfilesChanged } from './api-profile-events';

// 旧单配置 keys（仅用于一次性迁移到多提供商）
const LEGACY_KEY = 'st-beautifier-openai-key';
const LEGACY_URL = 'st-beautifier-api-url';
const LEGACY_MODEL = 'st-beautifier-api-model';
const LEGACY_MODEL_LIST = 'st-beautifier-model-list';

const PROFILES_KEY = 'st-beautifier-api-profiles';
const ACTIVE_KEY = 'st-beautifier-api-active-profile';

export const DEFAULT_API_URL = 'https://api.openai.com/v1/chat/completions';
export const DEFAULT_MODEL = 'gpt-4o-mini';

export interface APIConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
}

/** 一个 API 提供商配置（OpenAI 兼容）。模型列表属于该提供商的元数据。 */
export interface ApiProfile extends APIConfig {
  id: string;
  name: string;
  modelList?: string[];
  /** User choices survive refreshing a provider's advertised model catalogue. */
  favoriteModels?: string[];
}

export interface ApiModelSelection { profileId: string; model: string }

/** Keyless custom/local services remain supported; an empty OpenAI default cannot authenticate. */
export function isApiProfileConfigured(profile: ApiProfile): boolean {
  return !!profile.model.trim() && !!profile.apiUrl.trim()
    && (!!profile.apiKey.trim() || !/^https?:\/\/api\.openai\.com(?:[:/]|$)/i.test(profile.apiUrl.trim()));
}

export function normalizeModelNames(values: unknown): string[] {
  return Array.isArray(values) ? [...new Set(values.flatMap(value => typeof value === 'string' && value.trim() ? [value.trim()] : []))] : [];
}

export function profileModels(profile: ApiProfile): string[] {
  return normalizeModelNames([profile.model, ...normalizeModelNames(profile.favoriteModels), ...normalizeModelNames(profile.modelList)]);
}

export function generateProfileId(): string {
  return `api_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function persistProfiles(profiles: ApiProfile[], activeId: string): boolean {
  if (!canPersistApiProfiles()) return false;
  const json = JSON.stringify(profiles);
  localStorage.setItem(PROFILES_KEY, json);
  localStorage.setItem(ACTIVE_KEY, activeId);
  // 客户端同时镜像到系统配置目录（阶段7.6：Key 不进库、不怕 webview 数据被清）
  mirrorApiProfilesToSystem(json, activeId);
  notifyApiProfilesChanged();
  return true;
}

/** 读取全部提供商；首次调用时把旧的单配置 4 个 key 迁移成「默认」提供商并清掉旧 key。 */
export function loadApiProfiles(): { profiles: ApiProfile[]; activeId: string } {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (raw) {
      const profiles = JSON.parse(raw) as ApiProfile[];
      if (Array.isArray(profiles)) {
        if (!profiles.length) return { profiles: [], activeId: '' };
        if (!profiles.every(p => p && typeof p.id === 'string' && typeof p.name === 'string'
          && typeof p.apiKey === 'string' && typeof p.apiUrl === 'string' && typeof p.model === 'string')) return { profiles: [], activeId: '' };
        const stored = localStorage.getItem(ACTIVE_KEY);
        const activeId = profiles.some((p) => p.id === stored) ? (stored as string) : profiles[0].id;
        return { profiles, activeId };
      }
    }
  } catch { return { profiles: [], activeId: '' }; }

  // A read/cache miss never creates a saved provider. Only migrate actual legacy credentials.
  const legacyKey = localStorage.getItem(LEGACY_KEY);
  const legacyUrl = localStorage.getItem(LEGACY_URL);
  if ((!legacyKey && (!legacyUrl || legacyUrl === DEFAULT_API_URL)) || !canPersistApiProfiles()) {
    return { profiles: [], activeId: '' };
  }

  let modelList: string[] = [];
  try { modelList = JSON.parse(localStorage.getItem(LEGACY_MODEL_LIST) || '[]'); } catch { /* ignore */ }
  const first: ApiProfile = {
    id: generateProfileId(),
    name: '默认',
    apiKey: localStorage.getItem(LEGACY_KEY) || '',
    apiUrl: localStorage.getItem(LEGACY_URL) || DEFAULT_API_URL,
    model: localStorage.getItem(LEGACY_MODEL) || DEFAULT_MODEL,
    modelList,
  };
  persistProfiles([first], first.id);
  [LEGACY_KEY, LEGACY_URL, LEGACY_MODEL, LEGACY_MODEL_LIST].forEach((k) => localStorage.removeItem(k));
  return { profiles: [first], activeId: first.id };
}

export function getActiveProfile(): ApiProfile | undefined {
  const { profiles, activeId } = loadApiProfiles();
  return profiles.find((p) => p.id === activeId) ?? profiles[0];
}

/** A late catalog response belongs only to the exact connection that requested it. */
export function storeProfileModelsIfCurrent(profile: Pick<ApiProfile, 'id' | 'apiUrl' | 'apiKey'>, models: string[]): boolean {
  const { profiles, activeId } = loadApiProfiles();
  const index = profiles.findIndex(item => item.id === profile.id && item.apiUrl === profile.apiUrl && item.apiKey === profile.apiKey);
  if (index < 0) return false;
  profiles[index] = { ...profiles[index], modelList: normalizeModelNames(models) };
  return persistProfiles(profiles, activeId);
}

export function getActiveModelSelection(): ApiModelSelection {
  const profile = getActiveProfile();
  return { profileId: profile?.id ?? '', model: profile?.model ?? '' };
}

/** Fresh value for one request; subsequent switches never mutate this snapshot. */
export function getAPIConfigForSelection(selection: ApiModelSelection): APIConfig | undefined {
  const profile = loadApiProfiles().profiles.find(item => item.id === selection.profileId);
  if (!profile || !selection.model.trim()) return undefined;
  return { apiKey: profile.apiKey, apiUrl: profile.apiUrl || DEFAULT_API_URL, model: selection.model.trim() };
}

export function activateApiModel(selection: ApiModelSelection): boolean {
  const { profiles } = loadApiProfiles();
  const index = profiles.findIndex(profile => profile.id === selection.profileId);
  if (index < 0 || !selection.model.trim()) return false;
  profiles[index] = { ...profiles[index], model: selection.model.trim() };
  return persistProfiles(profiles, selection.profileId);
}

export function setProfileModelFavorite(profileId: string, model: string, favorite: boolean): boolean {
  const { profiles, activeId } = loadApiProfiles();
  const index = profiles.findIndex(profile => profile.id === profileId), name = model.trim();
  if (index < 0 || !name) return false;
  const current = normalizeModelNames(profiles[index].favoriteModels);
  profiles[index] = { ...profiles[index], favoriteModels: favorite ? normalizeModelNames([...current, name]) : current.filter(value => value !== name) };
  return persistProfiles(profiles, activeId);
}

/** 兼容旧签名：返回活跃提供商的调用配置。全部 AI 调用点（总结/故事树/世界书/批量）继续用它。 */
export function loadAPIConfig(): APIConfig {
  const p = getActiveProfile();
  return {
    apiKey: p?.apiKey || '',
    apiUrl: p?.apiUrl || DEFAULT_API_URL,
    model: p?.model || DEFAULT_MODEL,
  };
}

/** 兼容旧签名：写入活跃提供商。 */
export function saveAPIConfig(config: APIConfig): void {
  const { profiles, activeId } = loadApiProfiles();
  const idx = profiles.findIndex((p) => p.id === activeId);
  if (idx < 0) {
    if (!config.apiKey.trim()) return;
    const first = { ...config, id: generateProfileId(), name: '默认' };
    persistProfiles([first], first.id);
    return;
  }
  profiles[idx] = { ...profiles[idx], ...config };
  persistProfiles(profiles, activeId);
}

/** 兼容旧签名：清空活跃提供商的凭据（不删除该提供商）。 */
export function clearAPIConfig(): void {
  const { profiles, activeId } = loadApiProfiles();
  const idx = profiles.findIndex((p) => p.id === activeId);
  if (idx < 0) return;
  profiles[idx] = { ...profiles[idx], apiKey: '', apiUrl: DEFAULT_API_URL, model: DEFAULT_MODEL, modelList: [] };
  persistProfiles(profiles, activeId);
}
