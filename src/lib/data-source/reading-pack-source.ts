/**
 * 阅读包这条来源的 DataSource 实现。
 * 解析/预览/还原的细节在 lib/reading-pack/*；这里只把它们接到统一接口上。
 */
import type { DataSource, ImportPlan } from './types';
import type { ParsedReadingPack } from '@/types/reading-pack';
import {
  buildExistingIndex, decide, previewReadingPack,
  restoreCharacter, restoreStory,
} from '@/lib/reading-pack/import';

export interface ReadingPackInput {
  /** 当前请求已经在 worker 中解析的包；inspect/apply 不重复解压。 */
  parsed: ParsedReadingPack;
  /** 展示用来源名（文件名） */
  origin: string;
  /** 本地现有条目的 id→updatedAt，用来判 add/overwrite/skip */
  existing: {
    characters: { id: string; updatedAt: number }[];
    stories: { id: string; updatedAt: number }[];
    summaries: { id: string; updatedAt: number }[];
  };
}

export const readingPackSource: DataSource<ReadingPackInput> = {
  kind: 'reading-pack',
  label: '阅读包文件',
  isAvailable: () => true,

  async inspect(input) {
    const parsed = input.parsed;
    const index = buildExistingIndex(
      input.existing.characters, input.existing.stories, input.existing.summaries,
    );
    const preview = previewReadingPack(parsed, index);
    return {
      kind: 'reading-pack',
      origin: input.origin,
      producedBy: parsed.manifest.producedBy,
      characters: preview.characters,
      stories: preview.stories,
      summaries: preview.summaries,
      totals: preview.totals,
    };
  },

  async apply(input, plan, sink) {
    const parsed = input.parsed;
    const warnings: string[] = [];
    const written = { characters: 0, stories: 0, summaries: 0 };
    let skipped = 0;

    const actionOf = (rows: ImportPlan['characters'], id: string) =>
      rows.find((r) => r.id === id)?.action ?? 'skip';

    const canWrite = (
      action: 'add' | 'overwrite', incoming: { updatedAt: number },
      local: { updatedAt: number } | undefined, label: string,
    ) => {
      if (action === 'overwrite' && local === undefined) {
        warnings.push(`「${label}」在预览后已被删除，已跳过`);
        return false;
      }
      return decide(incoming.updatedAt, local?.updatedAt).action !== 'skip';
    };

    for (const packChar of parsed.characters) {
      const action = actionOf(plan.characters, packChar.id);
      if (action === 'skip') { skipped++; continue; }
      const local = await sink.getCharacter(packChar.id);
      if (!canWrite(action, packChar, local, packChar.name)) { skipped++; continue; }
      const restored = restoreCharacter(parsed, packChar, local);
      if (packChar.cardMediaPath && !restored.pngBase64) {
        warnings.push(`角色「${restored.name}」的卡面图片在包里缺失`);
      }
      await sink.saveCharacter(restored);
      written.characters++;
    }

    for (const packStory of parsed.stories) {
      const action = actionOf(plan.stories, packStory.id);
      if (action === 'skip') { skipped++; continue; }
      const local = await sink.getStory(packStory.id);
      if (!canWrite(action, packStory, local, packStory.title)) { skipped++; continue; }
      await sink.saveStory(restoreStory(packStory, local));
      written.stories++;
    }

    for (const item of parsed.summaries) {
      if (actionOf(plan.summaries, item.id) === 'skip') { skipped++; continue; }
      await sink.saveSummary(item);
      written.summaries++;
    }

    return { written, skipped, warnings };
  },
};
