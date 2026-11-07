/**
 * 归档列表的轻量读取（阶段 D1）。
 *
 * 由来：首页/角色库/工具页/全局搜索/资产库都只是「拿几个字段渲染一份列表」，
 * 却都走 getAllCharacters() / getAllArchiveStories() 把整库读进内存——
 * 上百张卡的库里，这意味着每次进页面都要把每张卡的 PNG 原图和每个故事的全部正文
 * 读出来、克隆一遍、再扔掉。
 *
 * 这里提供两个只含元信息的窄类型，配合 Repo.listLight() 的后端投影：
 * - 客户端文件库：角色跳过 卡片.png 的整趟 IPC；故事读完立刻剥掉正文。
 * - 网页版 IDB：没有字段投影能力，读取量不变，但结果同样收窄，
 *   大字段随即可被回收，反复翻页不再堆着整库。
 *
 * 列表记录只用于展示。角色的大字段是可选字段，TypeScript 的结构类型不能
 * 阻止把投影传给 saveCharacter；修改必须通过 updateCharacter 读取当前完整记录，
 * 导出必须通过 buildCharacterExportSnapshot，不能直接写回列表项。
 * 要完整记录请照旧用 archive-db 的 getAllCharacters / getArchiveStory。
 */
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import { createRepo } from '@/lib/repo';
import { toStoryIndex, type StoryIndexEntry } from './story-index';
export { toStoryIndex, type StoryIndexEntry } from './story-index';

/** 角色列表项：整份档案减去卡面原图与立绘（后者在网页版是内联 base64，同样是大块） */
export type CharacterIndexEntry = Omit<ArchiveCharacter, 'pngBase64' | 'portraitRows'>;

const characterRepo = createRepo<ArchiveCharacter>('characters');
const storyRepo = createRepo<ArchiveStory>('archiveStories');

/**
 * 两个 to*Index 必须幂等：文件库后端返回的已经是投影过的记录（无 session、已带 floorCount），
 * IDB 后端返回的是完整记录。同一个函数要能吃下两种输入。
 */
export function toCharacterIndex(c: ArchiveCharacter): CharacterIndexEntry {
  const { pngBase64, portraitRows, ...rest } = c;
  return rest;
}

/** 角色库列表项，按 updatedAt 降序（同 getAllCharacters） */
export async function listCharacterIndex(): Promise<CharacterIndexEntry[]> {
  return (await characterRepo.listLight()).map(toCharacterIndex);
}

/** 归档故事列表项，按 updatedAt 降序（同 getAllArchiveStories） */
export async function listStoryIndex(): Promise<StoryIndexEntry[]> {
  return (await storyRepo.listLight()).map(toStoryIndex);
}
