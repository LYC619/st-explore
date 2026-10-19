import type { PortraitRow } from '@/types/archive';
import { safeName } from '@/lib/vault/naming';

/** 只写不读的派生快照；档案.json 始终是提交依据。 */
export function buildPortraitSnapshot(rows: PortraitRow[], currentId?: string): Record<string, unknown> {
  return {
    说明: 'STE 生成的立绘结构快照（只写不读）；条目真源在 档案.json 的 portraitRows，改这里不生效',
    当前卡面条目: currentId ?? null,
    行: rows.map((r) => ({
      标题: r.title,
      文件夹: safeName(r.title, '未命名行'),
      图片: r.items.map((i) => ({
        文件: i.fileName ?? '(网页版内嵌)',
        名称: i.name ?? i.fileName ?? '图片',
        来源: i.source === 'manual' ? '手动导入' : '替换自动存档',
        加入时间: new Date(i.addedAt).toLocaleString(),
        ...(i.importSource ? { 导入来源: i.importSource } : {}),
      })),
    })),
  };
}
