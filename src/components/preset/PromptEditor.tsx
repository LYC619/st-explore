import { useState, useMemo } from 'react';
import { GripVertical, Trash2, ChevronDown, ChevronRight, Plus, Search, Undo2, Redo2, X, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';
import type { NormalizedPreset, OrderEntry, PromptBlock } from '@/types/preset';
import { blockDisplayName } from '@/types/preset';
import {
  collectReferencedIds, isUnreferenced, isEmptyDisabled,
  substituteVars, estimateTokens, getActiveOrder,
} from '@/lib/preset-parser';
import { RoleBadge, MarkerBadge, UnreferencedBadge, EmptyBadge, InjectionBadge } from './PresetRoleBadge';
import { isInjectionBlock, roleBorderClass } from './prompt-block-style';
import { AIRewriteContent } from '@/components/worldbook/AIRewriteContent';

interface PromptEditorProps {
  preset: NormalizedPreset;
  activeCharacterId: number;
  onCharacterIdChange: (id: number) => void;
  /** 改激活顺序（进历史栈） */
  onOrderChange: (order: OrderEntry[]) => void;
  /** 改 prompt 块内容 */
  onBlockContentChange: (identifier: string, content: string) => void;
  /** 改 prompt 块名称 */
  onBlockNameChange: (identifier: string, name: string) => void;
  /** 改 prompt 块角色类型 */
  onBlockRoleChange: (identifier: string, role: 'system' | 'user' | 'assistant') => void;
  /** 手动新建提示词块（relative=普通块按顺序就地，injection=ST 绝对注入块），返回新块 identifier */
  onAddBlock: (name: string, kind?: 'relative' | 'injection') => string;
  /** 彻底删除备用提示词块（系统 marker 不可删） */
  onDeleteBlock?: (identifier: string) => void;
  /** 改注入块的 depth / order 数字字段 */
  onBlockInjectionChange: (identifier: string, field: 'injection_depth' | 'injection_order', value: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function PromptEditor({
  preset, activeCharacterId, onCharacterIdChange,
  onOrderChange, onBlockContentChange, onBlockNameChange, onBlockRoleChange, onAddBlock, onDeleteBlock, onBlockInjectionChange, onUndo, onRedo, canUndo, canRedo,
}: PromptEditorProps) {
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [librarySearch, setLibrarySearch] = useState('');
  const [charName, setCharName] = useState('{{char}}');
  const [userName, setUserName] = useState('{{user}}');

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const order = getActiveOrder(preset, activeCharacterId);
  const blockMap = useMemo(() => {
    const m = new Map<string, PromptBlock>();
    preset.prompts.forEach((p) => m.set(p.identifier, p));
    return m;
  }, [preset.prompts]);
  const referenced = useMemo(() => collectReferencedIds(preset.promptOrder), [preset.promptOrder]);
  const orderIds = useMemo(() => new Set(order.map((o) => o.identifier)), [order]);

  const charIds = preset.promptOrder.map((g) => g.character_id);

  // 提示词库：不在当前激活 order 里的 prompt（按搜索过滤）
  const libraryBlocks = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    return preset.prompts.filter((p) => {
      if (orderIds.has(p.identifier)) return false;
      if (!q) return true;
      return (p.name ?? '').toLowerCase().includes(q) || p.identifier.toLowerCase().includes(q);
    });
  }, [preset.prompts, orderIds, librarySearch]);

  // ---- 激活顺序操作 ----
  const handleDrop = (index: number) => {
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null); setDragOverIndex(null); return;
    }
    const reordered = [...order];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(index, 0, moved);
    onOrderChange(reordered);
    setDragIndex(null); setDragOverIndex(null);
  };

  const toggleEnabled = (identifier: string) => {
    onOrderChange(order.map((o) => (o.identifier === identifier ? { ...o, enabled: !o.enabled } : o)));
  };

  const removeFromOrder = (identifier: string) => {
    onOrderChange(order.filter((o) => o.identifier !== identifier));
    toast({
      title: '已移回提示词备用库',
      action: <ToastAction altText="撤销" onClick={onUndo}>撤销</ToastAction>,
    });
  };

  const addToOrder = (identifier: string) => {
    onOrderChange([...order, { identifier, enabled: true }]);
  };

  const moveInOrder = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const reordered = [...order];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    onOrderChange(reordered);
  };

  // ---- 实时预览 ----
  const previewBlocks = useMemo(
    () => order.filter((o) => o.enabled).map((o) => blockMap.get(o.identifier)).filter(Boolean) as PromptBlock[],
    [order, blockMap]
  );
  const totalTokens = useMemo(
    () => previewBlocks.reduce((sum, b) => sum + (b.marker ? 0 : estimateTokens(substituteVars(b.content ?? '', charName, userName))), 0),
    [previewBlocks, charName, userName]
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 左：激活顺序 + 提示词库 */}
      <div className="space-y-4">
        {/* 工具条：多角色组切换 + 撤销/重做 */}
        <div className="flex items-center gap-2 flex-wrap">
          {charIds.length > 1 && (
            <Select value={String(activeCharacterId)} onValueChange={(v) => onCharacterIdChange(Number(v))}>
              <SelectTrigger className="h-8 w-auto text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {preset.promptOrder.map((g, gi) => (
                  <SelectItem key={g.character_id} value={String(g.character_id)} className="text-xs">
                    {g.character_id === 100001 ? '默认主组' : g.character_id === 100000 ? '通用组' : `扩展组 ${gi + 1}`}
                    {` · ${g.order.length} 项`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" onClick={onUndo} disabled={!canUndo} aria-label="撤销" title="撤销上一步修改">
              <Undo2 className="w-4 h-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={onRedo} disabled={!canRedo} aria-label="重做" title="重做修改">
              <Redo2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* 激活顺序 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">激活顺序（{order.length}）</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="px-2 text-xs">
                  <Plus className="w-3.5 h-3.5 mr-1" /> 新建块
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-xs"
                  onSelect={() => {
                    const id = onAddBlock('新提示词块', 'relative');
                    setExpandedId(id);
                  }}
                >
                  普通块（按激活顺序就地）
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-xs"
                  onSelect={() => {
                    const id = onAddBlock('新注入块', 'injection');
                    setExpandedId(id);
                  }}
                >
                  注入块（@深度插入聊天楼层）
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <ScrollArea className="h-[420px] pr-2">
            <div className="space-y-1.5">
              {order.map((entry, index) => {
                const block = blockMap.get(entry.identifier);
                const expanded = expandedId === entry.identifier;
                const empty = block && isEmptyDisabled(block, order);
                return (
                  <div
                    key={entry.identifier}
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(e) => { e.preventDefault(); setDragOverIndex(index); }}
                    onDrop={() => handleDrop(index)}
                    onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                    className={`rounded-lg border bg-secondary/30 border-l-2 ${block ? roleBorderClass(block) : 'border-l-border'} ${
                      dragOverIndex === index && dragIndex !== index ? 'border-primary border-dashed' : 'border-border'
                    } ${dragIndex === index ? 'opacity-50' : ''} ${!entry.enabled ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center gap-2 p-2">
                      <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab shrink-0" />
                      <button
                        type="button"
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={() => setExpandedId(expanded ? null : entry.identifier)}
                        aria-label={expanded ? '收起' : '展开'}
                      >
                        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <span className="text-sm truncate flex-1 min-w-0" title={block ? blockDisplayName(block) : entry.identifier}>{block ? blockDisplayName(block) : entry.identifier}</span>
                      {block?.marker ? <MarkerBadge /> : isInjectionBlock(block) ? <InjectionBadge depth={block?.injection_depth as number | undefined} /> : <RoleBadge role={block?.role} />}
                      {empty && <EmptyBadge />}
                      <Switch checked={entry.enabled} onCheckedChange={() => toggleEnabled(entry.identifier)} className="scale-90" />
                      <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground" disabled={index === 0} onClick={() => moveInOrder(index, -1)} aria-label="上移提示词" title="上移一位">
                        <ArrowUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground" disabled={index === order.length - 1} onClick={() => moveInOrder(index, 1)} aria-label="下移提示词" title="下移一位">
                        <ArrowDown className="w-3.5 h-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => removeFromOrder(entry.identifier)} aria-label="移回备用库" title="从当前激活链移回下方备用库">
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    {expanded && (
                      <div className="px-2 pb-2 pt-1 border-t border-border/50">
                        {block?.marker ? (
                          <p className="text-xs text-muted-foreground py-1">系统动态插槽，对话时由酒馆自动填入对应人设、世界书或聊天历史，无需手动编辑文本。</p>
                        ) : (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <Input size="sm"
                                value={block?.name ?? ''}
                                onChange={(e) => onBlockNameChange(entry.identifier, e.target.value)}
                                placeholder="块名称"
                                className="text-base sm:text-xs flex-1"
                              />
                              <Select
                                value={block?.role ?? 'system'}
                                onValueChange={(v) => onBlockRoleChange(entry.identifier, v as 'system' | 'user' | 'assistant')}
                              >
                                <SelectTrigger className="h-7 w-[88px] text-xs" aria-label="角色类型">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="system" className="text-xs">系统</SelectItem>
                                  <SelectItem value="user" className="text-xs">用户</SelectItem>
                                  <SelectItem value="assistant" className="text-xs">助手</SelectItem>
                                </SelectContent>
                              </Select>
                              <AIRewriteContent
                                content={block?.content ?? ''}
                                onResult={(text) => onBlockContentChange(entry.identifier, text)}
                                builtinPromptId="preset.rewrite"
                                quickPresetPrefix="preset.quick"
                                title="AI 改写本提示词块"
                                compact
                              />
                            </div>
                            {isInjectionBlock(block) && (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="shrink-0">注入深度</span>
                                <Input size="sm"
                                  type="number"
                                  value={String(block?.injection_depth ?? 4)}
                                  onChange={(e) => onBlockInjectionChange(entry.identifier, 'injection_depth', Number(e.target.value) || 0)}
                                  className="text-xs w-16"
                                  aria-label="注入深度"
                                />
                                <span className="shrink-0">顺序</span>
                                <Input size="sm"
                                  type="number"
                                  value={String(block?.injection_order ?? 100)}
                                  onChange={(e) => onBlockInjectionChange(entry.identifier, 'injection_order', Number(e.target.value) || 0)}
                                  className="text-xs w-16"
                                  aria-label="注入顺序"
                                />
                                <span className="text-[11px]">@深度=插入聊天倒数第几层；顺序=同深度排序权重</span>
                              </div>
                            )}
                            <Textarea
                              value={block?.content ?? ''}
                              onChange={(e) => onBlockContentChange(entry.identifier, e.target.value)}
                              placeholder="提示词内容"
                              className="text-base sm:text-xs min-h-[80px] font-mono"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {order.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">当前分组没有激活条目</p>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* 提示词备用库 */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-medium">备用提示词库（{libraryBlocks.length}）</h3>
            <div className="ml-auto relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input size="sm" value={librarySearch} onChange={(e) => setLibrarySearch(e.target.value)} placeholder="搜索备用块" className="pl-7 text-base sm:text-xs w-36" />
            </div>
          </div>
          <ScrollArea className="h-[160px] pr-2">
            <div className="space-y-1.5">
              {libraryBlocks.map((block) => (
                <div key={block.identifier} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-secondary/20">
                  <span className="text-sm truncate flex-1 min-w-0" title={blockDisplayName(block)}>{blockDisplayName(block)}</span>
                  {block.marker ? <MarkerBadge /> : isInjectionBlock(block) ? <InjectionBadge depth={block.injection_depth as number | undefined} /> : <RoleBadge role={block.role} />}
                  {isUnreferenced(block, referenced) && <UnreferencedBadge />}
                  <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => addToOrder(block.identifier)} aria-label="加入激活顺序" title="加入上方激活顺序">
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                  {!block.marker && onDeleteBlock && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        onDeleteBlock(block.identifier);
                        toast({
                          title: `已彻底删除提示词块「${blockDisplayName(block)}」`,
                          action: <ToastAction altText="撤销" onClick={onUndo}>撤销</ToastAction>,
                        });
                      }}
                      aria-label={`彻底删除提示词块 ${blockDisplayName(block)}`}
                      title="彻底从预设中移除该废块（可撤销）"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              {libraryBlocks.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">没有未挂载的备用提示词</p>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* 右：实时预览 */}
      <div>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <h3 className="text-sm font-medium">实时预览</h3>
          <span className="text-xs text-muted-foreground">~{totalTokens} tokens</span>
          <div className="ml-auto flex items-center gap-1">
            <Label className="text-xs text-muted-foreground">角色名</Label>
            <Input size="sm" value={charName} onChange={(e) => setCharName(e.target.value)} className="text-xs w-24" />
            <Label className="text-xs text-muted-foreground">用户名</Label>
            <Input size="sm" value={userName} onChange={(e) => setUserName(e.target.value)} className="text-xs w-24" />
          </div>
        </div>
        <ScrollArea className="h-[600px] pr-2">
          <div className="space-y-2">
            {previewBlocks.map((block, i) => (
              <div key={`${block.identifier}-${i}`} className={`rounded-md border border-l-2 ${roleBorderClass(block)} bg-card p-2.5`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium">{blockDisplayName(block)}</span>
                  {block.marker ? <MarkerBadge /> : isInjectionBlock(block) ? <InjectionBadge depth={block.injection_depth as number | undefined} /> : <RoleBadge role={block.role} />}
                </div>
                {block.marker ? (
                  <p className="text-xs text-muted-foreground italic">[ {blockDisplayName(block)} —— 对话时自动填充此处内容 ]</p>
                ) : (
                  <p className="text-xs whitespace-pre-wrap leading-relaxed text-foreground/90">
                    {substituteVars(block.content ?? '', charName, userName) || <span className="text-muted-foreground italic">（空）</span>}
                  </p>
                )}
              </div>
            ))}
            {previewBlocks.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8">无启用的条目可预览</p>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
