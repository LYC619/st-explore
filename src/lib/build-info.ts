import { tr } from '@/lib/i18n';

export interface BuildInfo {
  version?: string;
  commit?: string | null;
  dirty?: boolean | null;
  builtAt?: string | null;
}

export const BUILD_INFO: BuildInfo = typeof __STE_BUILD_INFO__ === 'undefined' ? {} : __STE_BUILD_INFO__;

export function formatBuildInfo(info: BuildInfo = {}, fallbackVersion = tr('未知')): string {
  const date = info.builtAt && Number.isFinite(Date.parse(info.builtAt))
    ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(info.builtAt))
    : tr('时间未知');
  const state = info.dirty === true ? tr(' · 含未提交改动') : info.dirty == null ? tr(' · 改动状态未知') : '';
  return `${info.version || fallbackVersion} · ${info.commit || tr('提交未知')} · ${date}${state}`;
}
