import { useEffect, useState } from 'react';
import { Globe, MessageSquare, Regex as RegexIcon, SlidersHorizontal, Sparkles } from 'lucide-react';
import type { NormalizedCharacterCard } from '@/lib/png-parser';
import { presetOptionLabel } from '@/lib/preset-catalog';
import { getAllPresets } from '@/lib/preset-db';
import { getAllRegexCollections } from '@/lib/regex-db';
import { cn } from '@/lib/utils';
import { subscribeActiveVault } from '@/lib/vault/active';
import { getAllWorldBooks } from '@/lib/worldbook-db';
import type { ArchiveCharacter } from '@/types/archive';

interface CharacterLoadoutBarProps {
  character: ArchiveCharacter;
  norm: NormalizedCharacterCard;
  onSelectTab: (tab: string) => void;
}

interface LoadoutSummary {
  worldbooks: string[];
  presets: string[];
  regexes: string[];
  failed: {
    worldbook: boolean;
    preset: boolean;
    regex: boolean;
  };
}

const INITIAL_SUMMARY: LoadoutSummary = {
  worldbooks: [],
  presets: [],
  regexes: [],
  failed: { worldbook: false, preset: false, regex: false },
};

export function CharacterLoadoutBar({
  character,
  norm,
  onSelectTab,
}: CharacterLoadoutBarProps) {
  const [summary, setSummary] = useState<LoadoutSummary>(INITIAL_SUMMARY);
  const [vaultTick, setVaultTick] = useState(0);

  useEffect(() => subscribeActiveVault(() => setVaultTick((n) => n + 1)), []);

  useEffect(() => {
    let cancelled = false;
    const refs = character.assets ?? [];
    if (refs.length === 0) {
      setSummary(INITIAL_SUMMARY);
      return;
    }
    Promise.allSettled([
      getAllWorldBooks(),
      getAllPresets(),
      getAllRegexCollections(),
    ]).then(([wbRes, presetRes, regexRes]) => {
      if (cancelled) return;
      const wbs = wbRes.status === 'fulfilled' ? wbRes.value : [];
      const presets = presetRes.status === 'fulfilled' ? presetRes.value : [];
      const regexes = regexRes.status === 'fulfilled' ? regexRes.value : [];

      if (wbRes.status === 'rejected') console.error('[CharacterLoadoutBar] worldbook read failed:', wbRes.reason);
      if (presetRes.status === 'rejected') console.error('[CharacterLoadoutBar] preset read failed:', presetRes.reason);
      if (regexRes.status === 'rejected') console.error('[CharacterLoadoutBar] regex read failed:', regexRes.reason);

      const wbMap = new Map(wbs.map((item) => [item.id, item.title]));
      const presetMap = new Map(presets.map((item) => [item.id, presetOptionLabel(item)]));
      const regexMap = new Map(regexes.map((item) => [item.id, item.title]));

      const worldbooks: string[] = [];
      const linkedPresets: string[] = [];
      const linkedRegexes: string[] = [];

      for (const ref of refs) {
        if (ref.kind === 'worldbook' && wbMap.has(ref.assetId)) {
          worldbooks.push(wbMap.get(ref.assetId)!);
        } else if (ref.kind === 'preset' && presetMap.has(ref.assetId)) {
          linkedPresets.push(presetMap.get(ref.assetId)!);
        } else if (ref.kind === 'regex' && regexMap.has(ref.assetId)) {
          linkedRegexes.push(regexMap.get(ref.assetId)!);
        }
      }
      setSummary({
        worldbooks,
        presets: linkedPresets,
        regexes: linkedRegexes,
        failed: {
          worldbook: wbRes.status === 'rejected',
          preset: presetRes.status === 'rejected',
          regex: regexRes.status === 'rejected',
        },
      });
    });

    return () => {
      cancelled = true;
    };
  }, [character.assets, vaultTick]);

  const refs = character.assets ?? [];
  const wbRefCount = refs.filter((r) => r.kind === 'worldbook').length;
  const presetRefCount = refs.filter((r) => r.kind === 'preset').length;
  const regexRefCount = refs.filter((r) => r.kind === 'regex').length;

  const rawEntries =
    typeof norm.characterBook === 'object' && norm.characterBook !== null && 'entries' in norm.characterBook
      ? (norm.characterBook as { entries?: unknown }).entries
      : null;
  const embeddedBookEntries =
    typeof rawEntries === 'object' && rawEntries !== null
      ? Object.keys(rawEntries).length
      : 0;
  const embeddedRegexCount = Array.isArray(norm.extensions?.regex_scripts)
    ? norm.extensions.regex_scripts.length
    : 0;
  const embeddedScriptCount = Array.isArray(norm.extensions?.TavernHelper_scripts)
    ? norm.extensions.TavernHelper_scripts.length
    : 0;
  const embeddedBeautifyCount = embeddedRegexCount + embeddedScriptCount;
  const greetingCount = (norm.firstMessage.trim() ? 1 : 0)
    + norm.alternateGreetings.filter((g) => g.trim()).length;

  const wbLabel = summary.failed.worldbook && wbRefCount > 0
    ? `已关联 ${wbRefCount} 本（暂未读出）`
    : summary.worldbooks.length > 0
      ? summary.worldbooks.length === 1
        ? summary.worldbooks[0]
        : `${summary.worldbooks[0]} 等 ${summary.worldbooks.length} 本`
      : embeddedBookEntries > 0
        ? `卡内自带 (${embeddedBookEntries} 条)`
        : '未挂世界书';

  const presetLabel = summary.failed.preset && presetRefCount > 0
    ? `已关联 ${presetRefCount} 套（暂未读出）`
    : summary.presets.length > 0
      ? summary.presets[0]
      : '默认预设';

  const regexLabel = summary.failed.regex && regexRefCount > 0
    ? `已关联 ${regexRefCount} 套（暂未读出）`
    : summary.regexes.length > 0
      ? summary.regexes.length === 1
        ? summary.regexes[0]
        : `${summary.regexes.length} 套正则`
      : embeddedBeautifyCount > 0
        ? `卡内自带 (${embeddedBeautifyCount} 项)`
        : '无专属正则';

  const pills = [
    {
      key: 'worldbook',
      icon: Globe,
      title: '世界书',
      value: wbLabel,
      active: summary.worldbooks.length > 0 || embeddedBookEntries > 0 || (summary.failed.worldbook && wbRefCount > 0),
      onClick: () => onSelectTab('assets'),
      hint: '点击查看或调整角色关联的世界书',
    },
    {
      key: 'preset',
      icon: SlidersHorizontal,
      title: '预设',
      value: presetLabel,
      active: summary.presets.length > 0 || (summary.failed.preset && presetRefCount > 0),
      onClick: () => onSelectTab('assets'),
      hint: summary.presets.length > 0 ? '点击管理这张角色卡已关联的预设' : '点击在关联资产页为这张角色卡绑定预设',
    },
    {
      key: 'regex',
      icon: RegexIcon,
      title: '正则与美化',
      value: regexLabel,
      active: summary.regexes.length > 0 || embeddedBeautifyCount > 0 || (summary.failed.regex && regexRefCount > 0),
      onClick: () => onSelectTab('assets'),
      hint: '点击查看正则清理规则或状态栏美化脚本',
    },
    {
      key: 'greetings',
      icon: MessageSquare,
      title: '开场白',
      value: greetingCount > 0 ? `${greetingCount} 段可赏玩` : '待填写',
      active: greetingCount > 0,
      onClick: () => onSelectTab('greetings'),
      hint: '点击进入开场白剧场赏玩或直接选段开聊',
    },
  ];

  return (
    <div
      data-character-loadout-bar
      aria-label="当前角色挂载装备概览"
      className="mx-3 sm:mx-6 mt-2.5 flex items-center gap-2 overflow-x-auto rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] px-3 py-2 scrollbar-thin"
    >
      <span className="flex items-center gap-1 shrink-0 text-[11px] font-medium text-[color:var(--character-label)] pr-1 border-r border-[color:var(--hairline-inner)]">
        <Sparkles className="h-3 w-3 text-brand" />
        当前装备
      </span>
      {pills.map((pill) => {
        const Icon = pill.icon;
        return (
          <button
            key={pill.key}
            type="button"
            title={pill.hint}
            onClick={pill.onClick}
            className={cn(
              'tap-target flex items-center gap-1.5 shrink-0 rounded-lg px-2.5 py-1 text-xs transition-colors border',
              pill.active
                ? 'border-brand/30 bg-[var(--brand-active-bg)] text-[color:var(--text-primary)] hover:border-brand/60'
                : 'border-transparent bg-chrome/70 text-[color:var(--text-muted)] hover:bg-[var(--hover-overlay)] hover:text-[color:var(--text-body)]',
            )}
          >
            <Icon className={cn('h-3.5 w-3.5 shrink-0', pill.active ? 'text-brand' : 'text-[color:var(--text-muted)]')} />
            <span className="text-[11px] text-[color:var(--character-label)]">{pill.title}</span>
            <span className="max-w-36 truncate font-medium">{pill.value}</span>
          </button>
        );
      })}
    </div>
  );
}
