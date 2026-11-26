import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
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
  triggerClassName,
  iconClassName,
}: CharacterActionsMenuProps) {
  useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <button type="button" aria-label={tr("更多操作")} className={triggerClassName}>
          <MoreVertical className={cn('w-3.5 h-3.5', iconClassName)} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={onOpen}>
          <ExternalLink className="w-3.5 h-3.5 mr-2" />{tr("打开角色主页")}</DropdownMenuItem>
        {onContinueChat && (
          <DropdownMenuItem onClick={onContinueChat}>
            <MessageSquare className="w-3.5 h-3.5 mr-2 text-brand" />{tr("接着上次续聊")}</DropdownMenuItem>
        )}
        {onReminisceStory && (
          <DropdownMenuItem onClick={onReminisceStory}>
            <BookOpen className="w-3.5 h-3.5 mr-2" />{tr("回味最近故事")}</DropdownMenuItem>
        )}
        {onOpenGreetings && (
          <DropdownMenuItem onClick={onOpenGreetings}>
            <Sparkles className="w-3.5 h-3.5 mr-2" />{tr("赏玩开场白")}</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onExport}>
          <Upload className="w-3.5 h-3.5 mr-2" />{tr("导出角色卡")}</DropdownMenuItem>
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5 mr-2" />{tr("删除角色")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
