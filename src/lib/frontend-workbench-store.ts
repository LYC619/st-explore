import { getArchiveStory, getBranchLine, getRoleplayPreferences, updateArchiveStory } from '@/lib/archive-db';
import { getCurrentRepo } from '@/lib/repo';
import { normalizeCharacterCard } from '@/lib/png-parser';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import type { RegexCollectionItem } from '@/types/regex';
import { createRuntimeStore, type RuntimeStore } from '@/lib/roleplay/runtime-store';
import { branchKey } from '@/lib/roleplay/paths';
import { digest, stableJson } from '@/lib/roleplay/fingerprint';
import { createRoleplayRegexAssets } from '@/lib/roleplay/regex-assets';
import { embeddedRegexState, withoutEmbeddedRegex } from '@/lib/roleplay/embedded-regex';
import { getVaultEpoch } from '@/lib/vault/active';
import { acquireStoryMaintenance } from '@/lib/story-activity';
import { emptyFrontend, validateFrontend, type FrontendDraft, type FrontendState } from '@/lib/frontend-workbench';
import { importHelperScripts } from '@/lib/roleplay/helper-settings';
import type { STRegexScript } from '@/lib/st-regex-interop';
import type { WorldBookItem } from '@/types/worldbook';
import { FRONTEND_SCRIPT_PREFIX } from '@/lib/roleplay/frontend-scripts';

export const frontendPath = (branchId: string | null) => `.ste-control/roleplay/${branchKey(branchId)}/frontend.json`;
export async function readFrontendState(store: RuntimeStore, branchId: string | null): Promise<{ text: string | null; state: FrontendState }> {
  const text = await store.read(frontendPath(branchId));
  if (!text) return { text, state: { schema: 1, draft: emptyFrontend(), applied: null } };
  const state = JSON.parse(text) as FrontendState;
  if (state.schema !== 1) throw new Error('成品前端版本无法读取');
  validateFrontend(state.draft); if (state.applied) validateFrontend(state.applied);
  return { text, state };
}
async function context(story: ArchiveStory, branchId: string | null) {
  const line = getBranchLine(story, branchId);
  if (!line) throw new Error('故事或分支不存在');
  const character = story.characterId ? await getCurrentRepo<ArchiveCharacter>('characters').get(story.characterId) : undefined;
  const regexes = getCurrentRepo<RegexCollectionItem>('regexes');
  const [linked, embedded, preferences] = await Promise.all([
    createRoleplayRegexAssets({ regexes, storyAssets: story.assets, characterAssets: character?.assets }).read(),
    embeddedRegexState(character, regexes), getRoleplayPreferences(),
  ]);
  const data = character ? normalizeCharacterCard(character.card) : undefined;
  const original = withoutEmbeddedRegex(Array.isArray(data?.extensions?.regex_scripts) ? data.extensions.regex_scripts as STRegexScript[] : [], embedded);
  const rules = [
    ...linked.globalScripts.map(script => ({ lane: 'globalScripts' as const, script })),
    ...[...original, ...linked.embeddedScripts].map(script => ({ lane: 'embeddedScripts' as const, script: { ...script, id: script.id || 'ste-source-' + digest(stableJson(script)) } })),
  ];
  const scripts = (data?.extensions?.tavern_helper as { scripts?: unknown[] } | undefined)?.scripts;
  const source: FrontendDraft = { ...emptyFrontend(), source: character?.name ?? story.title, rules,
    scripts: Array.isArray(scripts) && scripts.length ? importHelperScripts(scripts) : [] };
  const books = character?.assets?.filter(ref => ref.kind === 'worldbook') ?? [];
  const primary = books.find(ref => ref.relations?.includes('primary'))
    ?? (character?.roleplayWorldbookDisabled ? undefined : books.find(ref => !ref.relations?.length) ?? books.find(ref => ref.relations?.includes('embedded')));
  const worldbook = primary ? await getCurrentRepo<WorldBookItem>('worldbooks').get(primary.assetId) : undefined;
  const helper = preferences.installedTavernHelper;
  const helperSettings = (preferences.tavern?.extension_settings as { tavern_helper?: { script?: { enabled?: { global?: boolean } } } } | undefined)?.tavern_helper;
  // Tavern saves UI preferences asynchronously after navigation. Only the
  // executable environment belongs to this editor's application baseline.
  const helperEnvironment = { package: helper ? [helper.version, helper.sourceCommit, helper.installedAt] : null,
    scriptsEnabled: helperSettings?.script?.enabled?.global !== false };
  return { source, session: line.session, characterId: character?.id, primaryWorldbook: worldbook?.title ?? '未绑定',
    helperVersion: preferences.installedTavernHelper?.version,
    revision: digest(stableJson({ session: line.session, source, bindings: [story.assets, character?.assets], helperEnvironment })) };
}
export async function loadFrontend(storyId: string, branchId: string | null) {
  const epoch = getVaultEpoch();
  const story = await getArchiveStory(storyId);
  if (!story) throw new Error('故事不存在');
  const [stored, target] = await Promise.all([readFrontendState(createRuntimeStore(storyId), branchId), context(story, branchId)]);
  if (epoch !== getVaultEpoch()) throw new Error('文件库已切换');
  return { ...stored, ...target };
}
export async function saveFrontend(storyId: string, branchId: string | null, draft: FrontendDraft,
  baseline: string | null, targetRevision: string, operation: 'draft' | 'apply' | 'remove') {
  const value = validateFrontend(draft), epoch = getVaultEpoch();
  const store = createRuntimeStore(storyId).underStoryLock!;
  const release = acquireStoryMaintenance(storyId);
  let saved = '';
  try {
    const updated = await updateArchiveStory(storyId, async story => {
      if (epoch !== getVaultEpoch()) throw new Error('文件库已切换');
      if (!getBranchLine(story, branchId)) throw new Error('故事或分支不存在');
      const current = await readFrontendState(store, branchId);
      if (current.text !== baseline) throw new Error('成品前端已在其他位置修改，请重新载入；当前草稿可先导出');
      if (operation !== 'draft') {
        const target = await context(story, branchId);
        if (target.revision !== targetRevision) throw new Error('聊天、来源资源或助手设置已变化，请保存草稿并重新载入后应用');
        if (operation === 'apply' && value.scripts.some(script => script.enabled) && !target.helperVersion) throw new Error('启用配套脚本需要先在聊天中安装原版酒馆助手');
        const settings = (await getRoleplayPreferences()).tavern?.extension_settings as { tavern_helper?: { script?: { enabled?: { global?: boolean } } } } | undefined;
        if (operation === 'apply' && value.scripts.some(script => script.enabled) && settings?.tavern_helper?.script?.enabled?.global === false) throw new Error('原版助手的全局脚本总开关已关闭，请先在助手面板开启再应用');
        if (operation === 'apply') for (const { script } of value.rules) {
          if (script.disabled) continue;
          const literal = script.findRegex.match(/^\/(.*)\/([a-z]*)$/s);
          try { new RegExp(literal ? literal[1] : script.findRegex, literal ? literal[2] : ''); }
          catch { throw new Error(`正则无效：${script.scriptName}；草稿可继续保存`); }
        }
      }
      if (epoch !== getVaultEpoch()) throw new Error('文件库已切换');
      const applied = operation === 'apply' ? structuredClone(value) : operation === 'draft' ? current.state.applied : null;
      if (operation === 'apply' && applied && current.state.applied) for (const script of applied.scripts) {
        const existing = current.state.applied.scripts.find(item => item.id === script.id);
        if (existing) script.data = structuredClone(existing.data);
      }
      saved = JSON.stringify({ schema: 1, draft: value, applied } satisfies FrontendState);
      await store.write(frontendPath(branchId), saved);
      return undefined;
    });
    if (!updated) throw new Error('故事不存在');
    return saved;
  } finally { release(); }
}

