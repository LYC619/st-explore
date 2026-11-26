import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { ArrowLeft, BookOpenText, ChevronDown, GitBranch, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface ContextStoryOption {
  id: string;
  title: string;
}

export interface ContextBranchOption {
  id: string;
  name: string;
}

interface OrganizeContextBarProps {
  storyTitle: string;
  backLabel: string;
  onBack: () => void;
  onRead: () => void;
  hideReadAction?: boolean;
  onExpandRail?: () => void;
  currentStoryId?: string;
  stories?: ContextStoryOption[];
  onSelectStory?: (storyId: string) => void;
  currentBranchId?: string | null;
  branches?: ContextBranchOption[];
  onSelectBranch?: (branchId: string | null) => void;
}

/** 宽二级栏隐藏或收起时保留故事上下文、故事/支线切换与返回出口。 */
export function OrganizeContextBar({
  storyTitle,
  backLabel,
  onBack,
  onRead,
  hideReadAction,
  onExpandRail,
  currentStoryId,
  stories,
  onSelectStory,
  currentBranchId = null,
  branches = [],
  onSelectBranch,
}: OrganizeContextBarProps) {
  useI18n();
  const currentBranchName = currentBranchId
    ? branches.find((b) => b.id === currentBranchId)?.name ?? tr("支线")
    : null;
  const canSwitchStory = Boolean(onSelectStory && stories && stories.length > 1);
  const canSwitchBranch = Boolean(onSelectBranch && branches.length > 0);
  const hasDropdown = canSwitchStory || canSwitchBranch;

  return (
    <header
      className="flex h-11 w-full shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur-sm"
      data-organize-context-bar
    >
      {onExpandRail && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onExpandRail}
          aria-label={tr("展开故事目录栏")}
          title={tr("展开左侧目录栏（切换总结/故事树/导入导出与书签）")}
        >
          <PanelLeftOpen className="h-4 w-4 text-muted-foreground" />
        </Button>
      )}
      <Button variant="ghost" size="sm" className="px-2 text-muted-foreground shrink-0" onClick={onBack}>
        <ArrowLeft className="mr-1.5 h-4 w-4" />
        <span className="max-w-40 truncate" title={backLabel}>{backLabel}</span>
      </Button>
      <span className="h-4 w-px bg-border shrink-0" aria-hidden="true" />

      {hasDropdown ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="min-w-0 max-w-md justify-start px-2 font-medium"
            >
              <span className="truncate" title={storyTitle}>
                {storyTitle}
                {currentBranchName ? ` · ${currentBranchName}` : ''}
              </span>
              <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto overscroll-contain">
            {canSwitchBranch && onSelectBranch && (
              <>
                <DropdownMenuLabel className="text-xs text-muted-foreground">{tr("当前故事脉络")}</DropdownMenuLabel>
                <DropdownMenuItem
                  className={currentBranchId === null ? 'bg-primary/10 text-primary' : ''}
                  onSelect={() => onSelectBranch(null)}
                >{tr("主线")}</DropdownMenuItem>
                {branches.map((branch) => (
                  <DropdownMenuItem
                    key={branch.id}
                    className={currentBranchId === branch.id ? 'bg-primary/10 text-primary' : ''}
                    onSelect={() => onSelectBranch(branch.id)}
                  >
                    <GitBranch className="mr-1.5 h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="truncate" title={branch.name}>{branch.name}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
            {canSwitchStory && canSwitchBranch && <DropdownMenuSeparator />}
            {canSwitchStory && onSelectStory && stories && (
              <>
                <DropdownMenuLabel className="text-xs text-muted-foreground">{tr("切换同角色故事")}</DropdownMenuLabel>
                {stories.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    className={item.id === currentStoryId ? 'bg-primary/10 text-primary' : ''}
                    onSelect={() => { if (item.id !== currentStoryId) onSelectStory(item.id); }}
                  >
                    <span className="truncate" title={item.title}>{item.title}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={storyTitle}>
          {storyTitle}
          {currentBranchName ? ` · ${currentBranchName}` : ''}
        </p>
      )}

      {hasDropdown && <div className="flex-1" />}

      {!hideReadAction && (
        <Button variant="outline" size="sm" className="shrink-0" onClick={onRead}>
          <BookOpenText className="mr-1.5 h-4 w-4" />{tr("阅读与编辑")}</Button>
      )}
    </header>
  );
}
