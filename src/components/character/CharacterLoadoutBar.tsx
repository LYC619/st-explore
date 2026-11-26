import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { MessageSquare } from 'lucide-react';
import type { NormalizedCharacterCard } from '@/lib/png-parser';
import { cn } from '@/lib/utils';
import type { ArchiveCharacter } from '@/types/archive';
import { useCharacterLoadoutBadges } from './useCharacterLoadoutBadges';

interface CharacterLoadoutBarProps {
  character: ArchiveCharacter;
  norm: NormalizedCharacterCard;
  onSelectTab: (tab: string) => void;
}

export function CharacterLoadoutBar({
  character,
  norm,
  onSelectTab,
}: CharacterLoadoutBarProps) {
  useI18n();
  const badges = useCharacterLoadoutBadges(character, norm);
  const greetingCount = (norm.firstMessage.trim() ? 1 : 0)
    + norm.alternateGreetings.filter((g) => g.trim()).length;

  if (badges.length === 0 && greetingCount === 0) return null;

  return (
    <div
      data-character-loadout-bar
      aria-label={tr("当前角色挂载装备概览")}
      className="flex flex-wrap items-center gap-1.5"
    >
      {badges.map((pill) => {
        const Icon = pill.icon;
        return (
          <button
            key={pill.key}
            type="button"
            title={pill.hint}
            onClick={() => onSelectTab('assets')}
            className={cn(
              'tap-target inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors border',
              'border-[color:var(--brand-hairline)] bg-[var(--brand-active-bg)] text-[color:var(--text-primary)] hover:border-brand',
            )}
          >
            <Icon className="h-3 w-3 shrink-0 text-brand" />
            <span className="text-[11px] text-[color:var(--character-label)]">{pill.title}</span>
            <span className="max-w-36 truncate font-medium">{pill.value}</span>
          </button>
        );
      })}
      {greetingCount > 0 && (
        <button
          type="button"
          title={tr("点击进入开场白剧场赏玩或直接选段开聊")}
          onClick={() => onSelectTab('greetings')}
          className="tap-target inline-flex items-center gap-1 rounded-full border border-[color:var(--border-subtle)] bg-chrome px-2 py-0.5 text-xs text-[color:var(--text-muted)] hover:bg-[var(--hover-overlay)] hover:text-[color:var(--text-body)] transition-colors"
        >
          <MessageSquare className="h-3 w-3 shrink-0 text-brand" />
          <span className="font-medium">{greetingCount}{tr(" 段开场白")}</span>
        </button>
      )}
    </div>
  );
}
