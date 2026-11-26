import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useState } from 'react';
import { Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { RegexRule } from '@/types/chat';
import { RegexDepthEditor } from './RegexDepthEditor';

interface RegexQuickAddProps {
  onAddRule: (rule: RegexRule) => void;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type QuickMode = 'wrap' | 'replace' | 'trim';

export function RegexQuickAdd({ onAddRule }: RegexQuickAddProps) {
  useI18n();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<QuickMode>('wrap');

  // 模式一：标签包裹删除
  const [startTag, setStartTag] = useState('');
  const [endTag, setEndTag] = useState('');

  // 模式二：内容替换（A → B）
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');

  // 模式三：首尾删除（消息开头→标记 / 标记→消息结尾）
  const [trimDirection, setTrimDirection] = useState<'head' | 'tail'>('head');
  const [trimMarker, setTrimMarker] = useState('');
  const [trimKeepMarker, setTrimKeepMarker] = useState(false);

  const [ruleName, setRuleName] = useState('');
  const [depth, setDepth] = useState<Pick<RegexRule, 'minDepth' | 'maxDepth'>>({ minDepth: null, maxDepth: null });

  const resetAll = () => {
    setStartTag('');
    setEndTag('');
    setFindText('');
    setReplaceText('');
    setTrimMarker('');
    setTrimKeepMarker(false);
    setRuleName('');
    setDepth({ minDepth: null, maxDepth: null });
  };

  const generateWrapRule = () => {
    if (!startTag || !endTag) {
      toast({ title: tr("请填写开始和结束标签"), variant: 'destructive' });
      return;
    }
    const regex = `${escapeRegex(startTag)}[\\s\\S]*?${escapeRegex(endTag)}(\\n)?`;
    onAddRule({
      id: crypto.randomUUID(),
      name: ruleName || tr("移除 {{v0}}...{{v1}}", { v0: startTag, v1: endTag }),
      findRegex: regex,
      replaceString: '',
      placement: ['all'],
      disabled: false,
      ...depth,
    });
    toast({ title: tr("规则已添加") });
    setOpen(false);
    resetAll();
  };

  const generateReplaceRule = () => {
    if (!findText) {
      toast({ title: tr("请填写要查找的内容"), variant: 'destructive' });
      return;
    }
    onAddRule({
      id: crypto.randomUUID(),
      name: ruleName || (replaceText ? `${findText} → ${replaceText}` : tr("删除 {{v0}}", { v0: findText })),
      findRegex: escapeRegex(findText),
      replaceString: replaceText,
      placement: ['all'],
      disabled: false,
      ...depth,
    });
    toast({ title: tr("规则已添加") });
    setOpen(false);
    resetAll();
  };

  // 首尾删除的 pattern（默认 /gs 无 m，^/$ 锚定单条消息的开头/结尾）
  const trimPattern = trimMarker
    ? (trimDirection === 'head'
        ? `^[\\s\\S]*?${escapeRegex(trimMarker)}`
        : `${escapeRegex(trimMarker)}[\\s\\S]*$`)
    : '';

  const generateTrimRule = () => {
    if (!trimMarker) {
      toast({ title: tr("请填写标记文字"), variant: 'destructive' });
      return;
    }
    // 保留标记时替换为标记本身；replace 的替换串里 $ 有特殊含义，转义为 $$
    const replacement = trimKeepMarker ? trimMarker.replace(/\$/g, '$$$$') : '';
    onAddRule({
      id: crypto.randomUUID(),
      name: ruleName || (trimDirection === 'head' ? tr("删除开头至 {{v0}}", { v0: trimMarker }) : tr("删除 {{v0}} 至结尾", { v0: trimMarker })),
      findRegex: trimPattern,
      replaceString: replacement,
      placement: ['all'],
      disabled: false,
      ...depth,
    });
    toast({ title: tr("规则已添加") });
    setOpen(false);
    resetAll();
  };

  const wrapPreview = startTag && endTag
    ? `/${escapeRegex(startTag)}[\\s\\S]*?${escapeRegex(endTag)}(\\n)?/gs`
    : '';
  const replacePreview = findText
    ? `/${escapeRegex(findText)}/g → "${replaceText}"`
    : '';

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetAll(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <Wand2 className="w-3 h-3" />{tr("快速添加")}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr("快速生成正则")}</DialogTitle>
          <DialogDescription>{tr("选择一种方式自动生成清理规则，无需手写正则")}</DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as QuickMode)}>
          <TabsList className="flex w-full">
            <TabsTrigger value="wrap" className="flex-1 whitespace-nowrap">{tr("标签包裹")}</TabsTrigger>
            <TabsTrigger value="replace" className="flex-1 whitespace-nowrap">{tr("内容替换")}</TabsTrigger>
            <TabsTrigger value="trim" className="flex-1 whitespace-nowrap">{tr("首尾删除")}</TabsTrigger>
          </TabsList>

          {/* 模式一：删除「开始标签…结束标签」之间的全部内容 */}
          <TabsContent value="wrap" className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="start-tag">{tr("开始标签")}</Label>
                <Input
                  id="start-tag"
                  value={startTag}
                  onChange={(e) => setStartTag(e.target.value)}
                  placeholder="<content>"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end-tag">{tr("结束标签")}</Label>
                <Input
                  id="end-tag"
                  value={endTag}
                  onChange={(e) => setEndTag(e.target.value)}
                  placeholder="</content>"
                />
              </div>
            </div>
            {wrapPreview && (
              <div className="space-y-2">
                <Label>{tr("预览正则")}</Label>
                <div className="p-3 bg-muted rounded-lg font-mono text-xs break-words">
                  {wrapPreview}
                </div>
              </div>
            )}
            <div className="text-xs text-muted-foreground space-y-1">
              <p>{tr("💡 删除标签及其之间的全部内容，常见示例：")}</p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li><code>&lt;thinking&gt;</code>{tr(" 和 ")}<code>&lt;/thinking&gt;</code></li>
                <li><code>&lt;status&gt;</code>{tr(" 和 ")}<code>&lt;/status&gt;</code></li>
              </ul>
            </div>
          </TabsContent>

          {/* 模式二：把指定内容整体替换为另一段（替换为空即为删除） */}
          <TabsContent value="replace" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="find-text">{tr("查找内容")}</Label>
              <Input
                id="find-text"
                value={findText}
                onChange={(e) => setFindText(e.target.value)}
                placeholder={tr("要替换的文字，如 AAA")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="replace-text">{tr("替换为")}</Label>
              <Input
                id="replace-text"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder={tr("留空表示删除，如 BBB")}
              />
            </div>
            {replacePreview && (
              <div className="space-y-2">
                <Label>{tr("预览")}</Label>
                <div className="p-3 bg-muted rounded-lg font-mono text-xs break-words">
                  {replacePreview}
                </div>
              </div>
            )}
            <div className="text-xs text-muted-foreground">{tr("💡 通篇把某段文字替换为另一段，例如把角色旧名「AAA」全部改成「BBB」；替换为空则直接删除该文字。按原文精确匹配，无需转义。")}</div>
          </TabsContent>

          {/* 模式三：删除消息开头→标记 / 标记→消息结尾 */}
          <TabsContent value="trim" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>{tr("删除方向")}</Label>
              <Select value={trimDirection} onValueChange={(v) => setTrimDirection(v as 'head' | 'tail')}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="head">{tr("从消息开头 删到 标记处")}</SelectItem>
                  <SelectItem value="tail">{tr("从标记处 删到 消息结尾")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="trim-marker">{tr("标记文字")}</Label>
              <Input
                id="trim-marker"
                value={trimMarker}
                onChange={(e) => setTrimMarker(e.target.value)}
                placeholder={trimDirection === 'head' ? tr("如 —— 正文开始 ——") : tr("如 【状态栏】")}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="trim-keep" checked={trimKeepMarker} onCheckedChange={(c) => setTrimKeepMarker(c === true)} />
              <Label htmlFor="trim-keep" className="text-sm font-normal cursor-pointer">{tr("保留标记文字本身（只删标记之外的部分）")}</Label>
            </div>
            {trimPattern && (
              <div className="space-y-2">
                <Label>{tr("预览正则")}</Label>
                <div className="p-3 bg-muted rounded-lg font-mono text-xs break-words">
                  /{trimPattern}/gs
                </div>
              </div>
            )}
            <div className="text-xs text-muted-foreground">{tr("💡 按")}<b>{tr("每条消息")}</b>{tr("处理：删除消息开头到标记")}<b>{tr("首次出现")}</b>{tr("处（或标记首次出现处到消息结尾）的全部内容。适合裁掉每楼固定的开场杂项 / 结尾状态栏。")}</div>
          </TabsContent>
        </Tabs>

        <div className="space-y-2">
          <Label htmlFor="rule-name">{tr("规则名称（可选）")}</Label>
          <Input
            id="rule-name"
            value={ruleName}
            onChange={(e) => setRuleName(e.target.value)}
            placeholder={tr("自定义规则")}
          />
        </div>

        <RegexDepthEditor rule={{ id: 'quick', name: '', findRegex: '', replaceString: '', placement: ['all'], disabled: false, ...depth }}
          onChange={patch => setDepth(current => ({ ...current, ...patch }))} />

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{tr("取消")}</Button>
          {mode === 'wrap' ? (
            <Button onClick={generateWrapRule} disabled={!startTag || !endTag}>{tr("生成规则")}</Button>
          ) : mode === 'replace' ? (
            <Button onClick={generateReplaceRule} disabled={!findText}>{tr("生成规则")}</Button>
          ) : (
            <Button onClick={generateTrimRule} disabled={!trimMarker}>{tr("生成规则")}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
