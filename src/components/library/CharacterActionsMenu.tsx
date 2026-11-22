import { BookOpen, ExternalLink, MessageSquare, MoreVertical, Sparkles, Trash2, Upload } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface CharacterActionsMenuProps {
  onOpen: () => void;
  onReminisceStory?: () => void;
  onContinueChat?: () => void;
  onOpenGreetings?: () => void;
  onExport: () => void;
  onDelete: () => void;
  /** 桌面卡面已有快捷胶囊时隐藏重复项（触屏仍保留完整菜单） */
  hasQuickPills?: boolean;
  /** 触发按钮的类名：卡面上是悬浮圆钮，列表行里是方钮 */
  triggerClassName: string;
  iconClassName?: string;
}

/**
 * 角色卡的操作菜单（主页 / 回味或续聊 / 赏玩开场 / 导出 / 删除）。
 * 触屏设备不把快捷胶囊铺满 2:3 小卡面，统一在此提供 44px 易点的快捷入口。
 */
export function CharacterActionsMenu({
  onOpen,
  onReminisceStory,
  onContinueChat,
  onOpenGreetings,
  onExport,
  onDelete,
  hasQuickPills = false,
  triggerClassName,
  iconClassName,
}: CharacterActionsMenuProps) {
  const hideOnHoverDesktop = hasQuickPills ? '[@media(hover:hover)]:hidden' : '';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <button type="button" aria-label="更多操作" className={triggerClassName}>
          <MoreVertical className={cn('w-3.5 h-3.5', iconClassName)} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem className={hideOnHoverDesktop} onClick={onOpen}>
          <ExternalLink className="w-3.5 h-3.5 mr-2" />
          打开角色主页
        </DropdownMenuItem>
        {onContinueChat && (
          <DropdownMenuItem className={hideOnHoverDesktop} onClick={onContinueChat}>
            <MessageSquare className="w-3.5 h-3.5 mr-2 text-brand" />
            接着上次续聊
          </DropdownMenuItem>
        )}
        {onReminisceStory && (
          <DropdownMenuItem className={hideOnHoverDesktop} onClick={onReminisceStory}>
            <BookOpen className="w-3.5 h-3.5 mr-2" />
            回味最近故事
          </DropdownMenuItem>
        )}
        {onOpenGreetings && (
          <DropdownMenuItem
            className={!onContinueChat && !onReminisceStory ? hideOnHoverDesktop : ''}
            onClick={onOpenGreetings}
          >
            <Sparkles className="w-3.5 h-3.5 mr-2" />
            赏玩开场白
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator className={onOpenGreetings && (onContinueChat || onReminisceStory) ? '' : hideOnHoverDesktop} />
        <DropdownMenuItem onClick={onExport}>
          <Upload className="w-3.5 h-3.5 mr-2" />
          导出角色卡
        </DropdownMenuItem>
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5 mr-2" />
          删除角色
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
