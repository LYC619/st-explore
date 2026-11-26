import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
/**
 * 角色页左信息栏：展开为 304px，收起为 36px；展开内容可滚动但不显示滚动轨道。
 * 立绘 3:4（点击 lightbox 放大）→ 信息行（名称/类型下拉/评分/最后游玩/字数/游玩时长 tooltip）
 * → 「操作」入口 → 右侧抽屉（编辑角色卡/读取内置资源/导出角色卡/删除角色卡）。
 */
import { useMemo, useEffect, useState  } from 'react';
import { BookOpen, Wrench, PackageOpen, Trash2, Upload, FileJson, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { ArchiveCharacter, ArchiveStory, CharacterType } from '@/types/archive';
import type { CharacterPatch } from '@/lib/character-write';
import type { NormalizedCharacterCard } from '@/lib/png-parser';
import { CHARACTER_TYPES } from '@/lib/archive-db';
import { formatPlayTime, formatWordCount } from '@/lib/story-meta';
import { formatListTime, formatFullTime } from '@/lib/time-display';
import { cn } from '@/lib/utils';
import { RatingPanel } from '@/components/character/RatingPanel';
import { NsfwImage } from '@/components/NsfwImage';
import { scopedGet, scopedSet } from '@/lib/vault/vault-scope';
import { getNsfwBlur } from '@/lib/local-settings';
import { shouldBlurNsfw } from '@/lib/nsfw-display';

interface CharacterInfoRailProps {
  character: ArchiveCharacter;
  norm: NormalizedCharacterCard;
  stories: ArchiveStory[];
  onPatch: (patch: CharacterPatch) => Promise<ArchiveCharacter>;
  onReadEmbedded: () => void;
  onExport: () => void;
  onExportJson?: () => void;
  onDelete: () => void;
  /**
   * 窄屏堆叠：不再是左侧 304px 独立滚动栏，而是页面顶部的一块
   * ——立绘缩到左边约四成宽，信息行放右边。整屏 3:4 的立绘在手机上
   * 一屏只剩封面，得往下滑两下才看得到信息。
   */
  stacked?: boolean;
}

function InfoRow({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-[color:var(--hairline-inner)] last:border-0">
      <span className="text-sm text-[color:var(--character-label)] shrink-0">{label}</span>
      <span className="text-sm text-[color:var(--text-primary)] text-right min-w-0 truncate" title={title}>
        {value}
      </span>
    </div>
  );
}

export function CharacterInfoRail({
  character, norm, stories, onPatch, onReadEmbedded, onExport, onExportJson, onDelete, stacked = false,
}: CharacterInfoRailProps) {
  useI18n();
  const [collapsed, setCollapsed] = useState(() => scopedGet('ste-character-info-collapsed') === '1');
  const toggleCollapsed = () => {
    scopedSet('ste-character-info-collapsed', collapsed ? '0' : '1');
    setCollapsed(!collapsed);
  };
  const [lightbox, setLightbox] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [nsfwRevealed, setNsfwRevealed] = useState(false);

  useEffect(() => {
    setNsfwRevealed(false);
  }, [character.id]);

  /** 聚合（10.0 物化字段）：字数=Σ故事、最后游玩=max、时长=Σ playTimeMs */
  const agg = useMemo(() => {
    let words = 0;
    let lastPlayed: number | undefined;
    let playMs = 0;
    let hasPlay = false;
    for (const s of stories) {
      words += s.wordCount ?? 0;
      if (s.lastMessageAt !== undefined && (lastPlayed === undefined || s.lastMessageAt > lastPlayed)) {
        lastPlayed = s.lastMessageAt;
      }
      if (typeof s.meta?.playTimeMs === 'number' && Number.isFinite(s.meta.playTimeMs)) {
        playMs += s.meta.playTimeMs;
        hasPlay = true;
      }
    }
    return { words, lastPlayed, playMs, hasPlay };
  }, [stories]);

  return (
    <aside
      data-character-info-rail={stacked ? 'stacked' : 'rail'}
      data-info-collapsed={collapsed}
      aria-label={tr("角色卡图与信息")}
      className={cn(
        'relative overflow-hidden border-[color:var(--hairline-inner)]',
        stacked ? 'shrink-0' : 'min-h-0',
        collapsed ? (stacked ? 'h-10 border-b' : 'w-9 shrink-0 border-r') : stacked
          ? 'border-b'
          : 'w-[304px] shrink-0 border-r flex flex-col',
      )}
    >
      <div hidden={collapsed} data-character-info-scroll aria-label={tr("角色信息内容")} tabIndex={!stacked && !collapsed ? 0 : undefined}
        className={cn('min-h-0', stacked ? 'px-4 pt-4 pb-14' : 'flex-1 pl-6 pr-10 pt-6 pb-6 overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand')}>
      <div className={cn(stacked && 'flex items-start gap-4')}>
      {/* 立绘 3:4（设计稿），点击放大 */}
      <button
        className={cn(
          'block aspect-[3/4] rounded-xl overflow-hidden bg-elevated border border-[color:var(--border-subtle)]',
          stacked ? 'w-[38%] max-w-[148px] shrink-0' : 'w-full',
        )}
        onClick={() => {
          if (!character.pngBase64) return;
          if (shouldBlurNsfw(character.nsfw, getNsfwBlur(), nsfwRevealed)) {
            setNsfwRevealed(true);
            return;
          }
          setLightbox(true);
        }}
        aria-label={tr("放大立绘")}
      >
        {character.pngBase64 ? (
          <NsfwImage
            src={`data:image/png;base64,${character.pngBase64}`}
            alt={character.name}
            nsfw={character.nsfw}
            revealed={nsfwRevealed}
            className="w-full h-full object-cover object-top"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <BookOpen className="w-10 h-10 text-muted-foreground/50" />
          </div>
        )}
      </button>

      {/* 信息行：仅在自定义了不同展示名时显示原卡名，避免与右侧标题重复 */}
      <div className={cn(stacked ? 'min-w-0 flex-1' : 'mt-4')}>
        {character.displayMeta?.name && character.displayMeta.name !== character.name && (
          <InfoRow label={tr("原卡名")} value={character.name} title={character.name} />
        )}
        <div className="flex items-center justify-between gap-3 py-2.5 border-b border-[color:var(--hairline-inner)]">
          <span className="text-sm text-[color:var(--character-label)] shrink-0">{tr("类型")}</span>
          <Select
            value={character.type ?? 'none'}
            onValueChange={(v) => { void onPatch({ type: v === 'none' ? undefined : (v as CharacterType) }).catch(() => {}); }}
          >
            <SelectTrigger className="h-7 w-24 text-xs" title={tr("类型：每张卡只归一类（替代旧版游玩状态）")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{tr("未分类")}</SelectItem>
              {CHARACTER_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-2 py-1.5 border-b border-[color:var(--hairline-inner)]">
          <span className="text-sm text-[color:var(--character-label)] shrink-0">{tr("评分")}</span>
          <RatingPanel character={character} norm={norm} stories={stories} onPatch={onPatch} />
        </div>
        <InfoRow
          label={tr("最后游玩")}
          value={agg.lastPlayed !== undefined ? formatListTime(agg.lastPlayed) : '—'}
          title={agg.lastPlayed !== undefined ? formatFullTime(agg.lastPlayed) : undefined}
        />
        <InfoRow label={tr("字数")} value={agg.words > 0 ? formatWordCount(agg.words) : '—'} title={tr("各故事正文字数相加")} />
        <InfoRow
          label={tr("游玩时长")}
          value={agg.hasPlay ? formatPlayTime({ totalMs: agg.playMs, sessionCount: 0, sampledMessages: 0 }) : tr("未统计")}
          title={tr("按消息时间戳估算：间隔超过 15 分钟视为离开，不计入时长")}
        />
      </div>
      </div>

      {/* 常用操作直达 + 更多抽屉 */}
      <div className="mt-4 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={onExport}
          title={tr("按当前角色卡原格式（PNG 或 JSON）一键导出")}
        >
          <Upload className="w-3.5 h-3.5 mr-1.5" />{tr("导出角色卡")}</Button>

        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" title={tr("更多文件级操作")}>
              <Wrench className="w-3.5 h-3.5 mr-1" />{tr("操作")}</Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-80">
            <SheetHeader>
              <SheetTitle>{tr("角色卡操作")}</SheetTitle>
              <SheetDescription>{tr("对这张卡的文件级操作；整理信息（类型/标签/评分）在页面上直接改。")}</SheetDescription>
            </SheetHeader>
            <div className="mt-5 flex flex-col gap-2">
              <Button
                variant="outline"
                className="justify-start"
                title={tr("重新扫描卡内嵌的世界书/正则并入库挂关联")}
                onClick={() => { setDrawerOpen(false); onReadEmbedded(); }}
              >
                <PackageOpen className="w-4 h-4 mr-2" />{tr("读取内置资源")}</Button>
              <Button variant="outline" className="justify-start" onClick={onExport}>
                <Upload className="w-4 h-4 mr-2" />{tr("导出角色卡（原格式）")}</Button>
              {onExportJson && <Button variant="outline" className="justify-start" onClick={onExportJson}>
                <FileJson className="w-4 h-4 mr-2" />{tr(" 导出角色卡 JSON")}</Button>}
              <Button
                variant="outline"
                className="justify-start text-destructive hover:text-destructive"
                onClick={() => { setDrawerOpen(false); onDelete(); }}
              >
                <Trash2 className="w-4 h-4 mr-2" />{tr("删除角色卡")}</Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      </div>

      <Button variant="ghost" size="icon" onClick={toggleCollapsed}
        className={cn('absolute bottom-2 bg-background/90 p-0 text-muted-foreground hover:text-foreground', stacked ? 'right-2' : 'right-0.5')}
        aria-expanded={!collapsed} aria-label={collapsed ? tr("展开角色卡图与信息") : tr("折叠角色卡图与信息")}
        title={collapsed ? tr("展开角色卡图与信息") : tr("折叠角色卡图与信息")}>
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </Button>

      {/* lightbox */}
      <Dialog open={lightbox} onOpenChange={setLightbox}>
        <DialogContent className="max-w-3xl p-2 bg-transparent border-0 shadow-none">
          <DialogTitle className="sr-only">{character.name}{tr(" 立绘")}</DialogTitle>
          {character.pngBase64 && (
            <NsfwImage
              src={`data:image/png;base64,${character.pngBase64}`}
              alt={character.name}
              nsfw={character.nsfw}
              revealed
              className="w-full max-h-[85vh] object-contain rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>
    </aside>
  );
}
