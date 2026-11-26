import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useEffect, useState } from 'react';
import { Globe, Regex as RegexIcon, SlidersHorizontal } from 'lucide-react';
import type { NormalizedCharacterCard } from '@/lib/png-parser';
import { presetOptionLabel } from '@/lib/preset-catalog';
import { getAllPresets } from '@/lib/preset-db';
import { getAllRegexCollections } from '@/lib/regex-db';
import { subscribeActiveVault } from '@/lib/vault/active';
import { getAllWorldBooks } from '@/lib/worldbook-db';
import type { ArchiveCharacter } from '@/types/archive';

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

export interface LoadoutBadgeItem {
  key: 'worldbook' | 'preset' | 'regex';
  icon: typeof Globe;
  title: string;
  value: string;
  hint: string;
}

export function useCharacterLoadoutBadges(
  character: ArchiveCharacter,
  norm: NormalizedCharacterCard,
): LoadoutBadgeItem[] {
  useI18n();
  const [summary, setSummary] = useState<LoadoutSummary>(INITIAL_SUMMARY);
  const [vaultTick, setVaultTick] = useState(0);

  useEffect(() => subscribeActiveVault(() => setVaultTick((n) => n + 1)), []);

  useEffect(() => {
    let cancelled = false;
    setSummary(INITIAL_SUMMARY);
    const refs = character.assets ?? [];
    if (refs.length === 0) {
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

      if (wbRes.status === 'rejected') console.error('[CharacterLoadout] worldbook read failed:', wbRes.reason);
      if (presetRes.status === 'rejected') console.error('[CharacterLoadout] preset read failed:', presetRes.reason);
      if (regexRes.status === 'rejected') console.error('[CharacterLoadout] regex read failed:', regexRes.reason);

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
  }, [character.id, character.assets, vaultTick]);

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

  const badges: LoadoutBadgeItem[] = [];

  if (summary.failed.worldbook && wbRefCount > 0) {
    badges.push({
      key: 'worldbook',
      icon: Globe,
      title: tr("世界书"),
      value: tr("已关联 {{v0}} 本（暂未读出）", { v0: wbRefCount }),
      hint: tr("点击查看或重新读取角色关联的世界书"),
    });
  } else if (summary.worldbooks.length > 0) {
    badges.push({
      key: 'worldbook',
      icon: Globe,
      title: tr("世界书"),
      value: summary.worldbooks.length === 1
        ? summary.worldbooks[0]
        : tr("{{v0}} 等 {{v1}} 本", { v0: summary.worldbooks[0], v1: summary.worldbooks.length }),
      hint: tr("点击查看或调整角色关联的世界书"),
    });
  } else if (embeddedBookEntries > 0) {
    badges.push({
      key: 'worldbook',
      icon: Globe,
      title: tr("世界书"),
      value: tr("卡内自带 {{v0}} 条", { v0: embeddedBookEntries }),
      hint: tr("点击查看或提取卡内自带世界书"),
    });
  }

  if (summary.failed.preset && presetRefCount > 0) {
    badges.push({
      key: 'preset',
      icon: SlidersHorizontal,
      title: tr("预设"),
      value: tr("已关联 {{v0}} 套（暂未读出）", { v0: presetRefCount }),
      hint: tr("点击查看或重新读取角色关联的预设"),
    });
  } else if (summary.presets.length > 0) {
    badges.push({
      key: 'preset',
      icon: SlidersHorizontal,
      title: tr("预设"),
      value: summary.presets.length === 1
        ? summary.presets[0]
        : tr("{{v0}} 等 {{v1}} 套", { v0: summary.presets[0], v1: summary.presets.length }),
      hint: tr("点击管理这张角色卡已关联的预设"),
    });
  }

  if (summary.failed.regex && regexRefCount > 0) {
    badges.push({
      key: 'regex',
      icon: RegexIcon,
      title: tr("正则与美化"),
      value: tr("已关联 {{v0}} 套（暂未读出）", { v0: regexRefCount }),
      hint: tr("点击查看或重新读取正则清理规则"),
    });
  } else if (summary.regexes.length > 0) {
    badges.push({
      key: 'regex',
      icon: RegexIcon,
      title: tr("正则与美化"),
      value: summary.regexes.length === 1
        ? summary.regexes[0]
        : tr("{{v0}} 套正则", { v0: summary.regexes.length }),
      hint: tr("点击查看正则清理规则或状态栏美化脚本"),
    });
  } else if (embeddedBeautifyCount > 0) {
    badges.push({
      key: 'regex',
      icon: RegexIcon,
      title: tr("正则与美化"),
      value: tr("卡内自带 {{v0}} 项", { v0: embeddedBeautifyCount }),
      hint: tr("点击查看卡内自带正则规则与美化脚本"),
    });
  }

  return badges;
}
