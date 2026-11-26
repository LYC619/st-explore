import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useState } from 'react';
import { BookOpenText, FileText, Pencil, RotateCcw, Save } from 'lucide-react';
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
  const autoRows = multiline
    ? Math.min(18, Math.max(4, value.split('\n').length + 1))
    : undefined;
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-[color:var(--character-label)]">{label}</span>
        {hint && <span className="text-[11px] text-[color:var(--text-muted)]">{hint}</span>}
      </span>
      {multiline ? (
        <Textarea
          value={value}
          rows={autoRows}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-[96px] text-sm leading-relaxed"
        />
      ) : (
        <Input size="lg" value={value} onChange={(event) => onChange(event.target.value)} className="text-sm" />
      )}
    </label>
  );
}

function ReadBlock({
  label,
  hint,
  value,
  className = '',
}: {
  label: string;
  hint?: string;
  value: string;
  className?: string;
}) {
  if (!value.trim()) return null;
  return (
    <article className={`rounded-lg border border-[color:var(--hairline-inner)] bg-[var(--bg-canvas)] px-4 py-3.5 ${className}`}>
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-[color:var(--character-label)]">{label}</h3>
        {hint && <span className="text-[11px] text-[color:var(--text-muted)]">{hint}</span>}
      </header>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[color:var(--text-body)]">
        {value.trim()}
      </p>
    </article>
  );
}

interface CharacterCardEditSectionProps {
  edits: CardEdits;
  displayName: string;
  dirty?: boolean;
  onEditChange: <K extends keyof CardEdits>(key: K, value: CardEdits[K]) => void;
  onDisplayNameChange: (value: string) => void;
  onSave: () => boolean | void | Promise<boolean | void>;
  onDiscard?: () => void;
  saving: boolean;
}

export function CharacterCardEditSection({
  edits,
  displayName,
  dirty = false,
  onEditChange,
  onDisplayNameChange,
  onSave,
  onDiscard,
  saving,
}: CharacterCardEditSectionProps) {
  useI18n();
  const hasProseContent = Boolean(
    edits.description.trim()
    || edits.personality.trim()
    || edits.scenario.trim()
    || edits.creatorNotes.trim()
    || edits.systemPrompt.trim()
    || edits.postHistoryInstructions.trim()
    || edits.messageExample.trim(),
  );
  const [editing, setEditing] = useState(!hasProseContent);

  const handleSaveClick = async () => {
    const result = await onSave();
    if (result !== false) {
      setEditing(false);
    }
  };

  return (
    <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-[color:var(--brand-hi)]" />
            <h2 className="font-serif text-base font-semibold text-[color:var(--text-primary)]">
              {editing ? tr("编辑角色卡设定") : tr("人设与卡片设定")}
            </h2>
          </div>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">
            {editing
              ? tr("修改人设与台词时会完整保留卡内自带的世界书、正则及扩展内容。")
              : tr("通读角色人设、初见场景与卡师说明；点击右侧「编辑设定」即可就地精修并写回角色卡。")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              {dirty && onDiscard ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onDiscard();
                    if (hasProseContent) setEditing(false);
                  }}
                  disabled={saving}
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />{tr("放弃修改")}</Button>
              ) : hasProseContent ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                  <BookOpenText className="mr-1.5 h-3.5 w-3.5" />{tr("返回预览")}</Button>
              ) : null}
              <Button type="button" size="sm" onClick={() => void handleSaveClick()} disabled={saving}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {saving ? tr("保存中…") : tr("保存修改")}
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />{tr("编辑设定")}</Button>
          )}
        </div>
      </div>

      {!editing ? (
        <div className="space-y-3.5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-[color:var(--hairline-inner)] bg-[var(--bg-canvas)] px-4 py-2.5 text-xs">
            <span>
              <span className="text-[color:var(--character-label)]">{tr("实际名：")}</span>
              <span className="font-medium text-[color:var(--text-primary)]">{edits.name || '—'}</span>
            </span>
            <span>
              <span className="text-[color:var(--character-label)]">{tr("展示名：")}</span>
              <span className="font-medium text-[color:var(--text-primary)]">{displayName || tr("跟随实际名")}</span>
            </span>
            {edits.nickname.trim() && (
              <span>
                <span className="text-[color:var(--character-label)]">{tr("昵称：")}</span>
                <span className="text-[color:var(--text-body)]">{edits.nickname}</span>
              </span>
            )}
            {edits.creator.trim() && (
              <span>
                <span className="text-[color:var(--character-label)]">{tr("卡师：")}</span>
                <span className="text-[color:var(--text-body)]">{edits.creator}</span>
              </span>
            )}
            {edits.characterVersion.trim() && (
              <span>
                <span className="text-[color:var(--character-label)]">{tr("版本：")}</span>
                <span className="text-[color:var(--text-body)]">{edits.characterVersion}</span>
              </span>
            )}
          </div>

          <div className="grid gap-3.5 md:grid-cols-2">
            <ReadBlock label={tr("人设与外貌设定")} value={edits.description} className="md:col-span-2" />
            <ReadBlock label={tr("初见背景与场景")} value={edits.scenario} className="md:col-span-2" />
            <ReadBlock label={tr("性格特征")} value={edits.personality} />
            <ReadBlock label={tr("卡师食用说明")} hint={tr("推荐预设、排雷与玩法提示")} value={edits.creatorNotes} />
            <ReadBlock label={tr("角色扮演主指令")} value={edits.systemPrompt} />
            <ReadBlock label={tr("楼层尾追加指令")} hint={tr("防破防或文风加固提示")} value={edits.postHistoryInstructions} />
            <ReadBlock label={tr("对话范例")} value={edits.messageExample} className="md:col-span-2" />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={tr("实际名")} hint={tr("导出与对话时的卡内角色名")} value={edits.name} onChange={(value) => onEditChange('name', value)} multiline={false} />
          <Field label={tr("展示名")} hint={tr("仅在本地收藏馆显示，不改原卡")} value={displayName} onChange={onDisplayNameChange} multiline={false} />
          <Field label={tr("角色昵称")} hint={tr("对话称呼或爱称")} value={edits.nickname} onChange={(value) => onEditChange('nickname', value)} multiline={false} />
          <Field label={tr("卡师 / 创作者")} value={edits.creator} onChange={(value) => onEditChange('creator', value)} multiline={false} />
          <Field label={tr("卡面版本")} hint={tr("如 v1.2 / 精修版")} value={edits.characterVersion} onChange={(value) => onEditChange('characterVersion', value)} multiline={false} />
          <Field label={tr("性格特征")} value={edits.personality} onChange={(value) => onEditChange('personality', value)} />
          <Field label={tr("人设与外貌设定")} value={edits.description} onChange={(value) => onEditChange('description', value)} className="md:col-span-2" />
          <Field label={tr("初见背景与场景")} value={edits.scenario} onChange={(value) => onEditChange('scenario', value)} className="md:col-span-2" />
          <Field label={tr("对话范例")} value={edits.messageExample} onChange={(value) => onEditChange('messageExample', value)} />
          <Field label={tr("卡师食用说明")} hint={tr("推荐预设、排雷与玩法提示")} value={edits.creatorNotes} onChange={(value) => onEditChange('creatorNotes', value)} />
          <Field label={tr("角色扮演主指令")} value={edits.systemPrompt} onChange={(value) => onEditChange('systemPrompt', value)} />
          <Field label={tr("楼层尾追加指令")} hint={tr("防破防或文风加固提示")} value={edits.postHistoryInstructions} onChange={(value) => onEditChange('postHistoryInstructions', value)} />
        </div>
      )}
    </section>
  );
}
