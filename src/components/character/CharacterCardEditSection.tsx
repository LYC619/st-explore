import { FileText, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { CardEdits } from '@/lib/card-export';

function Field({
  label,
  hint,
  value,
  onChange,
  multiline = true,
  className = '',
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  className?: string;
}) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-[color:var(--character-label)]">{label}</span>
        {hint && <span className="text-[11px] text-[color:var(--text-muted)]">{hint}</span>}
      </span>
      {multiline ? (
        <Textarea value={value} onChange={(event) => onChange(event.target.value)} className="min-h-[92px] text-sm leading-relaxed" />
      ) : (
        <Input size="lg" value={value} onChange={(event) => onChange(event.target.value)} className="text-sm" />
      )}
    </label>
  );
}

interface CharacterCardEditSectionProps {
  edits: CardEdits;
  displayName: string;
  onEditChange: <K extends keyof CardEdits>(key: K, value: CardEdits[K]) => void;
  onDisplayNameChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  saving: boolean;
}

export function CharacterCardEditSection({
  edits,
  displayName,
  onEditChange,
  onDisplayNameChange,
  onSave,
  saving,
}: CharacterCardEditSectionProps) {
  return (
    <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-[color:var(--brand-hi)]" />
            <h2 className="font-serif text-base font-semibold text-[color:var(--text-primary)]">角色卡编辑</h2>
          </div>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">修改人设与台词时会完整保留卡内自带的世界书、正则及扩展内容。</p>
        </div>
        <Button size="sm" onClick={() => void onSave()} disabled={saving}>
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {saving ? '保存中…' : '保存修改'}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="实际名" hint="导出与对话时的卡内角色名" value={edits.name} onChange={(value) => onEditChange('name', value)} multiline={false} />
        <Field label="展示名" hint="仅在本地收藏馆显示，不改原卡" value={displayName} onChange={onDisplayNameChange} multiline={false} />
        <Field label="角色昵称" hint="对话称呼或爱称" value={edits.nickname} onChange={(value) => onEditChange('nickname', value)} multiline={false} />
        <Field label="卡师 / 创作者" value={edits.creator} onChange={(value) => onEditChange('creator', value)} multiline={false} />
        <Field label="卡面版本" hint="如 v1.2 / 精修版" value={edits.characterVersion} onChange={(value) => onEditChange('characterVersion', value)} multiline={false} />
        <Field label="性格特征" value={edits.personality} onChange={(value) => onEditChange('personality', value)} />
        <Field label="人设与外貌设定" value={edits.description} onChange={(value) => onEditChange('description', value)} className="md:col-span-2" />
        <Field label="初见背景与场景" value={edits.scenario} onChange={(value) => onEditChange('scenario', value)} className="md:col-span-2" />
        <Field label="对话范例" value={edits.messageExample} onChange={(value) => onEditChange('messageExample', value)} />
        <Field label="卡师食用说明" hint="推荐预设、排雷与玩法提示" value={edits.creatorNotes} onChange={(value) => onEditChange('creatorNotes', value)} />
        <Field label="角色扮演主指令" value={edits.systemPrompt} onChange={(value) => onEditChange('systemPrompt', value)} />
        <Field label="楼层尾追加指令" hint="防破防或文风加固提示" value={edits.postHistoryInstructions} onChange={(value) => onEditChange('postHistoryInstructions', value)} />
      </div>
    </section>
  );
}
