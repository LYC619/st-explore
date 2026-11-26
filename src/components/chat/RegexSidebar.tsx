import { tr, formatList } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { X, Plus, Trash2, RotateCcw, ChevronDown, ChevronUp, Regex, GripVertical, Eye, Bookmark, Upload, Download, Stamp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RegexQuickAdd } from '@/components/chat/RegexQuickAdd';
import { RegexDepthEditor } from '@/components/chat/RegexDepthEditor';
import { HelpCard } from '@/components/HelpCard';
import type { RegexRule } from '@/types/chat';
import type { ChatMessage } from '@/types/chat';
import { DEFAULT_REGEX_RULES } from '@/types/chat';
import {
  saveCustomRegexRules,
  saveBuiltinRuleStates,
  loadRegexPresets,
  addRegexPreset,
  deleteRegexPreset,
  type RegexPreset,
} from '@/lib/session-storage';
import { parseSTRegexImport, exportSTRegex } from '@/lib/st-regex-interop';
import { useToast } from '@/hooks/use-toast';
import { useViewport } from '@/hooks/use-viewport';
import { cn } from '@/lib/utils';

interface RegexSidebarProps {
  rules: RegexRule[];
  onRulesChange: (rules: RegexRule[]) => void;
  isOpen: boolean;
  /** 不传 = 独立页常驻模式（阶段5 正则工具页），不显示关闭按钮 */
  onClose?: () => void;
  sampleMessages?: ChatMessage[];
  /** 切换正在预览的规则：传 null 表示退出预览。预览效果在主界面阅读区原地高亮显示。 */
  onPreviewChange?: (rule: RegexRule | null) => void;
  /** 当前正在预览的规则 id（由父级持有，便于跨组件高亮按钮状态） */
  previewId?: string | null;
  /** 把当前启用规则的处理结果写回消息原文（持久化到书架）。由父级实现，未传则不显示按钮。 */
  onApplyToOriginal?: () => void;
  /** 可预览和导出已有规则，但不能修改规则或原文。 */
  readOnly?: boolean;
  /** 当前滚动容器内，上方阅读/工作台工具栏实际占用高度。 */
  stickyTop?: number;
}

