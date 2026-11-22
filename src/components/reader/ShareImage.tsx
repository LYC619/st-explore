/**
 * 分享图生成：从阅读界面或对话楼层一键生成带故事标题、名场面台词与楼层落款的书摘分享卡片。
 *
 * - 移动端（Capacitor）：写入缓存并调起系统分享面板（用户取消分享时不误报错误）。
 * - 桌面端（Tauri）：调起原生保存文件对话框。
 * - 网页端：安全清洗文件名后触发浏览器下载。
 * - 默认触发按钮仅在 Capacitor 原生壳渲染（除非显式传入 allowAllPlatforms）。
 */
import { useEffect, useState, useRef, type SyntheticEvent } from 'react';
import { Share as ShareIcon, Loader2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { isCapacitor } from '@/lib/runtime';
import { bytesToBase64 } from '@/lib/utils';
import {
  canvasToPngBlob, measureWith, themeHsl, watermarkInk, wrapText,
} from '@/lib/share-image';

interface ShareImageProps {
  /** 故事标题 */
  storyTitle: string;
  /** 角色名（可选，用于水印） */
  characterName?: string;
  /** 当前楼层号（用于水印「第 N 楼」） */
  currentFloor: number;
  /** 当前段落文本（作为默认分享内容） */
  currentText: string;
  /** 触发按钮的无障碍标签 */
  triggerLabel?: string;
  /** 对话框开合回调 */
  onOpenChange?: (open: boolean) => void;
  /** 允许在桌面与网页端打开（如对话楼层名场面分享图） */
  allowAllPlatforms?: boolean;
  /** 受控打开状态（用于外部按钮直接唤起，无需渲染触发器） */
  controlledOpen?: boolean;
  /** 不渲染默认触发按钮 */
  hideTrigger?: boolean;
}

const GRADIENTS = [
  {
    id: 'theme-warm',
    label: '琥珀剧场（跟随主题暖调）',
    resolve: () => ({
      start: themeHsl('--brand-hsl', '#e08a4a'),
      end: themeHsl('--elevated-strong-hsl', '#4a2e1b'),
    }),
  },
  {
    id: 'theme-cool',
    label: '夜读藏书（跟随主题深调）',
    resolve: () => ({
      start: themeHsl('--chrome-hsl', '#1a1a2e'),
      end: themeHsl('--canvas-hsl', '#16213e'),
    }),
  },
  { id: 'parchment', label: '温润羊皮纸', resolve: () => ({ start: '#f3ead8', end: '#e2d3b5' }) },
  { id: 'neutral-dark', label: '沉静墨夜', resolve: () => ({ start: '#1a1a2e', end: '#16213e' }) },
];

const MAX_BODY_LINES = 14;

function cleanShareMarkdown(raw: string): string {
  return raw
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .trim();
}

function sanitizeExportFileName(raw: string): string {
  const cleaned = Array.from(raw, (ch) => (ch.charCodeAt(0) < 32 || /[\\/:*?"<>|]/.test(ch) ? '_' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'share-card';
}

interface ShareSnapshot {
  storyTitle: string;
  characterName?: string;
  floor: number;
  text: string;
}

const stopReaderEvent = (event: SyntheticEvent) => event.stopPropagation();
const readerToolEvents = {
  'data-reader-tool': true,
  onClick: stopReaderEvent,
  onPointerDown: stopReaderEvent,
  onTouchStart: stopReaderEvent,
  onTouchEnd: stopReaderEvent,
};

export function ShareImage({
  storyTitle, characterName, currentFloor, currentText, triggerLabel = '生成分享图',
  onOpenChange,
  allowAllPlatforms = false,
  controlledOpen,
  hideTrigger = false,
}: ShareImageProps) {
  const { toast } = useToast();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [text, setText] = useState(currentText);
  const [snapshot, setSnapshot] = useState<ShareSnapshot | null>(null);
  const [gradient, setGradient] = useState(GRADIENTS[0].id);
  const [generating, setGenerating] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dialogSession = useRef(0);
  useEffect(() => () => { ++dialogSession.current; }, []);

  useEffect(() => {
    if (controlledOpen) {
      ++dialogSession.current;
      setGenerating(false);
      const nextSnapshot = { storyTitle, characterName, floor: currentFloor, text: currentText };
      setSnapshot(nextSnapshot);
      setText(nextSnapshot.text);
    } else if (controlledOpen === false) {
      setSnapshot(null);
    }
  }, [controlledOpen, storyTitle, characterName, currentFloor, currentText]);

  const changeOpen = (next: boolean) => {
    ++dialogSession.current;
    setGenerating(false);
    if (next && !open) {
      const nextSnapshot = { storyTitle, characterName, floor: currentFloor, text: currentText };
      setSnapshot(nextSnapshot);
      setText(nextSnapshot.text);
    } else if (!next) setSnapshot(null);
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const selectedGradient = GRADIENTS.find((g) => g.id === gradient) ?? GRADIENTS[0];
  const previewColors = open ? selectedGradient.resolve() : { start: '#e08a4a', end: '#4a2e1b' };
  const previewInk = open ? watermarkInk(previewColors.start, previewColors.end) : { title: '#fff', meta: '#eee' };
  const cleanedText = cleanShareMarkdown(text);

  const handleGenerate = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !snapshot) return;
    const session = dialogSession.current;
    const isCurrent = () => dialogSession.current === session;

    setGenerating(true);
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('当前环境不支持画布渲染');

      const width = 750;
      const height = 1000;
      canvas.width = width;
      canvas.height = height;

      const selected = GRADIENTS.find((g) => g.id === gradient) ?? GRADIENTS[0];
      const colors = selected.resolve();
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, colors.start);
      grad.addColorStop(1, colors.end);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = 'rgba(252, 249, 242, 0.96)';
      if (typeof ctx.beginPath === 'function' && typeof ctx.roundRect === 'function' && typeof ctx.fill === 'function') {
        ctx.beginPath();
        ctx.roundRect(40, 40, width - 80, height * 0.7 - 60, 20);
        ctx.fill();
      } else {
        ctx.fillRect(40, 40, width - 80, height * 0.7 - 60);
      }

      ctx.fillStyle = '#241c15';
      ctx.font = '27px "Noto Serif SC", "Songti SC", Georgia, serif';
      ctx.textBaseline = 'top';
      const lines = wrapText(measureWith(ctx), cleanedText || text, width - 128);

      const lineHeight = 40;
      const textStartY = 72;
      lines.slice(0, MAX_BODY_LINES).forEach((ln, i) => {
        ctx.fillText(ln, 64, textStartY + i * lineHeight);
      });
      if (lines.length > MAX_BODY_LINES) {
        ctx.fillText('……', 64, textStartY + MAX_BODY_LINES * lineHeight);
      }

      const watermarkY = height * 0.7 + 20;
      const ink = watermarkInk(colors.start, colors.end);
      ctx.fillStyle = ink.title;
      ctx.font = 'bold 24px "Noto Serif SC", "Songti SC", serif';
      ctx.fillText(snapshot.storyTitle, 60, watermarkY);

      ctx.fillStyle = ink.meta;
      ctx.font = '18px system-ui, sans-serif';
      const meta = snapshot.characterName ? `${snapshot.characterName} · 第 ${snapshot.floor} 楼` : `第 ${snapshot.floor} 楼`;
      ctx.fillText(meta, 60, watermarkY + 40);

      const blob = await canvasToPngBlob(canvas);
      if (!isCurrent()) return;

      if (isCapacitor()) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const { Share } = await import('@capacitor/share');
        if (!isCurrent()) return;
        const fileName = `share-${snapshot.floor}.png`;
        const { uri } = await Filesystem.writeFile({
          path: fileName,
          data: bytesToBase64(bytes),
          directory: Directory.Cache,
        });
        if (!isCurrent()) return;
        try {
          await Share.share({ title: '分享名场面卡片', url: uri, dialogTitle: '分享到' });
        } catch (shareErr) {
          if (/cancel/i.test(String(shareErr))) return;
          throw shareErr;
        }
        if (!isCurrent()) return;
        toast({ description: '已调起分享面板' });
      } else if ('__TAURI_INTERNALS__' in window) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const { saveBinaryExport } = await import('@/lib/vault/tauri-fs');
        if (!isCurrent()) return;
        const safeBase = sanitizeExportFileName(`${snapshot.storyTitle}-${snapshot.floor}`);
        const saved = await saveBinaryExport({
          fileName: `${safeBase}.png`,
          extension: 'png',
          base64: bytesToBase64(bytes),
        });
        if (!isCurrent() || !saved) return;
        toast({ description: '名场面分享图已保存' });
      } else {
        const safeBase = sanitizeExportFileName(`${snapshot.storyTitle}-${snapshot.floor}`);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeBase}.png`;
        try {
          document.body.append(a);
          a.click();
        } finally {
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        toast({ description: '名场面分享图已下载' });
      }

      changeOpen(false);
    } catch (err) {
      if (!isCurrent()) return;
      toast({
        variant: 'destructive',
        description: `生成失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      if (isCurrent()) setGenerating(false);
    }
  };

  if (!allowAllPlatforms && !isCapacitor()) return null;

  const activeSnapshot = snapshot ?? { storyTitle, characterName, floor: currentFloor, text };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={triggerLabel} {...readerToolEvents}>
            <ShareIcon className="h-4 w-4" />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto" {...readerToolEvents}>
        <DialogHeader>
          <DialogTitle className="font-serif">生成名场面分享图</DialogTitle>
          <DialogDescription>微调摘录文字与书摘底纸配色，生成可收藏或分享的卡片</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* 实时书摘卡片预览 */}
          <div
            data-share-card-preview
            className="rounded-xl p-3.5 shadow-inner transition-colors"
            style={{
              background: `linear-gradient(135deg, ${previewColors.start}, ${previewColors.end})`,
            }}
          >
            <div className="rounded-lg bg-[#fcf9f2]/95 px-4 py-3.5 text-[#241c15] shadow-sm">
              <p className="font-serif text-xs leading-relaxed whitespace-pre-wrap line-clamp-6">
                {cleanedText || '在下方输入想留念的台词或描写…'}
              </p>
            </div>
            <div className="mt-2.5 px-1">
              <div className="font-serif text-xs font-semibold truncate" style={{ color: previewInk.title }}>
                {activeSnapshot.storyTitle}
              </div>
              <div className="text-[11px] truncate" style={{ color: previewInk.meta }}>
                {activeSnapshot.characterName
                  ? `${activeSnapshot.characterName} · 第 ${activeSnapshot.floor} 楼`
                  : `第 ${activeSnapshot.floor} 楼`}
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="share-text">摘录台词</Label>
            <Textarea
              id="share-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              className="mt-1.5 text-sm leading-relaxed"
              placeholder="输入想制作成书摘卡片的台词或描写…"
            />
          </div>
          <div>
            <Label htmlFor="share-gradient">卡片底色</Label>
            <Select value={gradient} onValueChange={setGradient}>
              <SelectTrigger id="share-gradient" className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent {...readerToolEvents}>
                {GRADIENTS.map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleGenerate} disabled={generating || !text.trim()} className="flex-1">
              {generating ? (
                <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />正在绘制卡片…</>
              ) : (
                <><Download className="mr-1.5 h-4 w-4" />生成并分享</>
              )}
            </Button>
          </div>
        </div>
        <canvas ref={canvasRef} className="hidden" />
      </DialogContent>
    </Dialog>
  );
}
