/**
 * 角色卡主页 · 关联资产 tab：
 * 三类资产（世界书/预设/正则，引用制）+ 引用摘录（quotes）+ 关联文件（attachments）。
 * 右侧预览抽屉与删除确认弹窗拆至 AssetPreviewSheet。
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Globe,
  SlidersHorizontal,
  Regex as RegexIcon,
  Quote as QuoteIcon,
  Plus,
  X,
  Wrench,
  PackageOpen,
  Download,
  Search,
  Paperclip,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import type {
  ArchiveCharacter,
  AssetKind,
  AssetRef,
  QuoteAsset,
  STAssetRelation,
} from '@/types/archive';
import type { CharacterPatch } from '@/lib/character-write';
import type { WorldBookEntry } from '@/types/worldbook';
import { getAllWorldBooks } from '@/lib/worldbook-db';
import { getAllPresets } from '@/lib/preset-db';
import { presetOptionLabel } from '@/lib/preset-catalog';
import { getAllRegexCollections } from '@/lib/regex-db';
import { addAssetRef, removeAssetRef } from '@/lib/asset-cow';
import { formatListTime, formatFullTime } from '@/lib/time-display';
import { buildQuotePreview } from '@/lib/asset-preview';
import { getActiveVault } from '@/lib/vault/active';
import {
  attachmentsSupported,
  externalOpenSupported,
  loadAttachmentViews,
  openAttachmentExternally,
  removeAttachment,
  type AttachmentView,
} from '@/lib/attachment-store';
import { formatArchiveBytes } from '@/lib/vault/other-assets';
import { AssetPreviewSheet, type AssetView } from './AssetPreviewSheet';

const PREVIEW_LIMIT = 8;

const RELATION_LABELS: Record<STAssetRelation, string> = {
  embedded: '卡内嵌',
  primary: '主绑定',
  extra: '额外链接',
  chat: '对话级',
};

const KIND_META: Record<AssetView['kind'], { label: string; icon: typeof Globe; toolPath: string; unit: string }> = {
  worldbook: { label: '世界书', icon: Globe, toolPath: '/worldbook', unit: '条目' },
  preset: { label: '预设', icon: SlidersHorizontal, toolPath: '/preset', unit: '提示词块' },
  regex: { label: '正则', icon: RegexIcon, toolPath: '/regex', unit: '规则' },
  quote: { label: '引用', icon: QuoteIcon, toolPath: '', unit: '段' },
  file: { label: '文件', icon: Paperclip, toolPath: '', unit: '' },
};

function isLibraryAsset(kind: AssetView['kind']): kind is AssetKind {
  return kind !== 'quote' && kind !== 'file';
}

interface AssetSectionProps {
  character: ArchiveCharacter;
  onAssetsChange: (assets: AssetRef[]) => Promise<void>;
  onQuotesChange: (quotes: QuoteAsset[]) => Promise<void>;
  onPatch: (patch: CharacterPatch) => Promise<ArchiveCharacter>;
  onReadEmbedded: () => Promise<void>;
  onOpenImport: () => void;
}

export function AssetSection({
  character,
  onAssetsChange,
  onQuotesChange,
  onPatch,
  onReadEmbedded,
  onOpenImport,
}: AssetSectionProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [library, setLibrary] = useState<AssetView[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [failedKinds, setFailedKinds] = useState<ReadonlySet<AssetKind>>(() => new Set());
  const [attachmentLoadFailed, setAttachmentLoadFailed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [preview, setPreview] = useState<AssetView | null>(null);
  const [quoteToDelete, setQuoteToDelete] = useState<QuoteAsset | null>(null);
  const [fileToDelete, setFileToDelete] = useState<AttachmentView | null>(null);
  const [deletingFile, setDeletingFile] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentView[]>([]);
  const loadSeqRef = useRef(0);
  const attachSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setPreview(null);
    setAddOpen(false);
    setQuoteToDelete(null);
    setFileToDelete(null);
    setAttachments([]);
  }, [character.id]);

  const loadLibrary = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    const failed = new Set<AssetKind>();
    const [wbs, presets, regexes] = await Promise.all([
      getAllWorldBooks().catch(() => { failed.add('worldbook'); return []; }),
      getAllPresets().catch(() => { failed.add('preset'); return []; }),
      getAllRegexCollections().catch(() => { failed.add('regex'); return []; }),
    ]);
    if (!mountedRef.current || seq !== loadSeqRef.current) return;
    const views: AssetView[] = [
      ...wbs.map((w): AssetView => {
        const entries = Object.values<WorldBookEntry>(w.worldbook?.entries ?? {});
        return {
          kind: 'worldbook', id: w.id, title: w.title, updatedAt: w.updatedAt, derived: w.derived,
          entries: entries.slice(0, PREVIEW_LIMIT).map((e) => ({
            title: e.comment || `条目 ${e.uid}`,
            keys: e.key.join(', ') || undefined,
            body: e.content,
          })),
          count: entries.length,
        };
      }),
      ...presets.map((p): AssetView => ({
        kind: 'preset', id: p.id, title: presetOptionLabel(p), updatedAt: p.updatedAt, derived: p.derived,
        entries: p.preset.prompts.slice(0, PREVIEW_LIMIT).map((b) => ({
          title: b.name || b.identifier,
          body: b.marker ? '（系统插槽，运行时动态填充）' : b.content,
        })),
        count: p.preset.prompts.length,
      })),
      ...regexes.map((r): AssetView => ({
        kind: 'regex', id: r.id, title: r.title, updatedAt: r.updatedAt, derived: r.derived,
        entries: r.rules.slice(0, PREVIEW_LIMIT).map((x) => ({
          title: x.name,
          keys: x.findRegex,
          body: x.replaceString ? `→ ${x.replaceString}` : '→（删除匹配内容）',
        })),
        count: r.rules.length,
      })),
    ];
    setFailedKinds(failed);
    setLibrary(views);
    setLibraryLoaded(true);
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary, character.assets]);

  const reloadAttachments = useCallback(async () => {
    const seq = ++attachSeqRef.current;
    setAttachmentLoadFailed(false);
    try {
      const next = await loadAttachmentViews(character);
      if (!mountedRef.current || seq !== attachSeqRef.current) return;
      setAttachments(next);
    } catch {
      if (!mountedRef.current || seq !== attachSeqRef.current) return;
      setAttachments([]);
      setAttachmentLoadFailed(true);
    }
  }, [character]);

  useEffect(() => {
    void reloadAttachments();
    return () => { attachSeqRef.current += 1; };
  }, [reloadAttachments]);

  const refs = useMemo(() => character.assets ?? [], [character.assets]);
  const quotes = character.quotes ?? [];
  const linked: AssetView[] = refs.flatMap((ref): AssetView[] => {
    const asset = library.find((a) => a.kind === ref.kind && a.id === ref.assetId);
    return asset ? [{ ...asset, relations: ref.relations }] : [];
  });
  const quoteViews = quotes.map((q): AssetView => {
    const quotePreview = buildQuotePreview(q.body);
    return {
      kind: 'quote', id: q.id, title: q.title, updatedAt: q.addedAt,
      entries: quotePreview.entries,
      count: quotePreview.count,
    };
  });
  const canAttach = attachmentsSupported();
  const canOpenExternally = externalOpenSupported();
  const fileViews = attachments.map((file): AssetView => ({
    kind: 'file', id: file.id, title: file.title, updatedAt: file.addedAt,
    entries: [], count: 0, file,
  }));
  const items = [...linked, ...quoteViews, ...fileViews];
  const broken = libraryLoaded
    ? refs.filter((ref) => !failedKinds.has(ref.kind) && !library.some((a) => a.kind === ref.kind && a.id === ref.assetId))
    : [];
  const unresolved = character.unresolvedAssets ?? [];
  const linkable = useMemo(
    () => library.filter((a) => !refs.some((r) => r.kind === a.kind && r.assetId === a.id)),
    [library, refs],
  );

  const addGroups = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    const hit = q ? linkable.filter((a) => a.title.toLowerCase().includes(q)) : linkable;
    return (['worldbook', 'preset', 'regex'] as const)
      .map((kind) => ({ kind, assets: hit.filter((a) => a.kind === kind) }))
      .filter((g) => g.assets.length > 0);
  }, [addQuery, linkable]);

  const handleAdd = async (a: AssetView) => {
    try {
      await onAssetsChange(addAssetRef(refs, a.kind as AssetKind, a.id));
      setAddOpen(false);
      toast({ title: `已关联${KIND_META[a.kind].label}「${a.title}」`, description: '只记引用，不复制内容' });
    } catch {
      // 父层已提示失败；保留选择面板。
    }
  };

  const handleRemove = async (kind: AssetKind, assetId: string, title?: string) => {
    try {
      await onAssetsChange(removeAssetRef(refs, kind, assetId));
      toast({ title: `已移除引用${title ? `「${title}」` : ''}`, description: '资产本体仍在资产库中' });
    } catch {
      // 父层已提示失败。
    }
  };

  const handleReadEmbedded = async () => {
    try {
      await onReadEmbedded();
      await loadLibrary();
    } catch {
      // 父层已提示失败。
    }
  };

  const openEditor = (a: AssetView) => {
    navigate(`${KIND_META[a.kind].toolPath}?assetId=${encodeURIComponent(a.id)}&characterId=${encodeURIComponent(character.id)}`);
  };

  const handleOpenExternally = async (file: AttachmentView, reveal: boolean) => {
    try {
      await openAttachmentExternally(file.characterId, file.id, reveal);
    } catch (error) {
      toast({
        title: reveal ? '在文件管理器中显示失败' : '调用外部程序失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const handleDeleteFile = async (file: AttachmentView, deleteFile = true) => {
    if (deletingFile || file.characterId !== character.id) return;
    setDeletingFile(true);
    try {
      await removeAttachment(file.characterId, file.id, deleteFile, (_id, updater) => onPatch(updater));
      setFileToDelete(null);
      if (preview?.kind === 'file' && preview.file?.id === file.id) setPreview(null);
      toast({
        title: `已移除关联文件「${file.title}」`,
        description: deleteFile ? (getActiveVault()?.fs.trashFile ? '文件已放进系统回收站' : '文件已删除') : '已移除记录，文件未删除',
      });
    } catch (error) {
      toast({
        title: '移除关联文件失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
      const refreshed = await loadAttachmentViews(character).catch(() => null);
      if (refreshed) {
        setAttachments(refreshed);
        setFileToDelete(refreshed.find((item) => item.id === file.id) ?? null);
      }
    } finally {
      setDeletingFile(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-muted-foreground mr-auto">世界书 / 预设 / 正则（引用制）+ 引用摘录 + 关联文件</span>
        <Button variant="outline" size="sm" title="重新扫描卡内嵌的世界书/正则并入库挂关联" onClick={() => void handleReadEmbedded()}>
          <PackageOpen className="w-3.5 h-3.5 mr-1" />
          读取内置资源
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenImport}>
          <Download className="w-3.5 h-3.5 mr-1" />
          导入资产
        </Button>
        <Popover open={addOpen} onOpenChange={(v) => { setAddOpen(v); if (v) setAddQuery(''); }}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="w-3.5 h-3.5 mr-1" />
              添加引用
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[26rem] p-3" align="end">
            <p className="text-sm font-medium mb-2">从资产库选择</p>
            {!libraryLoaded ? (
              <p className="text-xs text-muted-foreground">正在读取资产库…</p>
            ) : linkable.length === 0 && failedKinds.size > 0 ? (
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>部分资产目录（{[...failedKinds].map((k) => KIND_META[k].label).join('、')}）暂时没能读取出来。</p>
                <Button variant="outline" size="sm" onClick={() => void loadLibrary()}>重新读取</Button>
              </div>
            ) : linkable.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                资产库里没有可关联的条目。先在处理区的世界书/预设/正则工具里保存资产。
              </p>
            ) : (
              <div className="space-y-2">
                {failedKinds.size > 0 && (
                  <p className="text-[11px] text-[color:var(--status-warn)]">
                    注：{[...failedKinds].map((k) => KIND_META[k].label).join('、')}暂未读取成功，仅列出已读出的资产。
                  </p>
                )}
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    size="sm"
                    value={addQuery}
                    onChange={(e) => setAddQuery(e.target.value)}
                    placeholder={`搜索 ${linkable.length} 个可关联资产`}
                    className="pl-7"
                    autoFocus
                  />
                </div>
                <ScrollArea className="h-72 -mx-1 px-1">
                  {addGroups.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">没有匹配「{addQuery}」的资产</p>
                  ) : (
                    <div className="space-y-2">
                      {addGroups.map(({ kind, assets }) => (
                        <div key={kind} className="space-y-0.5">
                          <p className="px-1 pt-1 text-[11px] font-medium text-muted-foreground">
                            {KIND_META[kind].label} · {assets.length}
                          </p>
                          {assets.map((a) => {
                            const Icon = KIND_META[a.kind].icon;
                            return (
                              <button
                                key={`${a.kind}-${a.id}`}
                                type="button"
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/40 text-sm text-left"
                                onClick={() => void handleAdd(a)}
                              >
                                <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <span className="flex-1 min-w-0 truncate" title={a.title}>{a.title}</span>
                                {a.derived && <Badge variant="outline" className="h-4 px-1 text-[11px] shrink-0">派生</Badge>}
                                <span className="text-[11px] text-muted-foreground shrink-0">
                                  {a.count} {KIND_META[a.kind].unit}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {failedKinds.size > 0 && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-[color:var(--text-body)]">
          <span>
            部分资产目录（{[...failedKinds].map((k) => KIND_META[k].label).join('、')}）暂时没能读取出来，对应关联不会误标为失效。
          </span>
          <Button variant="outline" size="sm" onClick={() => void loadLibrary()}>重新读取</Button>
        </div>
      )}
      {attachmentLoadFailed && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-[color:var(--text-body)]">
          <span>关联文件状态暂时没能读取出来，原文件仍保存在库里。</span>
          <Button variant="outline" size="sm" onClick={() => void reloadAttachments()}>重新读取</Button>
        </div>
      )}

      {items.length === 0 && broken.length === 0 && unresolved.length === 0 && failedKinds.size === 0 && !attachmentLoadFailed ? (
        <p className="text-xs text-muted-foreground">
          还没有关联资产。角色用到的世界书/预设/正则可以在这里挂引用；在角色上下文里修改共享资产时，
          会自动生成「资产名_{character.name}」的派生副本，不影响其他角色。摘录、语料片段可从「导入资产」进来
          {canAttach ? '；发布页存的 html、同人视频这类文件也可以从「关联文件」一栏挂上来。' : '。'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {items.map((a) => {
            const meta = KIND_META[a.kind];
            const Icon = meta.icon;
            const isOwnDerived = a.derived?.characterId === character.id;
            return (
              <div
                key={`${a.kind}-${a.id}`}
                role="button"
                tabIndex={0}
                className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:border-primary/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setPreview(a)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setPreview(a);
                  }
                }}
                title="点击查看条目预览"
              >
                <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="min-w-0 truncate font-medium" title={a.title}>{a.title}</span>
                <Badge variant="outline" className="h-4 px-1 text-[11px] text-muted-foreground shrink-0">{meta.label}</Badge>
                {a.file?.missing && (
                  <Badge variant="outline" className="h-4 px-1 text-[11px] text-[color:var(--status-warn)] shrink-0" title={`文件不在库里了：${a.file.path}`}>
                    文件缺失
                  </Badge>
                )}
                {isLibraryAsset(a.kind) && (
                  a.derived ? (
                    <Badge variant="secondary" className="h-4 px-1 text-[11px] shrink-0" title={isOwnDerived ? '本角色的派生副本' : '其他角色的派生副本'}>
                      派生{isOwnDerived ? '' : '(他人)'}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="h-4 px-1 text-[11px] text-muted-foreground shrink-0">共享</Badge>
                  )
                )}
                {a.relations?.map((relation) => (
                  <Badge key={relation} variant="outline" className="h-4 px-1 text-[11px] text-primary shrink-0">
                    {RELATION_LABELS[relation]}
                  </Badge>
                ))}
                <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                  {a.file ? formatArchiveBytes(a.file.actualSize) : `${a.count} ${meta.unit}`}
                </span>
                <span className="ml-auto text-xs text-muted-foreground shrink-0 hidden sm:inline" title={formatFullTime(a.updatedAt)}>
                  {formatListTime(a.updatedAt)}
                </span>
                {isLibraryAsset(a.kind) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={(e) => { e.stopPropagation(); openEditor(a); }}
                  >
                    <Wrench className="w-3.5 h-3.5 mr-1" />
                    处理
                  </Button>
                )}
                {a.file && !a.file.missing && canOpenExternally && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    title="用系统默认程序打开这个文件"
                    onClick={(e) => { e.stopPropagation(); void handleOpenExternally(a.file!, false); }}
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1" />
                    打开
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isLibraryAsset(a.kind)) void handleRemove(a.kind, a.id, a.title);
                    else if (a.kind === 'file') setFileToDelete(a.file!);
                    else setQuoteToDelete(quotes.find((q) => q.id === a.id) ?? null);
                  }}
                  aria-label={a.kind === 'file' ? '移除关联文件' : a.kind === 'quote' ? '删除引用' : '移除引用'}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            );
          })}
          {broken.map((ref) => (
            <div key={`${ref.kind}-${ref.assetId}`} className="flex items-center gap-2.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
              <span className="min-w-0 truncate" title={`引用的${KIND_META[ref.kind].label}已被删除`}>引用的{KIND_META[ref.kind].label}已被删除</span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => void handleRemove(ref.kind, ref.assetId)}
              >
                移除失效引用
              </Button>
            </div>
          ))}
          {unresolved.map((ref) => (
            <div key={`${ref.kind}-${ref.relation}-${ref.name}`} className="flex items-center gap-2.5 rounded-lg border border-dashed border-[var(--status-warn-bg)] px-3 py-2 text-sm">
              <Globe className="w-4 h-4 text-[color:var(--status-warn)] shrink-0" />
              <span className="min-w-0 truncate" title={`未找到世界书「${ref.name}」`}>未找到世界书「{ref.name}」</span>
              <Badge variant="outline" className="ml-auto h-4 px-1 text-[11px] text-[color:var(--status-warn)] shrink-0">
                {RELATION_LABELS[ref.relation]}
              </Badge>
            </div>
          ))}
        </div>
      )}

      <AssetPreviewSheet
        preview={preview}
        onClosePreview={() => setPreview(null)}
        kindLabels={KIND_META}
        canOpenExternally={canOpenExternally}
        onOpenEditor={openEditor}
        onOpenExternally={(file, reveal) => { void handleOpenExternally(file, reveal); }}
        quoteToDelete={quoteToDelete}
        onCloseQuoteDelete={() => setQuoteToDelete(null)}
        onConfirmQuoteDelete={(target) => {
          void onQuotesChange(quotes.filter((q) => q.id !== target.id))
            .then(() => {
              setQuoteToDelete(null);
              toast({ title: `已删除引用「${target.title}」` });
            })
            .catch(() => {});
        }}
        fileToDelete={fileToDelete}
        deletingFile={deletingFile}
        onCloseFileDelete={() => setFileToDelete(null)}
        onConfirmFileDelete={(file, deletePhysical) => { void handleDeleteFile(file, deletePhysical); }}
      />
    </div>
  );
}
