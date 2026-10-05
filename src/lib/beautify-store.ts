import { getArchiveStory, getBranchLine, updateArchiveStory } from '@/lib/archive-db';
import { createRuntimeStore } from '@/lib/roleplay/runtime-store';
import { branchKey } from '@/lib/roleplay/paths';
import { normalizeHelperSettings, type HelperScript } from '@/lib/roleplay/helper-settings';
import { DEFAULT_BEAUTIFY, mergeBeautifySettings, normalizeBeautifyConfig, type BeautifyConfig } from '@/lib/beautify';
import { getVaultEpoch } from '@/lib/vault/active';

const pathOf = (branchId: string | null) => `.ste-control/roleplay/${branchKey(branchId)}/helpers.json`;
export async function loadBeautify(storyId: string, branchId: string | null) {
  const epoch = getVaultEpoch();
  const story = await getArchiveStory(storyId);
  if (epoch !== getVaultEpoch()) throw new Error('文件库已切换');
  if (!story || !getBranchLine(story, branchId)) throw new Error('故事或分支不存在');
  const text = await createRuntimeStore(storyId).read(pathOf(branchId));
  if (epoch !== getVaultEpoch()) throw new Error('文件库已切换');
  const settings = normalizeHelperSettings(text ? JSON.parse(text) : {});
  const stored = settings.scripts.find(s => s.id === 'ste-beautify-status')?.data.steBeautify;
  const config = stored ? normalizeBeautifyConfig(stored) : structuredClone(DEFAULT_BEAUTIFY);
  config.statusEnabled = settings.scripts.some(script => script.id === 'ste-beautify-status' && script.enabled);
  config.mvuEnabled = settings.scripts.some(script => script.id === 'ste-beautify-mvu' && script.enabled);
  return { config, text, settings };
}

export async function saveBeautify(storyId: string, branchId: string | null, config: BeautifyConfig, baseline: string | null, imported: HelperScript[] = []) {
  const epoch = getVaultEpoch(), store = createRuntimeStore(storyId).underStoryLock!;
  let savedText = '';
  const updated = await updateArchiveStory(storyId, async story => {
    if (epoch !== getVaultEpoch()) throw new Error('文件库已切换');
    if (!getBranchLine(story, branchId)) throw new Error('分支不存在');
    const current = await store.read(pathOf(branchId));
    if (current !== baseline) throw new Error('聊天脚本设置已变化，请重新载入后再保存');
    const settings = normalizeHelperSettings(current ? JSON.parse(current) : {});
    if (imported.some(s => settings.scripts.some(existing => existing.id === s.id))) throw new Error('导入脚本的 ID 已存在，请在聊天脚本面板编辑已有脚本');
    savedText = JSON.stringify(mergeBeautifySettings({ ...settings, scripts: [...settings.scripts, ...imported] }, config));
    await store.write(pathOf(branchId), savedText);
    return undefined;
  });
  if (!updated) throw new Error('故事不存在');
  return savedText;
}
