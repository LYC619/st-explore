import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useMemo, useState, useEffect  } from 'react';
import { IdCard, User, FileText, MessageSquare, Tag, BookOpen, Sparkles, Info, Download, Plus, X, Regex, ArrowUpRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { characterBookToWorldBook } from '@/lib/character-book';
import { POSITION_LABELS } from '@/types/worldbook';
import type { NormalizedCharacterCard } from '@/lib/png-parser';
import type { CardEdits } from '@/lib/card-export';

/** 可编辑文本字段；多行用 textarea，单行用 input */
function EditableField({
  icon: Icon, label, value, onChange, multiline = true,
}: {
  icon: typeof User; label: string; value: string;
  onChange: (v: string) => void; multiline?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      {multiline ? (
        <Textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="text-sm min-h-[80px] leading-relaxed" />
      ) : (
        <Input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="text-sm" />
      )}
    </div>
  );
}

interface CharacterCardViewerProps {
  card: NormalizedCharacterCard | null;
  edits: CardEdits | null;
  onEditChange: <K extends keyof CardEdits>(key: K, value: CardEdits[K]) => void;
  onLoadFile: (file: File) => void;
  /** 立绘图片 URL（PNG 卡的原图 data URL；无图时为空 → 不显示） */
  portraitUrl?: string | null;
  /** 暂存内嵌世界书到「世界书」页 */
  onStashWorldBook?: () => void;
  /** 暂存内嵌正则为正则预设 */
  onStashRegex?: () => void;
}

export function CharacterCardEditor({ card, edits, onEditChange, onLoadFile, portraitUrl, onStashWorldBook, onStashRegex }: CharacterCardViewerProps) {
  useI18n();
  const [portraitZoom, setPortraitZoom] = useState(false);
  // 立绘加载失败（如 JSON 卡的 avatar 是坏 URL）→ 不显示，避免破图标
  const [portraitError, setPortraitError] = useState(false);
  useEffect(() => { setPortraitError(false); }, [portraitUrl]);
  const showPortrait = !!portraitUrl && !portraitError;
  // 内嵌世界书（只读展示，编辑用独立的世界书编辑器）
  const bookEntries = useMemo(() => {
    if (!card?.characterBook) return [];
    const wb = characterBookToWorldBook(card.characterBook);
    if (!wb) return [];
    return Object.values(wb.entries);
  }, [card?.characterBook]);

  // 内嵌正则数量（卡内 extensions.regex_scripts）
  const regexCount = useMemo(() => {
    const scripts = card?.extensions?.regex_scripts;
    return Array.isArray(scripts) ? scripts.length : 0;
  }, [card?.extensions]);

  const setArrayItem = (key: 'tags' | 'alternateGreetings', i: number, v: string) => {
    if (!edits) return;
    const next = [...edits[key]];
    next[i] = v;
    onEditChange(key, next);
  };
  const addArrayItem = (key: 'tags' | 'alternateGreetings') => {
    if (!edits) return;
    onEditChange(key, [...edits[key], '']);
  };
  const removeArrayItem = (key: 'tags' | 'alternateGreetings', i: number) => {
    if (!edits) return;
    onEditChange(key, edits[key].filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-4">
      {/* 拖放 / 选择导入 */}
      <Card data-tour="card-import">
        <CardContent className="pt-6">
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onLoadFile(f); }}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border hover:border-primary/50 p-6 cursor-pointer transition-colors"
          >
            <Download className="w-7 h-7 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{tr("拖入或点击选择角色卡（.png / .json，V1/V2/V3）")}</span>
            <span className="text-xs text-muted-foreground/70">{tr("可编辑核心字段并导出；PNG 导入可回写图片")}</span>
            <input type="file" accept=".png,.json,image/png,application/json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onLoadFile(f); e.target.value = ''; }} />
          </label>
        </CardContent>
      </Card>

      {card && edits && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              {showPortrait && (
                <button
                  type="button"
                  onClick={() => setPortraitZoom(true)}
                  className="shrink-0 rounded-md overflow-hidden border border-border hover:ring-2 hover:ring-primary/50 transition"
                  title={tr("点击放大立绘")}
                  aria-label={tr("放大立绘")}
                >
                  <img
                    src={portraitUrl ?? ''}
                    alt={tr("角色立绘")}
                    className="h-24 w-24 object-cover"
                    onError={() => setPortraitError(true)}
                  />
                </button>
              )}
              <CardTitle className="flex items-center gap-2 flex-wrap">
                <IdCard className="w-5 h-5 text-primary" />
                {edits.name || tr("未命名角色")}
                <Badge variant="outline" className="uppercase ml-1">{card.spec}</Badge>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent data-tour="card-fields">
            <div className="pr-1">
              <div className="space-y-4">
                {/* 基本信息：单行字段 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <EditableField icon={IdCard} label={tr("角色名称")} value={edits.name} onChange={(v) => onEditChange('name', v)} multiline={false} />
                  <EditableField icon={IdCard} label={tr("角色昵称")} value={edits.nickname} onChange={(v) => onEditChange('nickname', v)} multiline={false} />
                  <EditableField icon={User} label={tr("卡师 / 作者")} value={edits.creator} onChange={(v) => onEditChange('creator', v)} multiline={false} />
                  <EditableField icon={Info} label={tr("卡面版本")} value={edits.characterVersion} onChange={(v) => onEditChange('characterVersion', v)} multiline={false} />
                </div>

                {/* 标签 */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                    <Tag className="w-3.5 h-3.5" />{tr(" 角色标签")}<Button variant="ghost" size="icon" className="ml-1" onClick={() => addArrayItem('tags')} aria-label={tr("添加标签")}>
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {edits.tags.map((t, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <Input size="sm" value={t} onChange={(e) => setArrayItem('tags', i, e.target.value)} className="text-xs w-32" />
                        <button onClick={() => removeArrayItem('tags', i)} className="text-muted-foreground hover:text-destructive" aria-label={tr("删除标签")}>
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {edits.tags.length === 0 && <span className="text-xs text-muted-foreground">{tr("暂无标签")}</span>}
                  </div>
                </div>

                <EditableField icon={User} label={tr("人设与外观")} value={edits.description} onChange={(v) => onEditChange('description', v)} />
                <EditableField icon={User} label={tr("性格特质")} value={edits.personality} onChange={(v) => onEditChange('personality', v)} />
                <EditableField icon={Info} label={tr("故事背景与舞台")} value={edits.scenario} onChange={(v) => onEditChange('scenario', v)} />
                <EditableField icon={MessageSquare} label={tr("默认开场白")} value={edits.firstMessage} onChange={(v) => onEditChange('firstMessage', v)} />

                {/* 备选开场白（数组） */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                    <MessageSquare className="w-3.5 h-3.5" />{tr(" 备选开场白 · ")}{edits.alternateGreetings.length}
                    <Button variant="ghost" size="icon" className="ml-1" onClick={() => addArrayItem('alternateGreetings')} aria-label={tr("添加备选开场白")}>
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  {edits.alternateGreetings.map((g, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <Textarea value={g} onChange={(e) => setArrayItem('alternateGreetings', i, e.target.value)} className="text-sm min-h-[60px] flex-1" />
                      <button onClick={() => removeArrayItem('alternateGreetings', i)} className="text-muted-foreground hover:text-destructive mt-2" aria-label={tr("删除")}>
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <EditableField icon={FileText} label={tr("台词与文风示例")} value={edits.messageExample} onChange={(v) => onEditChange('messageExample', v)} />
                <EditableField icon={Sparkles} label={tr("扮演守则（卡内系统提示）")} value={edits.systemPrompt} onChange={(v) => onEditChange('systemPrompt', v)} />
                <EditableField icon={Sparkles} label={tr("楼层尾随提醒（防跑偏指令）")} value={edits.postHistoryInstructions} onChange={(v) => onEditChange('postHistoryInstructions', v)} />
                <EditableField icon={FileText} label={tr("作者手记与游玩说明")} value={edits.creatorNotes} onChange={(v) => onEditChange('creatorNotes', v)} />

                {/* 内嵌世界书（只读，编辑请用世界书编辑器） */}
                {bookEntries.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                      <BookOpen className="w-3.5 h-3.5" />{tr("随卡附带世界书 · ")}{bookEntries.length}{tr(" 条（只读，导出角色卡时原样保留）")}{onStashWorldBook && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="px-2 text-xs ml-auto"
                          onClick={onStashWorldBook}
                          title={tr("把这本内嵌世界书暂存到「世界书」页，可在那里编辑/导出")}
                        >
                          <ArrowUpRight className="w-3.5 h-3.5 mr-1" />{tr(" 暂存到世界书")}</Button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {bookEntries.map((e) => (
                        <div key={e.uid} className="rounded-md border border-border p-3 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{e.comment || tr("条目 {{v0}}", { v0: e.uid })}</span>
                            {!e.enabled && <Badge variant="outline" className="text-xs">{tr("已禁用")}</Badge>}
                            {e.constant && <Badge variant="secondary" className="text-xs">{tr("常驻")}</Badge>}
                            <span className="text-xs text-muted-foreground">{POSITION_LABELS[e.position] ?? tr("位置 {{v0}}", { v0: e.position })}</span>
                          </div>
                          {e.key.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap">
                              {e.key.map((k, i) => <Badge key={i} variant="outline" className="text-xs font-mono">{k}</Badge>)}
                            </div>
                          )}
                          <div className="whitespace-pre-wrap text-xs text-muted-foreground leading-relaxed line-clamp-4" title={e.content}>{e.content}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 内嵌正则（暂存为正则预设，到聊天处理页加载） */}
                {regexCount > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                      <Regex className="w-3.5 h-3.5" />{tr("随卡附带正则 · ")}{regexCount}{tr(" 条（导出角色卡时原样保留）")}{onStashRegex && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="px-2 text-xs ml-auto"
                          onClick={onStashRegex}
                          title={tr("把这些内嵌正则存为正则预设，到「聊天处理」页『正则 → 预设管理』里加载")}
                        >
                          <ArrowUpRight className="w-3.5 h-3.5 mr-1" />{tr(" 暂存正则")}</Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{tr("存为正则预设后，可在「聊天处理」页『正则 → 预设管理』中加载，用于处理聊天记录。")}</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 立绘放大查看 */}
      <Dialog open={portraitZoom} onOpenChange={setPortraitZoom}>
        <DialogContent className="!max-w-2xl flex items-center justify-center p-2">
          {portraitUrl && <img src={portraitUrl} alt={tr("角色立绘（放大）")} className="max-h-[80vh] w-auto object-contain rounded-md" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
