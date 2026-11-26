import { getLocale } from '@/lib/i18n';
import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useMemo, useState  } from 'react';
import { Upload, FileText, FileJson } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog';
import { HelpCard } from '@/components/HelpCard';
import { useToast } from '@/hooks/use-toast';
import { applyRegexRules, convertMessagesToTxt, convertMessagesToMarkdown, getMessageDepths } from '@/lib/regex-processor';
import { buildChatExportSession } from '@/lib/chat-export-policy';
import { serializeChatJsonl } from '@/lib/adapters/st/chat-jsonl';
import { saveTextFile } from '@/lib/roleplay/export-package-file';
import type { ChatSession, ExportSettings, ChapterMarker, STRawMessage } from '@/types/chat';

interface ExportButtonProps {
  session: ChatSession;
  settings: ExportSettings;
  markers?: ChapterMarker[];
  onSettingsChange?: (settings: ExportSettings) => void;
  /** 每次成功导出后回调（io 页记「上次导出时间」用） */
  onExported?: (format: 'txt' | 'md' | 'jsonl') => void;
}

const METADATA_KEEP_KEYS = [
  'chat_id_hash', 'note_prompt', 'note_interval',
  'note_position', 'note_depth', 'note_role',
  'tainted', 'variables', 'main_chat', 'timedWorldInfo'
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 真实 UTF-8 字节数（中文每字约 3 字节），而非 UTF-16 字符数。
const _sizeEncoder = new TextEncoder();
function byteLength(s: string): number {
  return _sizeEncoder.encode(s).length;
}

// 清洗文件名里的非法字符，避免 Windows 下下载失败/被截断（/ \ : * ? " < > | 及控制字符）。
function sanitizeFilename(name: string): string {
  const cleaned = (name || '')
    .replace(/[/\\:*?"<>|-]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '') // 去掉开头的点，避免隐藏文件
    .slice(0, 100);
  return cleaned || tr("未命名作品");
}

function getMessagesInRange(
  messages: import('@/types/chat').ChatMessage[],
  range: ExportSettings['exportRange'],
  recentCount: number,
  customStart: number,
  customEnd: number,
) {
  if (range === 'recent') {
    return messages.slice(-recentCount);
  }
  if (range === 'custom') {
    // 楼层号 0-based（按原始消息序号），范围 [customStart, customEnd] 闭区间
    const start = Math.max(0, customStart);
    const end = Math.min(messages.length, customEnd + 1);
    return messages.slice(start, end);
  }
  return messages;
}

function downloadBlob(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportButton({ session, settings, markers = [], onExported }: ExportButtonProps & { 'data-tour'?: string }) {
  useI18n();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  // Local settings state for dialog
  const [cleanPluginCache, setCleanPluginCache] = useState(settings.cleanPluginCache ?? true);
  const [slimExport, setSlimExport] = useState(settings.slimExport !== false);
  const [exportRange, setExportRange] = useState<'all' | 'recent' | 'custom'>(settings.exportRange ?? 'all');
  const [recentCount, setRecentCount] = useState(settings.recentCount ?? 100);
  const [customStart, setCustomStart] = useState(settings.customStart ?? 0);
  const [customEnd, setCustomEnd] = useState(settings.customEnd ?? Math.max(session.messages.length - 1, 0));

  const selectedMessages = useMemo(
    () => getMessagesInRange(session.messages, exportRange, recentCount, customStart, customEnd),
    [session.messages, exportRange, recentCount, customStart, customEnd]
  );
  const messageDepths = useMemo(() => getMessageDepths(session.messages), [session.messages]);

  const stats = useMemo(() => {
    const totalMessages = session.messages.length;
    const selectedCount = selectedMessages.length;
    const userCount = selectedMessages.filter(m => m.role === 'user' || m.is_user).length;
    const charCount = selectedCount - userCount;

    // 原始体积估算（导入时的 JSON 大小：含 swipes、未经正则清理），按真实 UTF-8 字节数
    const rawMetaSize = session.rawMetadata ? byteLength(JSON.stringify(session.rawMetadata)) : 100;
    const rawMsgSize = selectedMessages.reduce((acc, m) => {
      return acc + byteLength(JSON.stringify(m.rawData || { mes: m.content }));
    }, 0);
    const originalSize = rawMetaSize + rawMsgSize;

    // 导出体积估算（清理插件缓存 + 去 swipes + 应用正则后），同样按真实 UTF-8 字节数
    let estMetaSize = rawMetaSize;
    if (cleanPluginCache && session.rawMetadata?.chat_metadata) {
      const cm = session.rawMetadata.chat_metadata;
      const cleaned: Record<string, unknown> = {};
      for (const key of METADATA_KEEP_KEYS) {
        if (key in cm) {
          cleaned[key] = cm[key];
        }
      }
      estMetaSize = byteLength(JSON.stringify({ ...session.rawMetadata, chat_metadata: cleaned }));
    }

    const estMsgSize = selectedMessages.reduce((acc, m) => {
      const isUser = m.role === 'user' || m.is_user === true;
      const cleanedContent = applyRegexRules(m.content, settings.regexRules, isUser, messageDepths.get(m.id));
      if (!cleanedContent.trim()) return acc;
      const base: STRawMessage = m.rawData
        ? { ...m.rawData, mes: cleanedContent }
        : { mes: cleanedContent };
      if (slimExport) {
        base.swipes = [];
        base.swipe_id = 0;
        base.swipe_info = [];
      }
      return acc + byteLength(JSON.stringify(base));
    }, 0);
    const estimatedSize = estMetaSize + estMsgSize;

    const savings = originalSize > 0 ? Math.round((1 - estimatedSize / originalSize) * 100) : 0;

    return { totalMessages, selectedCount, userCount, charCount, originalSize, estimatedSize, savings };
  }, [selectedMessages, session, settings.regexRules, cleanPluginCache, slimExport, messageDepths]);

  const getExportMessages = () => selectedMessages;

  // 标题去掉导入时残留的「 - <时间戳> imported」后缀；角色/用户名为占位 unused 时省略该行。
  const getCleanTitle = () =>
    (session.title || tr("对话记录"))
      .replace(/\s*-\s*\d{4}-\d{2}-\d{2}@.*?imported\s*$/i, '')
      .replace(/\s+imported\s*$/i, '')
      .trim() || tr("对话记录");
  const isPlaceholder = (n: string) => !n || /^unused$/i.test(n.trim());

  const exportAsTxt = () => {
    const msgs = getExportMessages();
    const body = convertMessagesToTxt(msgs, settings.regexRules, settings.prefixMode, markers, session.messages);

    // 归档元数据头：标题 / 角色与用户 / 导出日期。
    const cleanTitle = getCleanTitle();
    const headerLines = [cleanTitle];
    if (!isPlaceholder(session.character.name) || !isPlaceholder(session.user.name)) {
      headerLines.push(`${session.character.name} & ${session.user.name}`);
    }
    headerLines.push(tr("导出于 {{v0}}", { v0: new Date().toLocaleDateString(getLocale()) }), '', '────────────────────', '');
    const txtContent = headerLines.join('\n') + body;

    const txtName = `${sanitizeFilename(cleanTitle)}.txt`;
    downloadBlob(txtName, txtContent, 'text/plain;charset=utf-8');

    toast({ title: tr("导出成功"), description: tr("已保存为 {{v0}}", { v0: txtName }) });
    onExported?.('txt');
    setOpen(false);
  };

  const exportAsMd = () => {
    const msgs = getExportMessages();
    const body = convertMessagesToMarkdown(msgs, settings.regexRules, settings.prefixMode, markers, session.messages);

    const cleanTitle = getCleanTitle();
    const headerLines = [`# ${cleanTitle}`, ''];
    if (!isPlaceholder(session.character.name) || !isPlaceholder(session.user.name)) {
      headerLines.push(`> ${session.character.name} & ${session.user.name} · ${tr("导出于 {{v0}}", { v0: new Date().toLocaleDateString(getLocale()) })}`, '');
    } else {
      headerLines.push(`> ${tr("导出于 {{v0}}", { v0: new Date().toLocaleDateString(getLocale()) })}`, '');
    }
    const mdContent = headerLines.join('\n') + '\n' + body + '\n';

    const mdName = `${sanitizeFilename(cleanTitle)}.md`;
    downloadBlob(mdName, mdContent, 'text/markdown;charset=utf-8');

    toast({ title: tr("导出成功"), description: tr("已保存为 {{v0}}", { v0: mdName }) });
    onExported?.('md');
    setOpen(false);
  };

  const exportAsJsonl = async () => {
    try {
      const snapshot = buildChatExportSession(session, { ...settings, cleanPluginCache, slimExport,
        exportRange, recentCount, customStart, customEnd });
      const jsonlName = `${sanitizeFilename(session.title)}_cleaned.jsonl`;
      const result = await saveTextFile({ fileName: jsonlName, text: serializeChatJsonl(snapshot),
        label: slimExport ? tr("SillyTavern JSONL（精简）") : 'SillyTavern JSONL', extension: 'jsonl' });
      if (result === 'cancelled') return;
      toast({ title: result === 'downloaded' ? tr("已发起下载") : result === 'shared' ? tr("已分享") : tr("导出成功"), description: jsonlName });
      onExported?.('jsonl'); setOpen(false);
    } catch (error) {
      toast({ title: tr("导出失败"), description: String(error), variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gold-gradient text-primary-foreground" data-tour="export-button">
          <Upload className="w-4 h-4 mr-2" />{tr("导出")}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1">{tr("导出设置")}<HelpCard>{tr("JSONL 可导回 SillyTavern 继续游玩；TXT 适合纯文本阅读，Markdown 带章节标题适合放进笔记软件。JSONL 默认导「精简工作副本」——只留当前选中的那版回复，可用下面的「精简导出」关掉；开启「清理插件缓存」时还会顺带去掉插件留下的临时状态。两项都关也不等同于整库备份。角色卡、世界书、预设和正则资产不会被这次导出改动。")}</HelpCard>
          </DialogTitle>
          <DialogDescription>{tr("选择导出范围和清理选项")}</DialogDescription>
        </DialogHeader>

        {/* Stats Panel */}
        <div className="rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
          <div className="flex justify-between">
            <span>{tr("总消息数: {{v0}} 条", { v0: stats.totalMessages })}</span>
            <span>{tr("选中: {{v0}} 条（用户 {{v1}} / 角色 {{v2}}）", { v0: stats.selectedCount, v1: stats.userCount, v2: stats.charCount })}</span>
          </div>
          <div className="flex justify-between">
            <span>{tr("原始大小: ")}{formatSize(stats.originalSize)}</span>
            <span>{tr("预估导出: ")}{formatSize(stats.estimatedSize)}
              {stats.savings > 0 && (
                <span className="text-primary ml-1">{tr("（节省 {{v0}}%）", { v0: stats.savings })}</span>
              )}
            </span>
          </div>
        </div>

        {/* Range Selection */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">{tr("消息范围")}</Label>
          <RadioGroup value={exportRange} onValueChange={(v) => setExportRange(v as 'all' | 'recent' | 'custom')} className="space-y-2">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="all" id="range-all" />
              <Label htmlFor="range-all" className="font-normal cursor-pointer">{tr("全部导出")}</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="recent" id="range-recent" />
              <Label htmlFor="range-recent" className="font-normal cursor-pointer">{tr("最近")}</Label>
              <Input size="sm"
                type="number"
                min={1}
                max={session.messages.length}
                value={recentCount}
                onChange={(e) => setRecentCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20 text-xs"
                disabled={exportRange !== 'recent'}
              />
              <span className="text-xs text-muted-foreground">{tr("条")}</span>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="custom" id="range-custom" />
              <Label htmlFor="range-custom" className="font-normal cursor-pointer">{tr("自定义")}</Label>
              <Input size="sm"
                type="number"
                min={0}
                max={session.messages.length - 1}
                value={customStart}
                onChange={(e) => setCustomStart(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-16 text-xs"
                disabled={exportRange !== 'custom'}
              />
              <span className="text-xs text-muted-foreground">~</span>
              <Input size="sm"
                type="number"
                min={0}
                max={session.messages.length - 1}
                value={customEnd}
                onChange={(e) => setCustomEnd(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-16 text-xs"
                disabled={exportRange !== 'custom'}
              />
              <span className="text-xs text-muted-foreground">{tr("楼")}</span>
            </div>
          </RadioGroup>
        </div>

        {/* Cleanup Options */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1">
                <Label className="text-sm">{tr("精简导出")}</Label>
                <HelpCard>
                  <div className="space-y-2">
                    <p>{tr("SillyTavern 的聊天记录里，每楼 AI 回复会把所有重Roll候选版本一起存着。常重新生成的话，一楼可能攒了十几个版本，文件体积就是这么涨起来的。")}</p>
                    <p>{tr("精简导出只保留当前正在看的那版回复，收起其余重Roll候选。消息正文全部原样保留——说话人、发送时间、生成模型与对话归属都在；完整对话流、角色人设、世界书绑定、预设、正则也都在。移除的只有没被选中的候选回复，以及（开启「清理插件缓存」时）部分插件留下的临时状态。")}</p>
                    <p>{tr("导回 SillyTavern 后可以照常接着聊，发给模型的上下文和精简前一致；唯一的区别是翻不回之前滑掉的旧候选了。")}</p>
                  </div>
                </HelpCard>
              </div>
              <p className="text-xs text-muted-foreground">{tr("只留当前选中的那版回复，体积通常能减半；关掉则所有重Roll候选原样带走")}</p>
            </div>
            <Switch checked={slimExport} onCheckedChange={setSlimExport} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm">{tr("清理插件缓存")}</Label>
              <p className="text-xs text-muted-foreground">{tr("移除部分插件留下的临时状态；不会改动角色卡、世界书、预设或正则资产")}</p>
            </div>
            <Switch checked={cleanPluginCache} onCheckedChange={setCleanPluginCache} />
          </div>
        </div>

        {/* Export Buttons */}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={exportAsTxt}>
            <FileText className="w-4 h-4 mr-2" />
            TXT
          </Button>
          <Button variant="outline" className="flex-1" onClick={exportAsMd}>
            <FileText className="w-4 h-4 mr-2" />
            Markdown
          </Button>
          <Button className="flex-1 gold-gradient text-primary-foreground" onClick={exportAsJsonl}>
            <FileJson className="w-4 h-4 mr-2" />
            JSONL
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
