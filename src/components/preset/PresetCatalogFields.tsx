import type { PresetCatalog } from '@/types/preset';
import { PRESET_STATUS_LABELS } from '@/lib/preset-catalog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export const catalogSelectClass = 'h-8 min-w-0 rounded-md border border-[color:var(--border-normal)] bg-[var(--surface-elevated)] px-2 text-sm';

/** All fields are optional; import and management use the same vocabulary. */
export function PresetCatalogFields({ value, onChange, compact = false }: {
  value: PresetCatalog; onChange: (value: PresetCatalog) => void; compact?: boolean;
}) {
  const set = (patch: Partial<PresetCatalog>) => onChange({ ...value, ...patch });
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-3">
      {([
        ['author', '作者', '如：作者 A'], ['series', '系列', '如：日常游玩'],
        ['version', '版本号', '如：v2.1'], ['variant', '变体', '如：Claude 版 / DIY'],
      ] as const).map(([key, label, placeholder]) => <label key={key} className="space-y-1 text-xs">
        <span>{label}</span><Input value={value[key] ?? ''} placeholder={placeholder} onChange={e => set({ [key]: e.target.value })} />
      </label>)}
    </div>
    {([
      ['models', '适配模型', 'Claude，Gemini 或具体型号'], ['purposes', '用途', '游玩，写卡，总结'], ['tags', '标签', '自定义标签，以逗号分隔'],
    ] as const).map(([key, label, placeholder]) => <label key={key} className="block space-y-1 text-xs">
      <span>{label}</span><Input value={(value[key] ?? []).join('，')} placeholder={placeholder} onChange={e => set({ [key]: e.target.value.split(/[,，\n]/) })} />
    </label>)}
    <div className="grid grid-cols-2 gap-3">
      <label className="flex flex-col gap-1 text-xs">标记依据
        <select className={catalogSelectClass} value={value.modelBasis ?? 'manual'} onChange={e => set({ modelBasis: e.target.value as PresetCatalog['modelBasis'] })}>
          <option value="manual">我的标记</option><option value="author">作者声明</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">使用状态
        <select className={catalogSelectClass} value={value.status ?? 'unreviewed'} onChange={e => set({ status: e.target.value as PresetCatalog['status'] })}>
          {Object.entries(PRESET_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
    </div>
    <label className="block space-y-1 text-xs">作者发布说明
      <Textarea value={value.releaseNotes ?? ''} placeholder="粘贴作者的更新说明、安装步骤和注意事项；也可随预设选择 MD / TXT 文件" onChange={e => set({ releaseNotes: e.target.value })} />
    </label>
    <label className="block space-y-1 text-xs">来源链接<Input value={value.sourceUrl ?? ''} placeholder="作者发布页地址" onChange={e => set({ sourceUrl: e.target.value })} /></label>
    {!compact && <>
      <label className="block space-y-1 text-xs">发布日期<Input type="date" value={value.publishedAt ?? ''} onChange={e => set({ publishedAt: e.target.value })} /></label>
      <label className="block space-y-1 text-xs">模型适配补充<Textarea value={value.modelNotes ?? ''} onChange={e => set({ modelNotes: e.target.value })} placeholder="具体型号、渠道差异；自动识别和作者声明不等于实测" /></label>
      <label className="block space-y-1 text-xs">代表卡片<Input value={(value.representativeCards ?? []).join('，')} onChange={e => set({ representativeCards: e.target.value.split(/[,，\n]/) })} placeholder="卡片名称，以逗号分隔" /></label>
      <label className="block space-y-1 text-xs">我的使用笔记<Textarea value={value.notes ?? ''} onChange={e => set({ notes: e.target.value })} placeholder="个人感受和待办，与作者说明分开记录" /></label>
    </>}
  </div>;
}
