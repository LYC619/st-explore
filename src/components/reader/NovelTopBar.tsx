import type { ReactNode } from 'react';
import {
  ArrowLeft,
  Bookmark,
  BookOpenCheck,
  Eye,
  EyeOff,
  List,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import type { NovelBookmark, UserFloorMode } from '@/lib/novel-view';
import { cn } from '@/lib/utils';

interface NovelTopBarProps {
  title: string;
  isMobile: boolean;
  chromeVisible: boolean;
  userMode: UserFloorMode;
  onUserModeChange: (mode: UserFloorMode) => void;
  hiddenUserFloors: number;
  hiddenFloors: number;
  showHidden: boolean;
  onShowHiddenChange: (show: boolean) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  sceneGap: number;
  onSceneGapChange: (minutes: number) => void;
  chapterNav: Array<{ title: string; index: number }>;
  novelBookmarks: NovelBookmark[];
  onJumpToPage: (pageIndex: number) => void;
  onRemoveBookmark?: (messageId: string) => void;
  canSuggestChapters: boolean;
  onOpenChapterSuggest: () => void;
  onOpenMobileSettings: () => void;
  onExit: () => void;
  extraActions?: ReactNode;
}

export function NovelTopBar({
  title,
  isMobile,
  chromeVisible,
  userMode,
  onUserModeChange,
  hiddenUserFloors,
  hiddenFloors,
  showHidden,
  onShowHiddenChange,
  fontSize,
  onFontSizeChange,
  sceneGap,
  onSceneGapChange,
  chapterNav,
  novelBookmarks,
  onJumpToPage,
  onRemoveBookmark,
  canSuggestChapters,
  onOpenChapterSuggest,
  onOpenMobileSettings,
  onExit,
  extraActions,
}: NovelTopBarProps) {
  return (
    <div
      data-reader-top-bar
      className={cn(
        'shrink-0 border-b border-border/60 bg-card/75 backdrop-blur-sm',
        isMobile && 'absolute inset-x-0 top-0 z-20 transition-transform duration-200',
        isMobile && !chromeVisible && '-translate-y-full',
      )}
    >
      <div className={cn('flex items-center gap-2 flex-wrap', isMobile ? 'gap-1 px-1.5 py-1' : 'px-4 py-2')}>
        <Button variant="ghost" size="icon" onClick={onExit} aria-label="退出小说视图">
          {isMobile ? <ArrowLeft className="w-4 h-4" /> : <X className="w-4 h-4" />}
        </Button>
        <span
          className={cn(
            'font-display font-semibold text-sm truncate',
            isMobile ? 'min-w-0 flex-1' : 'max-w-[16rem]',
          )}
          title={title}
        >
          {title}
        </span>

        {!isMobile && (
          <Badge variant="outline" className="h-5 px-1.5 text-[11px] text-muted-foreground font-normal gap-1">
            <BookOpenCheck className="w-3 h-3" />小说视图
          </Badge>
        )}
        {!isMobile && userMode === 'hide' && hiddenUserFloors > 0 && (
          <Badge variant="outline" className="h-5 px-1.5 text-[11px] text-muted-foreground font-normal gap-1">
            <EyeOff className="w-3 h-3" />已隐藏 {hiddenUserFloors} 个用户楼层
          </Badge>
        )}
        {!isMobile && hiddenFloors > 0 && (
          <Badge variant="outline" className="h-5 px-1.5 text-[11px] text-muted-foreground font-normal gap-1">
            {showHidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            {showHidden ? `含 ${hiddenFloors} 个隐藏楼层` : `已隐藏 ${hiddenFloors} 个隐藏楼层`}
          </Badge>
        )}

        <div className={cn('flex items-center flex-wrap', isMobile ? 'gap-0.5' : 'ml-auto gap-1.5')}>
          {extraActions}

          {!isMobile && (
            <Select value={userMode} onValueChange={(v) => onUserModeChange(v as UserFloorMode)}>
              <SelectTrigger aria-label="用户楼层显示方式" className="h-8 w-32 text-xs" title="你的发言怎么排：角色回复里通常会承接你的动作，弱化或隐藏读起来更像连贯小说">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weaken">用户楼：弱化</SelectItem>
                <SelectItem value="hide">用户楼：隐藏</SelectItem>
                <SelectItem value="keep">用户楼：保留</SelectItem>
              </SelectContent>
            </Select>
          )}

          {chapterNav.length > 1 && (
            <Popover>
              <PopoverTrigger asChild>
                {isMobile ? (
                  <Button variant="ghost" size="icon" aria-label="章节目录" title="章节目录">
                    <List className="w-4 h-4" />
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="gap-1">
                    <List className="w-3.5 h-3.5" />目录
                  </Button>
                )}
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="end">
                <div className="p-3 border-b font-medium text-sm">章节目录</div>
                <ScrollArea className="max-h-72">
                  <div className="p-2 space-y-0.5">
                    {chapterNav.map((c) => (
                      <button
                        key={c.index}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
                        onClick={() => onJumpToPage(c.index)}
                      >
                        {c.title}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
          )}

          <Popover>
            <PopoverTrigger asChild>
              <Button variant={isMobile ? 'ghost' : 'outline'} size="icon" aria-label="书签列表" title="书签列表">
                <Bookmark className={isMobile ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="end">
              <div className="p-3 border-b font-medium text-sm">书签</div>
              {novelBookmarks.length === 0 ? (
                <p className="px-3 py-5 text-center text-xs text-muted-foreground">还没有收藏书签，点左下角书签图标可随时标记精彩段落</p>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  <div className="py-1">
                    {novelBookmarks.map((bookmark) => (
                      <div key={bookmark.messageId} className="flex items-center">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2 text-left hover:bg-accent transition-colors"
                          onClick={() => onJumpToPage(bookmark.pageIndex)}
                        >
                          <span className="shrink-0 font-mono text-xs text-primary">#{bookmark.floor}</span>
                          <span className="line-clamp-2 text-xs text-muted-foreground" title={bookmark.snippet}>
                            {bookmark.snippet}
                          </span>
                        </button>
                        {onRemoveBookmark && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="mr-1 shrink-0"
                            aria-label={`删除第 ${bookmark.floor} 楼书签`}
                            title="删除书签"
                            onClick={() => onRemoveBookmark(bookmark.messageId)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </PopoverContent>
          </Popover>

          {canSuggestChapters && !isMobile && (
            <Button variant="outline" size="sm" className="gap-1" onClick={onOpenChapterSuggest}>
              <Sparkles className="w-3.5 h-3.5" />AI 章节
            </Button>
          )}

          {isMobile ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="阅读设置"
              title="阅读设置"
              onClick={onOpenMobileSettings}
            >
              <Settings className="w-4 h-4" />
            </Button>
          ) : (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" aria-label="外观设置">
                  <Settings className="w-3.5 h-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 space-y-4" align="end">
                <div>
                  <div className="text-sm font-medium mb-2">字号</div>
                  <Slider aria-label="小说正文字号" value={[fontSize]} onValueChange={([v]) => onFontSizeChange(v)} min={14} max={26} step={1} />
                </div>
                <div>
                  <div className="text-sm font-medium mb-1">场景分隔符</div>
                  <p className="text-[11px] text-muted-foreground mb-2">两楼时间间隔超过设定时长时自动插入 ✦ ✦ ✦</p>
                  <Select value={String(sceneGap)} onValueChange={(v) => onSceneGapChange(parseInt(v, 10))}>
                    <SelectTrigger aria-label="场景分隔时间间隔" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">关闭</SelectItem>
                      <SelectItem value="15">间隔 15 分钟</SelectItem>
                      <SelectItem value="30">间隔 30 分钟</SelectItem>
                      <SelectItem value="60">间隔 60 分钟</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="novel-show-hidden" className="text-sm">显示隐藏楼层</Label>
                  <Checkbox
                    id="novel-show-hidden"
                    checked={showHidden}
                    onCheckedChange={(checked) => onShowHiddenChange(Boolean(checked))}
                  />
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
    </div>
  );
}
