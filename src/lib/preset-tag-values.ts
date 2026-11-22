import type { PresetCatalog } from '@/types/preset';

export const PRESET_STATUS_TAGS = ['状态/在用', '状态/备用', '状态/过期'];
export const PRESET_RATING_TAGS = ['评价/优秀', '评价/良好', '评价/及格'];

export function isVersionScopedPresetTag(tag: string): boolean {
  return tag.startsWith('状态/') || tag.startsWith('评价/');
}

export function cleanPresetTags(tags: string[]): string[] {
  const legacy: Record<string, string> = { '状态/使用中': '状态/在用', '状态/已停用': '状态/过期', '状态/deprecated': '状态/过期', '状态/待试用': '状态/备用' };
  const result = [...new Set(tags.map(tag => tag.trim()).map(tag => legacy[tag] ?? tag).filter(tag => tag && !/^(类型|风格)\//.test(tag)))];
  return result.filter((tag, index) => !/^(状态|评价)\//.test(tag) || !result.slice(index + 1).some(next => next.split('/')[0] === tag.split('/')[0]));
}

export function getPresetTags(catalog?: Partial<PresetCatalog>): string[] {
  const tags = cleanPresetTags(catalog?.tags ?? []);
  if (!tags.some(tag => tag.startsWith('状态/'))) {
    const tag = catalog?.status === 'active' ? '状态/在用' : catalog?.status === 'reserve' ? '状态/备用' : catalog?.status === 'retired' ? '状态/过期' : '';
    if (tag) tags.push(tag);
  }
  return tags;
}

export function catalogWithTags(catalog: PresetCatalog, tags: string[]): PresetCatalog {
  const cleaned = cleanPresetTags(tags);
  const status = cleaned.includes('状态/过期')
    ? 'retired'
    : cleaned.includes('状态/在用')
      ? 'active'
      : cleaned.includes('状态/备用')
        ? 'reserve'
        : catalog.status === 'testing'
          ? 'testing'
          : 'unreviewed';
  return { ...catalog, tags: cleaned, status };
}

export function isPresetRetired(catalog?: Partial<PresetCatalog>): boolean {
  return getPresetTags(catalog).includes('状态/过期');
}
