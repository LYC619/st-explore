import { tr } from '@/lib/i18n';
import { useI18n, useLocalizedMemo } from '@/lib/i18n/react';
import { useMemo, useEffect, useState  } from 'react';
import { GitCompare } from 'lucide-react';
import type { AssetIndexEntry } from '@/lib/asset-index-entry';
import { getPreset } from '@/lib/preset-db';
import { estimateTokens, selectActivePromptOrderGroup } from '@/lib/preset-parser';
import { comparePresetVersions, getPresetPresentation } from '@/lib/preset-presentation';
import { getVaultEpoch } from '@/lib/vault/active';
import { blockDisplayName, PROMPT_ROLE_LABELS, type PresetItem, type PromptBlock } from '@/types/preset';
import { Badge } from '@/components/ui/badge';
import { catalogSelectClass } from './PresetCatalogFields';

const DIFF_PARAM_KEYS: Array<{ key: string; label: string }> = [
  { key: 'temperature', get label() { return tr("温度 (Temperature)"); } },
  { key: 'top_p', get label() { return tr("采样核 (Top P)"); } },
  { key: 'top_k', label: 'Top K' },
  { key: 'min_p', label: 'Min P' },
  { key: 'frequency_penalty', get label() { return tr("频率惩罚"); } },
  { key: 'presence_penalty', get label() { return tr("存在惩罚"); } },
  { key: 'openai_max_context', get label() { return tr("最大上下文"); } },
  { key: 'openai_max_tokens', get label() { return tr("最大回复长度"); } },
  { key: 'assistant_prefill', get label() { return tr("开头预填词"); } },
];

