import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
/**
 * 编辑区窄工具栏（0816 反馈）：固定在全局侧栏右侧，编辑区内所有页面共用。
 * 聊天处理、总结和故事树共享当前故事；没有记忆时分别回落到各自选择/导入页。
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen, IdCard, MessageSquare, Network, Regex, ScrollText, SlidersHorizontal, Palette, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { findNavArea, matchesRoutePrefix } from '@/lib/navigation-model';
import {
  EDITOR_STORY_CHANGE_EVENT,
  editorStoryPathForNavKey,
  getEditorStoryId,
  matchesEditorStoryNav,
} from '@/lib/editor-story-context';

interface RailItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /** 没有当前故事（或本项不吃故事上下文）时的落点 */
  fallbackPath: string;
  /** 命中当前故事时深链进对应故事视图 */
  storyNav?: boolean;
  /** 按路径前缀判定高亮 */
  prefix?: string;
  /** 在 /tools 选择页上按 focus 参数判定高亮 */
  focus?: string;
}

const RAIL_ITEMS: RailItem[] = [
  { key: 'chat', get label() { return tr("聊天处理"); }, icon: MessageSquare, fallbackPath: '/chat', storyNav: true, prefix: '/chat' },
  { key: 'summary', get label() { return tr("总结"); }, icon: ScrollText, fallbackPath: '/tools?focus=summary', storyNav: true, focus: 'summary' },
  { key: 'story-tree', get label() { return tr("故事树"); }, icon: Network, fallbackPath: '/tools?focus=story-tree', storyNav: true, focus: 'story-tree' },
  { key: 'worldbook', get label() { return tr("世界书"); }, icon: BookOpen, fallbackPath: '/tools?focus=worldbook', prefix: '/worldbook', focus: 'worldbook' },
  { key: 'card', get label() { return tr("角色卡"); }, icon: IdCard, fallbackPath: '/card-viewer', prefix: '/card-viewer' },
  { key: 'preset', get label() { return tr("预设"); }, icon: SlidersHorizontal, fallbackPath: '/presets?mode=select', prefix: '/preset' },
  { key: 'regex', get label() { return tr("正则"); }, icon: Regex, fallbackPath: '/regex', prefix: '/regex' },
  { key: 'beautify', get label() { return tr("美化"); }, icon: Palette, fallbackPath: '/beautify', prefix: '/beautify' },
];

export function EditorRail() {
  useI18n();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [storyId, setStoryId] = useState<string | null>(() => getEditorStoryId());

  useEffect(() => {
    const sync = () => setStoryId(getEditorStoryId());
    window.addEventListener(EDITOR_STORY_CHANGE_EVENT, sync);
    return () => window.removeEventListener(EDITOR_STORY_CHANGE_EVENT, sync);
  }, []);

  if (findNavArea(pathname, search)?.key !== 'editor') return null;

  const focusParam = pathname.startsWith('/tools') ? new URLSearchParams(search).get('focus') : null;

  return (
    <nav
      data-editor-rail
      aria-label={tr("编辑区工具")}
      className="w-16 shrink-0 overflow-y-auto border-r border-[color:var(--border-subtle)] bg-chrome px-1.5 py-2"
    >
      <div className="flex flex-col gap-1">
        {RAIL_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = (item.storyNav ? matchesEditorStoryNav(item.key, pathname, search) : false)
            || (item.prefix ? matchesRoutePrefix(pathname, item.prefix) : false)
            || (item.focus ? focusParam === item.focus : false);
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate((item.storyNav ? editorStoryPathForNavKey(item.key, storyId) : null) ?? item.fallbackPath)}
              title={item.label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex w-full flex-col items-center gap-1 rounded-md px-1 py-2 transition-colors',
                active
                  ? 'bg-[var(--brand-active-bg)] text-brand'
                  : 'text-[color:var(--sidebar-text-muted)] hover:bg-[var(--hover-overlay)] hover:text-[color:var(--sidebar-text)]',
              )}
            >
              {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-brand-accent" />}
              <Icon className="w-[18px] h-[18px]" />
              <span className="whitespace-nowrap text-[11px] leading-none">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