export function RegexSidebar({ rules, onRulesChange, isOpen, onClose, onPreviewChange, previewId = null, onApplyToOriginal, readOnly = false, stickyTop = 0 }: RegexSidebarProps) {
  useI18n();
  const { toast } = useToast();
  const { isCompact } = useViewport();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [presets, setPresets] = useState<RegexPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [presetOpen, setPresetOpen] = useState(false);
  // 记录刚添加、需要滚动到可见区的规则 id
  const [scrollToId, setScrollToId] = useState<string | null>(null);
  const newRuleRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [availableHeight, setAvailableHeight] = useState<number>();

  useLayoutEffect(() => {
    const sidebar = sidebarRef.current;
    if (!isOpen || !sidebar || isCompact) { setAvailableHeight(undefined); return; }
    let scrollHost = sidebar.parentElement;
    while (scrollHost && scrollHost !== document.body && !/^(auto|scroll|overlay)$/.test(getComputedStyle(scrollHost).overflowY)) scrollHost = scrollHost.parentElement;
    const host = scrollHost === document.body ? null : scrollHost;
    const measure = () => {
      const bounds = host?.getBoundingClientRect();
      const top = Math.max(0, (bounds?.top ?? 0) + stickyTop, sidebar.getBoundingClientRect().top);
      const bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight);
      setAvailableHeight(Math.max(0, bottom - top - 8));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (host) observer.observe(host);
    if (sidebar.parentElement) observer.observe(sidebar.parentElement);
    window.addEventListener('resize', measure);
    (host ?? window).addEventListener('scroll', measure, { passive: true });
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); (host ?? window).removeEventListener('scroll', measure); };
  }, [isOpen, isCompact, stickyTop]);

  // 添加规则后滚动到新规则位置（否则用户在列表上方时完全感知不到末尾新增了规则）
  useEffect(() => {
    if (scrollToId && newRuleRef.current) {
      newRuleRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setScrollToId(null);
    }
  }, [scrollToId, rules]);

  // 加载已保存的预设
  useEffect(() => {
    setPresets(loadRegexPresets());
  }, []);

  // 仅在用户主动增删改规则/导入/切预设时同步更新全局自定义正则，禁止挂载时用旧故事固化规则反向清空全局！
  const commitRulesChange = (nextRules: RegexRule[]) => {
    if (readOnly) return;
    saveCustomRegexRules(nextRules);
    saveBuiltinRuleStates(nextRules);
    onRulesChange(nextRules);
  };

  const handleResetToDefault = () => {
    if (readOnly) return;
    commitRulesChange([...DEFAULT_REGEX_RULES]);
  };

  const handleSavePreset = () => {
    if (readOnly) return;
    const name = presetName.trim();
    if (!name) {
      toast({ title: tr("请输入预设名称"), variant: 'destructive' });
      return;
    }
    const updated = addRegexPreset(name, rules);
    setPresets(updated);
    setPresetName('');
    toast({ title: tr("已保存预设"), description: tr("「{{v0}}」包含 {{v1}} 条规则", { v0: name, v1: rules.length }) });
  };

  const handleLoadPreset = (preset: RegexPreset) => {
    if (readOnly) return;
    commitRulesChange(JSON.parse(JSON.stringify(preset.rules)));
    setPresetOpen(false);
    toast({ title: tr("已加载预设"), description: tr("「{{v0}}」（{{v1}} 条规则）", { v0: preset.name, v1: preset.rules.length }) });
  };

  const handleDeletePreset = (id: string) => {
    if (readOnly) return;
    setPresets(deleteRegexPreset(id));
  };

  // 导入 SillyTavern 正则脚本 .json（单脚本 / 数组 / {scripts:[]}），支持一次选多个文件
  const handleImportST = async (files: File[]) => {
    if (readOnly) return;
    const imported: RegexRule[] = [];
    const failed: string[] = [];
    for (const file of files) {
      try {
        const json = JSON.parse(await file.text());
        imported.push(...parseSTRegexImport(json));
      } catch {
        failed.push(file.name);
      }
    }
    if (imported.length === 0) {
      toast({
        title: tr("未发现可导入的规则"),
        description: failed.length > 0 ? tr("解析失败：{{v0}}", { v0: formatList(failed) }) : undefined,
        variant: 'destructive',
      });
      return;
    }
    // 按 id 去重合并：已存在的 id 覆盖，新 id 追加
    const byId = new Map(rules.map((r) => [r.id, r]));
    imported.forEach((r) => byId.set(r.id, r));
    commitRulesChange(Array.from(byId.values()));
    toast({
      title: tr("已导入 ST 正则"),
      description: tr("导入 {{v0}} 条规则{{v1}}{{v2}}", { v0: imported.length, v1: files.length > 1 ? tr("（{{v0}}/{{v1}} 个文件）", { v0: files.length - failed.length, v1: files.length }) : '', v2: failed.length > 0 ? tr("；失败：{{v0}}", { v0: formatList(failed) }) : '' }),
    });
  };

  // 导出当前规则为 ST 正则脚本 .json
  const handleExportST = () => {
    if (rules.length === 0) {
      toast({ title: tr("当前没有规则可导出"), variant: 'destructive' });
      return;
    }
    const json = exportSTRegex(rules);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = rules.length === 1 ? `${rules[0].name || 'regex'}.json` : 'regex-scripts.json';
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: tr("已导出 ST 正则"), description: tr("导出 {{v0}} 条规则", { v0: rules.length }) });
  };

  const handleAddRule = (rule?: RegexRule) => {
    if (readOnly) return;
    if (rule) {
      commitRulesChange([...rules, rule]);
      setEditingId(rule.id);
      setScrollToId(rule.id);
    } else {
      const newRule: RegexRule = {
        id: crypto.randomUUID(),
        name: tr("自定义规则 {{v0}}", { v0: rules.filter(r => !r.id.startsWith('builtin-')).length + 1 }),
        findRegex: '',
        replaceString: '',
        placement: ['all'],
        disabled: false,
      };
      commitRulesChange([...rules, newRule]);
      setEditingId(newRule.id);
      setScrollToId(newRule.id);
    }
  };

  const handleUpdateRule = (id: string, updates: Partial<RegexRule>) => {
    if (readOnly) return;
    commitRulesChange(
      rules.map((rule) => (rule.id === id ? { ...rule, ...updates } : rule))
    );
  };

  const handleDeleteRule = (id: string) => {
    if (readOnly) return;
    commitRulesChange(rules.filter((rule) => rule.id !== id));
  };

  const handleToggleRule = (id: string) => {
    if (readOnly) return;
    const rule = rules.find((r) => r.id === id);
    if (rule) {
      handleUpdateRule(id, { disabled: !rule.disabled });
    }
  };

  const handleDragStart = (index: number) => {
    if (readOnly) return;
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    if (readOnly) return;
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (index: number) => {
    if (readOnly) return;
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const reordered = [...rules];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(index, 0, moved);
    commitRulesChange(reordered);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handlePlacementChange = (
    id: string,
    placement: 'all' | 'user' | 'assistant',
    checked: boolean
  ) => {
    if (readOnly) return;
    const rule = rules.find((r) => r.id === id);
    if (!rule) return;

    let newPlacement: ('all' | 'user' | 'assistant')[];

    if (placement === 'all') {
      newPlacement = checked ? ['all'] : [];
    } else {
      newPlacement = rule.placement.filter((p) => p !== 'all');
      if (checked) {
        if (!newPlacement.includes(placement)) {
          newPlacement.push(placement);
        }
      } else {
        newPlacement = newPlacement.filter((p) => p !== placement);
      }
      if (newPlacement.length === 0) {
        newPlacement = ['all'];
      }
    }

    handleUpdateRule(id, { placement: newPlacement });
  };

  if (!isOpen) return null;
  // 窄屏：宽度让给父容器（那边已改成上下叠），高度也不再按 100vh 算——
  // 叠在正文下面时 sticky 没有意义，撑到视口高只会留一大片空白。

  const enabledCount = rules.filter(r => !r.disabled).length;

  return (
    <aside ref={sidebarRef} data-regex-sidebar style={isCompact ? undefined : { top: stickyTop, height: availableHeight }} className={cn(
      'border border-border rounded-lg bg-card flex flex-col animate-fade-in overflow-hidden',
      isCompact
        ? 'w-full max-h-[70dvh]'
        : 'w-80 flex-shrink-0 self-start sticky',
    )}>
      {/* Header */}
      <div className="shrink-0 p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Regex className="w-4 h-4 text-primary" />
          <h3 className="font-display font-medium">{tr("正则清理规则")}</h3>
          <HelpCard>{tr("正则规则用于自动清理 AI 输出中的杂项内容（如思维链 &lt;thinking&gt;、状态栏标签等）。可通过「快速添加」按标签包裹或指定内容快速生成规则，也可手动添加。规则按用户消息和助手消息分别应用，处理后导出的文件会更干净。")}</HelpCard>
          <span className="text-xs text-muted-foreground">
            ({enabledCount}/{rules.length}{tr(" 启用)")}</span>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={tr("关闭")}>
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      <div data-regex-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {/* Description */}
      <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border">{tr("使用正则表达式移除思维链、状态栏等无关内容")}</div>

      {/* Rules List */}
      <div>
        <div className="p-4 space-y-2">
          {rules.map((rule, index) => (
            <div
              key={rule.id}
              ref={rule.id === scrollToId ? newRuleRef : undefined}
              draggable={!readOnly}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={() => handleDrop(index)}
              onDragEnd={handleDragEnd}
            className={`min-w-0 max-w-full overflow-hidden p-3 rounded-lg border transition-colors ${
                rule.disabled
                  ? 'bg-muted/30 border-muted'
                  : 'bg-secondary/30 border-border'
              } ${dragOverIndex === index && dragIndex !== index ? 'border-primary border-dashed' : ''} ${dragIndex === index ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab shrink-0" />
                  <Switch
                    checked={!rule.disabled}
                    disabled={readOnly}
                    onCheckedChange={() => handleToggleRule(rule.id)}
                  />
                  <span
                    className={`min-w-0 flex-1 text-sm font-medium line-clamp-2 break-words ${
                      rule.disabled ? 'text-muted-foreground' : ''
                    }`}
                    title={rule.name}
                  >
                    {rule.name}
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() =>
                      setEditingId(editingId === rule.id ? null : rule.id)
                    }
                    aria-label={editingId === rule.id ? tr("收起") : tr("展开编辑")}
                  >
                    {editingId === rule.id ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                  </Button>
                  {!readOnly && !rule.id.startsWith('builtin-') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteRule(rule.id)}
                      aria-label={tr("删除规则")}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Edit Area */}
              {editingId === rule.id && (
                <div className="space-y-3 pt-2 border-t border-border/50">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{tr("规则名称")}</Label>
                    <Input
                      value={rule.name}
                      readOnly={readOnly}
                      onChange={(e) =>
                        handleUpdateRule(rule.id, { name: e.target.value })
                      }
                      className="text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">{tr("匹配正则")}</Label>
                    <Textarea
                      value={rule.findRegex}
                      readOnly={readOnly}
                      onChange={(e) =>
                        handleUpdateRule(rule.id, { findRegex: e.target.value })
                      }
                      placeholder={tr("/pattern/flags 或纯 pattern")}
                      className="max-w-full text-xs font-mono min-h-[60px] break-words"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">{tr("替换为")}</Label>
                    <Input
                      value={rule.replaceString}
                      readOnly={readOnly}
                      onChange={(e) =>
                        handleUpdateRule(rule.id, {
                          replaceString: e.target.value,
                        })
                      }
                      placeholder={tr("留空表示删除")}
                      className="text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">{tr("应用于")}</Label>
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="flex items-center gap-1.5 text-xs">
                        <Checkbox
                          checked={rule.placement.includes('all')}
                          disabled={readOnly}
                          onCheckedChange={(checked) =>
                            handlePlacementChange(rule.id, 'all', !!checked)
                          }
                        />{tr("全部")}</label>
                      <label className="flex items-center gap-1.5 text-xs">
                        <Checkbox
                          checked={rule.placement.includes('user')}
                          disabled={readOnly}
                          onCheckedChange={(checked) =>
                            handlePlacementChange(rule.id, 'user', !!checked)
                          }
                        />{tr("用户")}</label>
                      <label className="flex items-center gap-1.5 text-xs">
                        <Checkbox
                          checked={rule.placement.includes('assistant')}
                          disabled={readOnly}
                          onCheckedChange={(checked) =>
                            handlePlacementChange(rule.id, 'assistant', !!checked)
                          }
                        />
                        AI
                      </label>
                    </div>
                  </div>

                  <RegexDepthEditor rule={rule} readOnly={readOnly} onChange={patch => handleUpdateRule(rule.id, patch)} />

                  {/* 在主界面阅读区原地预览该规则效果 */}
                  {rule.findRegex && onPreviewChange && (
                    <Button
                      variant={previewId === rule.id ? 'secondary' : 'outline'}
                      size="sm"
                      className="w-full gap-1 text-xs"
                      onClick={() => onPreviewChange(previewId === rule.id ? null : rule)}
                    >
                      <Eye className="w-3 h-3" />
                      {previewId === rule.id ? tr("退出预览") : tr("在正文中预览")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Footer Actions */}
      <div className="p-4 border-t border-border space-y-2" data-tour="regex-quickadd">
        {!readOnly && (
          <div className="flex items-center gap-2">
            <RegexQuickAdd onAddRule={handleAddRule} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleAddRule()}
              className="flex-1 gap-1"
            >
              <Plus className="w-3 h-3" />{tr("手动添加")}</Button>
          </div>
        )}
        {!readOnly && <Popover open={presetOpen} onOpenChange={setPresetOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="w-full gap-1">
              <Bookmark className="w-3 h-3" />{tr("预设管理")}</Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3" align="start" side="top">
            <div className="space-y-3">
              <div>
                <Label className="text-xs">{tr("保存当前规则为预设")}</Label>
                <div className="flex items-center gap-2 mt-1.5">
                  <Input
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSavePreset(); }}
                    placeholder={tr("预设名称")}
                    className="text-sm"
                  />
                  <Button size="sm" className="shrink-0" onClick={handleSavePreset}>{tr("保存")}</Button>
                </div>
              </div>

              <div className="border-t border-border pt-2">
                <Label className="text-xs">{tr("已保存的预设")}</Label>
                {presets.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic mt-1.5">{tr("暂无预设")}</p>
                ) : (
                  <div className="mt-1.5 space-y-1 max-h-48 overflow-y-auto">
                    {presets.map((preset) => (
                      <div
                        key={preset.id}
                        className="flex items-center gap-1 rounded border border-border px-2 py-1"
                      >
                        <button
                          className="flex-1 min-w-0 text-left text-sm hover:text-primary"
                          onClick={() => handleLoadPreset(preset)}
                          title={tr("加载「{{v0}}」", { v0: preset.name })}
                        >
                          <span className="truncate block" title={preset.name}>{preset.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {preset.rules.length}{tr(" 条规则")}</span>
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-6 p-0 shrink-0"
                          onClick={() => handleDeletePreset(preset.id)}
                          aria-label={tr("删除预设")}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>}
        <div className="flex items-center gap-2">
          {!readOnly && (
            <>
              <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) handleImportST(files);
                  e.target.value = ''; // 允许重复选择同一文件
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1"
                onClick={() => importInputRef.current?.click()}
                title={tr("导入 SillyTavern 正则脚本 .json（可一次选多个文件）")}
              >
                <Download className="w-3 h-3" />{tr("导入正则")}</Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1"
            onClick={handleExportST}
            title={tr("导出为 SillyTavern 正则脚本 .json")}
          >
            <Upload className="w-3 h-3" />{tr("导出正则")}</Button>
        </div>
        {onApplyToOriginal && !readOnly && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                className="w-full gap-1"
                disabled={enabledCount === 0}
                title={enabledCount === 0 ? tr("先启用至少一条规则") : tr("把当前处理效果永久写入原文")}
              >
                <Stamp className="w-3 h-3" />{tr("应用到原文")}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{tr("把正则处理结果写入原文？")}</AlertDialogTitle>
                <AlertDialogDescription>{tr("将用当前启用的 ")}{enabledCount}{tr(" 条规则处理全部楼层并覆盖原始文本，随书架自动保存——之后换正则或重新打开这本书，看到的都是处理后的文本。 应用后这些规则会自动停用，避免二次处理。操作完成后可立即点「撤销」恢复，错过则无法找回原文。")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tr("取消")}</AlertDialogCancel>
                <AlertDialogAction onClick={onApplyToOriginal}>{tr("应用")}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {!readOnly && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetToDefault}
            className="w-full gap-1"
          >
            <RotateCcw className="w-3 h-3" />{tr("重置为默认")}</Button>
        )}
      </div>
      </div>
    </aside>
  );
}