export function PresetContentInspector({
  base,
  versions,
}: {
  base: PresetItem;
  versions: AssetIndexEntry[];
}) {
  useI18n();
  const [opened, setOpened] = useState('');
  const [compareId, setCompareId] = useState('');
  const [compareItem, setCompareItem] = useState<PresetItem | null>(null);
  const [compareError, setCompareError] = useState('');

  const otherVersions = useMemo(
    () => [...versions]
      .filter((v) => v.id !== base.id)
      .sort((a, b) => comparePresetVersions(getPresetPresentation(b).version, getPresetPresentation(a).version) || b.createdAt - a.createdAt),
    [versions, base.id],
  );

  useEffect(() => {
    setCompareId('');
    setCompareItem(null);
    setCompareError('');
  }, [base.id]);

  useEffect(() => {
    if (!compareId) {
      setCompareItem(null);
      setCompareError('');
      return;
    }
    let active = true;
    const epoch = getVaultEpoch();
    setCompareError('');
    void getPreset(compareId)
      .then((loaded) => {
        if (!active || epoch !== getVaultEpoch()) return;
        if (!loaded) throw new Error(tr("对比版本已不存在"));
        setCompareItem(loaded);
      })
      .catch((e) => {
        if (active) setCompareError(e instanceof Error ? e.message : tr("读取对比版本失败"));
      });
    return () => { active = false; };
  }, [compareId]);

  const activeGroup = useMemo(() => selectActivePromptOrderGroup(base.preset), [base.preset]);
  const blockMap = useMemo(() => new Map<string, PromptBlock>(base.preset.prompts.map((b) => [b.identifier, b])), [base.preset.prompts]);

  const orderedRows = useMemo(() => {
    const order = activeGroup?.order ?? [];
    const seen = new Set<string>();
    const active: Array<{ block: PromptBlock; enabled: boolean; inOrder: boolean }> = [];
    for (const entry of order) {
      const block = blockMap.get(entry.identifier);
      if (!block) continue;
      seen.add(entry.identifier);
      active.push({ block, enabled: entry.enabled, inOrder: true });
    }
    const unlinked = base.preset.prompts
      .filter((b) => !seen.has(b.identifier))
      .map((block) => ({ block, enabled: false, inOrder: false }));
    return { active, unlinked };
  }, [activeGroup, base.preset.prompts, blockMap]);

  const diffReport = useLocalizedMemo(() => {
    if (!compareItem) return null;
    const otherGroup = selectActivePromptOrderGroup(compareItem.preset);
    const curEnabled = new Map((activeGroup?.order ?? []).map((o) => [o.identifier, o.enabled]));
    const othEnabled = new Map((otherGroup?.order ?? []).map((o) => [o.identifier, o.enabled]));
    const curPos = new Map((activeGroup?.order ?? []).map((o, idx) => [o.identifier, idx + 1]));
    const othPos = new Map((otherGroup?.order ?? []).map((o, idx) => [o.identifier, idx + 1]));
    const othBlocks = new Map(compareItem.preset.prompts.map((b) => [b.identifier, b]));
    const curBlocks = new Map(base.preset.prompts.map((b) => [b.identifier, b]));

    const paramChanges = DIFF_PARAM_KEYS.flatMap(({ key, label }) => {
      const before = compareItem.preset.originalData[key];
      const after = base.preset.originalData[key];
      if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return [];
      return [{ label, before: before === undefined ? tr("未设") : String(before), after: after === undefined ? tr("未设") : String(after) }];
    });

    const allIds = [...new Set([...curBlocks.keys(), ...othBlocks.keys()])];
    const blockDiffs: Array<{
      id: string;
      name: string;
      kind: 'added' | 'removed' | 'modified' | 'toggled';
      detail: string;
      beforeContent?: string;
      afterContent?: string;
    }> = [];

    for (const id of allIds) {
      const cur = curBlocks.get(id);
      const oth = othBlocks.get(id);
      if (cur && !oth) {
        blockDiffs.push({ id, name: blockDisplayName(cur), kind: 'added', detail: tr("本版新增提示词块"), afterContent: cur.content });
      } else if (!cur && oth) {
        blockDiffs.push({ id, name: blockDisplayName(oth), kind: 'removed', detail: tr("本版已移除该块"), beforeContent: oth.content });
      } else if (cur && oth) {
        const cOn = curEnabled.get(id) ?? false;
        const oOn = othEnabled.get(id) ?? false;
        const cIdx = curPos.get(id);
        const oIdx = othPos.get(id);
        const contentChanged = (cur.content ?? '').trim() !== (oth.content ?? '').trim();
        const metaNotes: string[] = [];
        if (cOn !== oOn) metaNotes.push(cOn ? tr("开关 关闭 → 开启") : tr("开关 开启 → 关闭"));
        if (!cur.marker && (cur.role ?? 'system') !== (oth.role ?? 'system')) {
          metaNotes.push(tr("发送身份 {{v0}} → {{v1}}", { v0: PROMPT_ROLE_LABELS[oth.role ?? 'system'] ?? tr("系统"), v1: PROMPT_ROLE_LABELS[cur.role ?? 'system'] ?? tr("系统") }));
        }
        if ((cur.injection_position === 1 || oth.injection_position === 1) && (cur.injection_position !== oth.injection_position || (cur.injection_depth ?? 4) !== (oth.injection_depth ?? 4))) {
          const bPos = oth.injection_position === 1 ? `@D${oth.injection_depth ?? 4}` : tr("按顺序就地");
          const aPos = cur.injection_position === 1 ? `@D${cur.injection_depth ?? 4}` : tr("按顺序就地");
          metaNotes.push(tr("注入位置 {{v0}} → {{v1}}", { v0: bPos, v1: aPos }));
        }
        if (cIdx !== oIdx) {
          metaNotes.push(tr("激活顺位 {{v0}} → {{v1}}", { v0: oIdx ? tr("第 {{v0}} 位", { v0: oIdx }) : tr("备用库"), v1: cIdx ? tr("第 {{v0}} 位", { v0: cIdx }) : tr("备用库") }));
        }
        if (contentChanged) {
          blockDiffs.push({
            id,
            name: blockDisplayName(cur),
            kind: 'modified',
            detail: [tr("提示词正文已改动"), ...metaNotes].join(' · '),
            beforeContent: oth.content ?? '',
            afterContent: cur.content ?? '',
          });
        } else if (metaNotes.length > 0) {
          blockDiffs.push({
            id,
            name: blockDisplayName(cur),
            kind: 'toggled',
            detail: metaNotes.join(' · '),
          });
        }
      }
    }
    return { paramChanges, blockDiffs };
  }, [activeGroup, base.preset, compareItem]);

  const renderRow = (item: { block: PromptBlock; enabled: boolean; inOrder: boolean }, keyPrefix: string) => {
    const { block, enabled, inOrder } = item;
    const key = `${keyPrefix}-${block.identifier}`;
    const isOpen = opened === key;
    const tokens = block.marker ? 0 : estimateTokens(block.content ?? '');
    return (
      <div key={key} className={`border-b border-[color:var(--border-subtle)] last:border-b-0 ${!enabled && inOrder ? 'opacity-65' : ''}`}>
        <button
          type="button"
          className="w-full min-h-10 py-2 text-left text-sm flex items-center gap-2 flex-wrap"
          aria-expanded={isOpen}
          onClick={() => setOpened(isOpen ? '' : key)}
        >
          <span className="text-muted-foreground w-3 shrink-0">{isOpen ? '−' : '+'}</span>
          <span className="break-words min-w-0 flex-1 font-medium">{blockDisplayName(block)}</span>
          {block.marker ? (
            <Badge variant="outline" className="text-[11px] font-normal">{tr("系统插槽")}</Badge>
          ) : block.injection_position === 1 ? (
            <Badge variant="outline" className="text-[11px] font-normal">@D{block.injection_depth ?? 4}</Badge>
          ) : (
            <Badge variant="outline" className="text-[11px] font-normal">{PROMPT_ROLE_LABELS[block.role ?? 'system'] ?? tr("系统")}</Badge>
          )}
          {!inOrder ? (
            <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">{tr("备用未挂载")}</Badge>
          ) : enabled ? (
            <Badge variant="secondary" className="text-[11px] font-normal text-brand">{tr("已开启")}</Badge>
          ) : (
            <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">{tr("已关闭")}</Badge>
          )}
          {!block.marker && <span className="text-[11px] text-muted-foreground tabular-nums">~{tokens} tok</span>}
        </button>
        {isOpen && (
          <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed max-h-[55dvh] overflow-y-auto rounded-md bg-[var(--hover-overlay)] p-3 mb-3">
            {block.marker ? tr("系统动态插槽（对话时由酒馆填入聊天历史、角色人设或世界书）") : (block.content || tr("（空提示词块）"))}
          </pre>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4" data-preset-content-inspector>
      {otherVersions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--hover-overlay)] px-3 py-2 text-xs">
          <GitCompare className="h-3.5 w-3.5 text-brand shrink-0" />
          <span className="text-muted-foreground">{tr("对比同系列其他版本：")}</span>
          <select
            aria-label={tr("对比其他版本")}
            className={`${catalogSelectClass} min-w-40`}
            value={compareId}
            onChange={(e) => setCompareId(e.target.value)}
          >
            <option value="">{tr("不对比（查看本版激活顺序）")}</option>
            {otherVersions.map((v) => {
              const vp = getPresetPresentation(v);
              return (
                <option key={v.id} value={v.id}>{tr("对比 {{v0}}", { v0: `${vp.version || vp.displayName}${v.catalog?.variant ? ` · ${v.catalog.variant}` : ''}` })}
                </option>
              );
            })}
          </select>
        </div>
      )}

      {compareError && <p role="alert" className="text-xs text-destructive">{compareError}</p>}

      {diffReport && (
        <section className="rounded-lg border border-[color:var(--brand-hairline)] bg-[var(--brand-active-bg)] p-3.5 space-y-3 text-xs" data-preset-version-diff>
          <h3 className="font-medium text-sm text-[color:var(--text-primary)]">{tr("当前版本相较「{{v0}}」的变化（参数 {{v1}} 项 · 提示词块 {{v2}} 项）", { v0: compareItem ? (getPresetPresentation(compareItem).version || getPresetPresentation(compareItem).displayName) : tr("对比版本"), v1: diffReport.paramChanges.length, v2: diffReport.blockDiffs.length })}</h3>
          {diffReport.paramChanges.length === 0 && diffReport.blockDiffs.length === 0 ? (
            <p className="text-muted-foreground">{tr("两个版本的提示词正文、激活顺位、注入深度与核心采样参数完全一致。")}</p>
          ) : (
            <>
              {diffReport.paramChanges.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium text-muted-foreground">{tr("参数与预填变化：")}</p>
                  {diffReport.paramChanges.map((p) => (
                    <div key={p.label} className="rounded bg-background/70 px-2.5 py-1.5">
                      <span className="font-medium">{tr("{{v0}}：", { v0: p.label })}</span>
                      <span className="line-through text-muted-foreground mr-2">{p.before}</span>
                      <span className="text-brand font-medium">→ {p.after}</span>
                    </div>
                  ))}
                </div>
              )}
              {diffReport.blockDiffs.length > 0 && (
                <div className="space-y-1.5">
                  <p className="font-medium text-muted-foreground">{tr("提示词块差异：")}</p>
                  {diffReport.blockDiffs.map((d) => (
                    <details key={d.id} className="rounded border border-[color:var(--border-subtle)] bg-background/70 px-3 py-2">
                      <summary className="cursor-pointer flex items-center gap-2">
                        <span className="font-medium">{d.name}</span>
                        <span className="text-muted-foreground">· {d.detail}</span>
                      </summary>
                      {(d.beforeContent !== undefined || d.afterContent !== undefined) && (
                        <div className="grid gap-2 mt-2 md:grid-cols-2">
                          {d.beforeContent !== undefined && (
                            <div>
                              <p className="text-[11px] text-muted-foreground mb-1">{tr("对比版本：")}</p>
                              <pre className="whitespace-pre-wrap break-words rounded bg-muted/50 p-2 max-h-48 overflow-auto">{d.beforeContent || tr("（空）")}</pre>
                            </div>
                          )}
                          {d.afterContent !== undefined && (
                            <div>
                              <p className="text-[11px] text-brand mb-1">{tr("当前版本：")}</p>
                              <pre className="whitespace-pre-wrap break-words rounded bg-muted/50 p-2 max-h-48 overflow-auto">{d.afterContent || tr("（空）")}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </details>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}

      <section className="rounded-lg border border-[color:var(--border-subtle)] px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <h3 className="text-sm font-medium">{tr("实际激活顺序")}<span className="text-xs text-muted-foreground font-normal ml-1.5">{base.preset.promptOrder.length > 1 && activeGroup ? tr("· 开启 {{v0}} / 共 {{v1}} 项（{{v2}}）", { v0: orderedRows.active.filter((r) => r.enabled).length, v1: orderedRows.active.length, v2: activeGroup.character_id === 100001 ? tr("默认主组") : activeGroup.character_id === 100000 ? tr("通用组") : tr("扩展激活组") }) : tr("· 开启 {{v0}} / 共 {{v1}} 项", { v0: orderedRows.active.filter((r) => r.enabled).length, v1: orderedRows.active.length })}</span></h3>
        </div>
        {orderedRows.active.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">{tr("当前预设没有配置激活顺序。")}</p>
        ) : (
          orderedRows.active.map((row) => renderRow(row, 'active'))
        )}
      </section>

      {orderedRows.unlinked.length > 0 && (
        <details className="rounded-lg border border-[color:var(--border-subtle)] px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">{tr("备用提示词库（未挂入当前激活链 · {{v0}} 项）", { v0: orderedRows.unlinked.length })}</summary>
          <div className="mt-2">
            {orderedRows.unlinked.map((row) => renderRow(row, 'unlinked'))}
          </div>
        </details>
      )}
    </div>
  );
}
