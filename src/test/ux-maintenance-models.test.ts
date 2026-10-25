import { describe, expect, it } from 'vitest';
import { THEMES, themeSwatchBackground } from '@/lib/theme';
import { NAV_AREAS, findNavArea, matchesNavDestination, presetLibraryRedirect } from '@/lib/navigation-model';
import {
  EDITOR_TOOL_COPY,
  horizontalWheelDelta,
  storyWorkspaceViewForEditorFocus,
} from '@/lib/home-layout';
import { shouldAutoCollapse } from '@/hooks/use-sidenav-state';
import {
  activateVaultProfile,
  createEmptyVaultRegistry,
  upsertVaultProfile,
} from '@/lib/vault/vault-registry';

describe('维护阶段 UX 规则模型', () => {
  it('主题缩略图保留可辨识的特征色，而不是三个近黑圆点', () => {
    expect(new Set(THEMES.slice(0, 3).map((theme) => theme.swatchAccent)).size).toBe(3);
    for (const theme of THEMES) {
      expect(themeSwatchBackground(theme)).toContain('linear-gradient');
    }
  });

  it('导航按六个一级区域组织（含独立预设库），并包含要求的子界面', () => {
    expect(NAV_AREAS.map((area) => area.key)).toEqual(['home', 'chats', 'characters', 'presets', 'editor', 'assets']);
    const labels = NAV_AREAS.flatMap((area) => area.children.map((item) => item.label));
    expect(labels).toEqual(expect.arrayContaining(['聊天处理', '总结', '故事树', '角色卡', '预设', '正则', '其他资产']));
    expect(findNavArea('/assets', '?tab=worldbook')?.key).toBe('assets');
    expect(findNavArea('/library', '')?.key).toBe('characters');
  });

  it('世界书选择页归编辑区，预设选择页归独立预设库', () => {
    const editor = NAV_AREAS.find((area) => area.key === 'editor');
    const worldbook = editor?.children.find((item) => item.key === 'worldbook');
    const preset = editor?.children.find((item) => item.key === 'preset');

    expect(worldbook).toBeDefined();
    expect(preset).toBeDefined();
    expect(matchesNavDestination(worldbook!, '/tools', '?focus=worldbook')).toBe(true);
    expect(matchesNavDestination(worldbook!, '/worldbook', '?assetId=demo')).toBe(true);
    expect(matchesNavDestination(worldbook!, '/tools', '?focus=preset')).toBe(false);
    expect(matchesNavDestination(preset!, '/tools', '?focus=preset')).toBe(false);
    expect(matchesNavDestination(preset!, '/preset', '?assetId=demo')).toBe(true);
    expect(matchesNavDestination(preset!, '/tools', '?focus=worldbook')).toBe(false);
    expect(matchesNavDestination(preset!, '/presets', '?mode=select')).toBe(false);
    expect(matchesNavDestination(editor!, '/presets', '')).toBe(false);
    expect(findNavArea('/presets', '?presetId=demo')?.key).toBe('presets');
    expect(findNavArea('/presets', '?mode=select')?.key).toBe('presets');
    expect(findNavArea('/preset', '?assetId=demo&characterId=c')?.key).toBe('editor');
    expect(NAV_AREAS.find(area => area.key === 'assets')!.children.map(child => child.key)).not.toContain('preset');
  });

  it('预设旧深链保留选中项和上下文，移除旧容器参数', () => {
    expect(presetLibraryRedirect('?tab=preset&presetId=p%26one&from=bookmark')).toBe('/presets?presetId=p%26one&from=bookmark');
    expect(presetLibraryRedirect('?focus=preset&assetId=p%26one&characterId=c', true)).toBe('/presets?characterId=c&presetId=p%26one&mode=select');
    expect(presetLibraryRedirect('?tab=preset')).toBe('/presets');
  });

  it('离开首页才触发自动折叠，非首页之间切换不强制覆盖用户选择', () => {
    expect(shouldAutoCollapse('/', '/library')).toBe(true);
    expect(shouldAutoCollapse('/', '/settings')).toBe(true);
    expect(shouldAutoCollapse('/library', '/settings')).toBe(false);
    expect(shouldAutoCollapse('/', '/')).toBe(false);
  });

  it('首页编辑入口用一句用途说明功能边界', () => {
    expect(EDITOR_TOOL_COPY.chat).toContain('聊天');
    expect(EDITOR_TOOL_COPY.chat).toContain('正则');
    expect(EDITOR_TOOL_COPY.summaryAndTree).toContain('故事树');
  });

  it('首页角色轨道把纵向滚轮换算成横向位移，并保留触控板横向手势', () => {
    expect(horizontalWheelDelta(0, 120)).toBe(120);
    expect(horizontalWheelDelta(0, -80)).toBe(-80);
    expect(horizontalWheelDelta(45, 8)).toBe(45);
    expect(horizontalWheelDelta(-60, -12)).toBe(-60);
    expect(horizontalWheelDelta(0, 3, 1, 800)).toBe(96);
    expect(horizontalWheelDelta(0, 1, 2, 720)).toBe(720);
  });

  it('多库注册按路径去重，激活只改变活动库标识', () => {
    const first = createEmptyVaultRegistry();
    const one = upsertVaultProfile(first, 'D:/demo', '演示库');
    const duplicate = upsertVaultProfile(one.registry, 'D:/demo/', '改名');
    expect(duplicate.registry.vaults).toHaveLength(1);
    expect(duplicate.profile.id).toBe(one.profile.id);
    const second = upsertVaultProfile(duplicate.registry, 'D:/private', '私人库');
    const active = activateVaultProfile(second.registry, second.profile.id);
    expect(active.activeId).toBe(second.profile.id);
    expect(active.vaults).toHaveLength(2);
  });

  it('总结和故事树入口能把用户带入对应故事工作台视图', () => {
    expect(storyWorkspaceViewForEditorFocus('summary')).toBe('volume');
    expect(storyWorkspaceViewForEditorFocus('story-tree')).toBe('tree');
    expect(storyWorkspaceViewForEditorFocus(null)).toBeNull();
  });
});