/** Original Helper script variables belong to this applied copy, never its global preferences. */
export async function persistFrontendScriptData(storyId: string, branchId: string | null, chatKey: string, incoming: unknown[]) {
  const epoch = getVaultEpoch(), store = createRuntimeStore(storyId).underStoryLock!;
  const prefix = FRONTEND_SCRIPT_PREFIX + digest(chatKey).slice(0, 20) + ':';
  const scripts = new Map<string, Record<string, unknown>>();
  const walk = (items: unknown[]) => { for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const script = item as { id?: string; data?: Record<string, unknown>; scripts?: unknown[] };
    if (script.id?.startsWith(prefix) && script.data && typeof script.data === 'object' && !Array.isArray(script.data)) scripts.set(script.id, script.data);
    if (Array.isArray(script.scripts)) walk(script.scripts);
  } };
  walk(incoming);
  if (!scripts.size) return;
  await updateArchiveStory(storyId, async story => {
    if (epoch !== getVaultEpoch() || !getBranchLine(story, branchId)) throw new Error('文件库或故事已切换');
    const { state } = await readFrontendState(store, branchId);
    if (!state.applied) return undefined;
    let changed = false;
    for (const script of state.applied.scripts) {
      const data = script.enabled ? scripts.get(prefix + script.id) : undefined;
      if (!data || stableJson(data) === stableJson(script.data)) continue;
      if (JSON.stringify(data).length > 512 * 1024) throw new Error('前端脚本变量不能超过 512 KiB');
      script.data = structuredClone(data); changed = true;
    }
    if (changed) { validateFrontend(state.applied); await store.write(frontendPath(branchId), JSON.stringify(state)); }
    return undefined;
  });
}
