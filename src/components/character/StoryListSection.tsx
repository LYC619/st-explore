import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
/**
 * 角色页故事列表（10.3b，对照 character-detail.html）：
 * 每行 = 名称·N楼·相对时间 / ☆评分（行内 popover 0.5 步进）+ 字数 / 状态 chip（四档可改）
 * / 三按钮 阅读·处理·导出；分支从父故事行下用连线分出，点分支直接就地阅读该分支。
 * 当前就地阅读中的故事左侧高亮条。
 */
import { useRef, useState } from 'react';
import { BookOpen, GitBranch, Pencil, Settings2, Trash2, Upload, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import type { ArchiveStory, StoryStatus } from '@/types/archive';
import { STORY_STATUSES } from '@/lib/archive-db';
import { formatWordCount } from '@/lib/story-meta';
import { formatFullTime } from '@/lib/time-display';
import type { StoryFileFormat } from '@/lib/story-file-export';

interface StoryListSectionProps {
  stories: ArchiveStory[];
  /** 正在就地阅读的故事（高亮条） */
  activeStoryId?: string | null;
  /** 正在独立酒馆窗口对话的故事（禁用改名与删除，防分屏竞争） */
  liveDetachedStoryId?: string | null;
  onRead: (id: string, branchId?: string) => void;
  /** 处理：进聊天处理工作区（编辑器） */
  onProcess: (id: string) => void;
  /** 导出：进工作区「导入与导出」界面 */
  onExport: (id: string) => void;
  onExportFile?: (id: string, branchId: string | null, format: StoryFileFormat) => void;
  onPlay?: (id: string, branchId: string | null) => void;
  onDelete: (story: ArchiveStory) => void;
  onCopy?: (id: string) => void | Promise<void>;
  onPatchStory: (id: string, patch: Partial<ArchiveStory>) => void;
  onRenameStory?: (id: string, title: string) => Promise<void>;
}

/** 状态 chip：点击换四档 */
function StatusChip({ story, onPatch }: { story: ArchiveStory; onPatch: (patch: Partial<ArchiveStory>) => void }) {
  useI18n();
  const status = story.status ?? '未开始';
  const tone: Record<StoryStatus, string> = {
    未开始: 'text-muted-foreground',
    进行中: 'text-[color:var(--status-info)] border-[var(--status-info-bg)]',
    已完结: 'text-[color:var(--status-ok)] border-[var(--status-ok-bg)]',
    已搁置: 'text-[color:var(--status-warn)] border-[var(--status-warn-bg)]',
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button onClick={(e) => e.stopPropagation()} title={tr("点击修改故事状态")} className="tap-target shrink-0">
          <Badge variant="outline" className={cn('h-5 px-1.5 text-[11px] font-normal cursor-pointer hover:bg-accent', tone[status])}>
            {tr(status)}
          </Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        {STORY_STATUSES.map((s) => (
          <DropdownMenuItem key={s} className={s === status ? 'bg-primary/10 text-primary' : ''} onClick={() => onPatch({ status: s })}>
            {tr(s)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function StoryListSection({
  stories,
  activeStoryId,
  liveDetachedStoryId,
  onRead,
  onProcess,
  onExport,
  onExportFile,
  onPlay,
  onDelete,
  onCopy,
  onPatchStory,
  onRenameStory,
}: StoryListSectionProps) {
  useI18n();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const cancellingRef = useRef(false);
  const { toast } = useToast();

  const exportMenu = (storyId: string, branchId: string | null = null) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="px-2.5 text-xs" aria-label={branchId ? tr("导出分支") : tr("导出故事")}>
          <Upload className="w-3.5 h-3.5 mr-1" />{tr("导出")}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onExportFile && <>
          <DropdownMenuItem onClick={() => onExportFile(storyId, branchId, 'jsonl-slim')}>{tr("SillyTavern JSONL（精简）")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onExportFile(storyId, branchId, 'jsonl')}>{tr("完整 JSONL 备份")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onExportFile(storyId, branchId, 'json')}>{tr("完整 JSON 备份")}</DropdownMenuItem>
        </>}
        <DropdownMenuItem onClick={() => onExport(storyId)}>{tr("更多导出与清理选项…")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const beginRename = (story: ArchiveStory) => {
    cancellingRef.current = false;
    setEditingId(story.id);
    setDraft(story.title);
  };

  /** 空名/同名按取消处理（对齐资源管理器的行内重命名）；写库失败保留输入框让用户重试。 */
  const commitRename = async (story: ArchiveStory) => {
    if (cancellingRef.current) {
      cancellingRef.current = false;
      return;
    }
    if (!onRenameStory) return;
    const title = draft.trim();
    if (!title || title === story.title) {
      setEditingId(null);
      return;
    }
    try {
      await onRenameStory(story.id, title);
      setEditingId(null);
    } catch (e) {
      toast({
        title: tr("重命名失败"),
        description: e instanceof Error ? e.message : tr("未能写入故事名称"),
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-2">
      {stories.map((story) => {
        const msgCount = story.session.messages.length;
        const active = story.id === activeStoryId;
        const isLiveDetached = Boolean(liveDetachedStoryId && story.id === liveDetachedStoryId);
        return (
          <div key={story.id}>
            <div
              className={cn(
                'group relative rounded-lg border border-border bg-card hover:shadow-warm transition-all cursor-pointer',
                active && 'border-primary/50',
              )}
              onClick={() => onRead(story.id)}
            >
              {/* 当前故事高亮条 */}
              {active && <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary" />}
              <div className="py-3 px-4 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-48">
                  <p className="font-medium text-sm flex items-center gap-2 min-w-0">
                    {editingId === story.id ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={() => { void commitRename(story); }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                            void commitRename(story);
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            cancellingRef.current = true;
                            setEditingId(null);
                          }
                        }}
                        className="min-w-0 flex-1 rounded border border-primary/50 bg-background px-1.5 py-0.5 text-sm"
                        aria-label={tr("故事名称")}
                      />
                    ) : (
                      <span className="truncate" title={story.title}>{story.title}</span>
                    )}
                    <StatusChip story={story} onPatch={(p) => onPatchStory(story.id, p)} />
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap mt-0.5">
                    <span>{tr("{{v0}} 段聊天", { v0: msgCount })}</span>
                    {story.copiedFrom && <span title={tr("这是包含总结、日记和故事树的独立副本；原故事的成果仍然保留")}>{tr("复制自「{{v0}}」", { v0: story.copiedFrom.title })}</span>}
                    {story.wordCount !== undefined && <span>{formatWordCount(story.wordCount)}</span>}
                    <span title={story.lastViewedAt ? formatFullTime(story.lastViewedAt) : undefined}>
                      {story.lastViewedAt ? tr("{{v0}} 看过", { v0: formatFullTime(story.lastViewedAt) }) : tr("未读")}
                    </span>
                    {story.lastMessageAt != null && <span>{tr("游玩于 ")}{formatFullTime(story.lastMessageAt)}</span>}
                  </p>
                </div>
                {/* 三按钮：阅读 · 处理 · 导出（+重命名/删除/复制故事） */}
                <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Button variant="outline" size="sm" className="px-2.5 text-xs" onClick={() => onRead(story.id)}>
                    <BookOpen className="w-3.5 h-3.5 mr-1" />{tr("阅读")}</Button>
                  <Button variant="outline" size="sm" className="px-2.5 text-xs" onClick={() => onProcess(story.id)} title={tr("进入大屏聊天处理工作区")}>
                    <Settings2 className="w-3.5 h-3.5 mr-1" />{tr("处理")}</Button>
                  {onPlay && <Button variant="outline" size="sm" className="px-2.5 text-xs" onClick={() => onPlay(story.id, null)}>
                    <MessageSquare className="w-3.5 h-3.5 mr-1" />{tr("继续聊天")}</Button>}
                  {exportMenu(story.id)}
                  {onRenameStory && editingId !== story.id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      disabled={isLiveDetached}
                      onClick={() => beginRename(story)}
                      aria-label={tr("重命名故事")}
                      title={isLiveDetached ? tr("当前故事正在独立酒馆窗口对话中，请先结束对话后再改名") : tr("重命名故事")}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hover-reveal text-destructive"
                    disabled={isLiveDetached}
                    onClick={() => onDelete(story)}
                    aria-label={tr("删除故事")}
                    title={isLiveDetached ? tr("当前故事正在独立酒馆窗口对话中，请先结束对话后再删除") : tr("删除故事")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                  {onCopy && <Button variant="ghost" size="sm" title={tr("复制正文、分支、总结、日记和故事树，原故事保持不变")} disabled={!!copying} onClick={() => {
                    setCopying(story.id);
                    void Promise.resolve().then(() => onCopy(story.id))
                      .catch(error => toast({ title: tr("复制失败"), description: String(error), variant: 'destructive' }))
                      .finally(() => setCopying(null));
                  }}>{copying === story.id ? tr("正在复制…") : tr("复制故事")}</Button>}
                </div>
              </div>
            </div>

            {/* 分支：从父故事行下用线分出（左缩进+连线），点击就地阅读该分支 */}
            {(story.branches ?? []).length > 0 && (
              <div className="ml-6 border-l border-border/70">
                {story.branches!.map((b) => (
                  <div key={b.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      className="min-w-0 flex-1 flex items-center gap-2 text-left pl-0 pr-2 py-1 group/branch"
                      onClick={() => onRead(story.id, b.id)}
                      title={tr("阅读分支「{{v0}}」", { v0: b.name })}
                    >
                      <span className="w-4 border-t border-border/70 shrink-0" />
                      <GitBranch className="w-3 h-3 shrink-0 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground group-hover/branch:text-foreground transition-colors truncate" title={b.name}>
                        {b.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground/60 shrink-0">{tr("{{v0}} 段", { v0: b.session.messages.length })}</span>
                    </button>
                    {onPlay && <Button variant="ghost" size="sm" className="text-xs shrink-0" onClick={() => onPlay(story.id, b.id)}>{tr("继续聊天")}</Button>}
                    {exportMenu(story.id, b.id)}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
