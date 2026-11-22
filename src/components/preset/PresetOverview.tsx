import { useMemo } from 'react';
import { Code } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { NormalizedPreset } from '@/types/preset';
import { collectReferencedIds, detectSourceModel, selectActivePromptOrderGroup } from '@/lib/preset-parser';
import { listPresetEmbeddedScripts } from '@/lib/preset-resources';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium mt-0.5 truncate" title={String(value)}>{value}</div>
    </div>
  );
}

const PARAM_FIELDS: { key: string; label: string; step: string; placeholder: string }[] = [
  { key: 'temperature', label: '温度 (Temperature)', step: '0.05', placeholder: '如 1.0' },
  { key: 'top_p', label: '采样核 (Top P)', step: '0.05', placeholder: '如 0.95' },
  { key: 'top_k', label: '候选词数 (Top K)', step: '1', placeholder: '如 40' },
  { key: 'min_p', label: '最低概率 (Min P)', step: '0.01', placeholder: '如 0.05' },
  { key: 'frequency_penalty', label: '频率惩罚', step: '0.05', placeholder: '如 0' },
  { key: 'presence_penalty', label: '存在惩罚', step: '0.05', placeholder: '如 0' },
  { key: 'openai_max_context', label: '最大上下文长度', step: '1024', placeholder: '如 32768' },
  { key: 'openai_max_tokens', label: '单次最大回复长度', step: '128', placeholder: '如 2048' },
];

export function PresetOverview({
  preset,
  onNumberParamChange,
  onFieldChange,
  onToggleScript,
}: {
  preset: NormalizedPreset;
  onNumberParamChange?: (key: string, value: number | undefined) => void;
  onFieldChange?: (key: string, value: string) => void;
  onToggleScript?: (scriptKey: string, enabled: boolean) => void;
}) {
  const od = preset.originalData;
  const { source, model } = detectSourceModel(od);
  const scripts = useMemo(() => listPresetEmbeddedScripts(preset), [preset]);

  const stats = useMemo(() => {
    const group = selectActivePromptOrderGroup(preset);
    const enabled = group ? group.order.filter((o) => o.enabled).length : 0;
    const total = group ? group.order.length : 0;
    const referenced = collectReferencedIds(preset.promptOrder);
    const unreferenced = preset.prompts.filter((p) => !referenced.has(p.identifier)).length;
    return { enabled, total, unreferenced };
  }, [preset]);

  const prefill = typeof od.assistant_prefill === 'string' ? od.assistant_prefill : '';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="原记录接口类型" value={source || '通用聊天补全'} />
        <Stat label="原记录模型" value={model || '跟随当前连接'} />
        <Stat label="提示词总块数" value={preset.prompts.length} />
        <Stat label="当前激活条目" value={`${stats.enabled} / ${stats.total}`} />
      </div>

      <Card>
        <CardContent className="pt-4 space-y-4">
          <div>
            <h3 className="text-sm font-medium">核心采样与长度参数</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              控制回复的发散度、重复抑制与单次生成长度；留空则不在预设内强制覆盖该项。
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PARAM_FIELDS.map((p) => {
              const rawVal = od[p.key];
              const strVal = typeof rawVal === 'number' && Number.isFinite(rawVal) ? String(rawVal) : '';
              return onNumberParamChange ? (
                <div key={p.key} className="space-y-1">
                  <Label htmlFor={`preset-param-${p.key}`} className="text-xs text-muted-foreground">{p.label}</Label>
                  <Input
                    id={`preset-param-${p.key}`}
                    aria-label={p.label}
                    type="number"
                    step={p.step}
                    placeholder={p.placeholder}
                    value={strVal}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      if (!raw) {
                        onNumberParamChange(p.key, undefined);
                        return;
                      }
                      const parsed = Number(raw);
                      if (Number.isFinite(parsed)) onNumberParamChange(p.key, parsed);
                    }}
                    className="text-base sm:text-xs"
                  />
                </div>
              ) : (
                <Stat key={p.key} label={p.label} value={strVal || '—'} />
              );
            })}
          </div>

          {onFieldChange && (
            <div className="space-y-1.5 pt-2 border-t border-border/60">
              <Label htmlFor="preset-assistant-prefill" className="text-xs font-medium">
                回复开头预填词（防空回 / 引导起笔）
              </Label>
              <p className="text-xs text-muted-foreground">
                常见于 Claude / Gemini 预设（例如预填思维链标签或起手语），留空则不追加预填消息。
              </p>
              <Textarea
                id="preset-assistant-prefill"
                aria-label="回复开头预填词"
                rows={2}
                placeholder="选填：如 <thinking> 或指定起笔格式"
                value={prefill}
                onChange={(e) => onFieldChange('assistant_prefill', e.target.value)}
                className="text-base sm:text-xs font-mono"
              />
            </div>
          )}

          {preset.regexRules.length > 0 && (
            <p className="text-xs text-muted-foreground pt-1">
              内嵌正则清理规则：{preset.regexRules.length} 条（可在上方「正则」页签编辑）
            </p>
          )}
        </CardContent>
      </Card>

      {scripts.length > 0 && (
        <Card>
          <CardContent className="pt-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <Code className="w-4 h-4 text-brand" />
              <h3 className="text-sm font-medium">内嵌酒馆助手脚本（{scripts.length}）</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              控制导出或进入内置酒馆时默认开启哪些随预设附带的状态栏／助手脚本。
            </p>
            <div className="space-y-2">
              {scripts.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{s.name}</p>
                    {s.info && <p className="text-muted-foreground truncate mt-0.5">{s.info}</p>}
                  </div>
                  {onToggleScript && (
                    <Switch
                      checked={s.enabled}
                      aria-label={`启用内嵌脚本 ${s.name}`}
                      onCheckedChange={(checked) => onToggleScript(s.key, checked)}
                    />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
