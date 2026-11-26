import { getLocale } from '@/lib/i18n';
import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
/** 聊天处理外的编辑区入口选择页：总结/故事树选故事，世界书选资产；旧预设入口转到独立预设库。 */
import { useState, useEffect, useCallback } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarRange, MessageSquare, Plus, Search, DownloadCloud } from 'lucide-react';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { guessFileType, TOOL_TYPE_LABELS, type ToolFileType } from '@/lib/file-type-guess';
import { setPendingToolFile } from '@/lib/tool-handoff';
import { listCharacterIndex, listStoryIndex, type StoryIndexEntry, type CharacterIndexEntry } from '@/lib/archive-index';
import { listAssetIndex } from '@/lib/asset-index';
import {
  buildEditorStoryPickerItems,
  EDITOR_TOOL_COPY,
  storyWorkspaceViewForEditorFocus,
} from '@/lib/home-layout';
import { buildEditorStoryPath, getEditorStoryId, setEditorStoryId } from '@/lib/editor-story-context';
import { LOADING_LABEL } from '@/lib/ui-copy';
import { presetLibraryRedirect } from '@/lib/navigation-model';

interface ToolEntry {
  type: ToolFileType;
  label: string;
  path: string;
}

const TOOLS: ToolEntry[] = [
  { type: 'chat', get label() { return tr("聊天处理"); }, path: '/chat' },
  { type: 'worldbook', get label() { return tr("世界书"); }, path: '/worldbook' },
  { type: 'card', get label() { return tr("角色卡"); }, path: '/card-viewer' },
  { type: 'preset', get label() { return tr("预设"); }, path: '/preset' },
  { type: 'regex', get label() { return tr("正则"); }, path: '/regex' },
];

/** 左侧介绍栏的分工具卖点（0816 反馈：选择页左介绍右选择） */
const FOCUS_COPY: Record<string, { title: string; description: string; points: string[]; importLabel: string }> = {
  summary: {
    get title() { return tr("总结"); },
    get description() { return EDITOR_TOOL_COPY.summary; },
    get points() { return [tr("分卷总结：按楼层范围提炼剧情"), tr("角色日记：以角色视角回顾经历"), tr("DIY 创作：用自定义提示词自由生成")]; },
    get importLabel() { return tr("导入新聊天"); },
  },
  'story-tree': {
    get title() { return tr("故事树"); },
    get description() { return EDITOR_TOOL_COPY.storyTree; },
    get points() { return [tr("把人物、事件和伏笔整理成脉络"), tr("支持 JSON / Markdown 导入导出"), tr("与聊天处理、总结共用当前故事")]; },
    get importLabel() { return tr("导入新聊天"); },
  },
  worldbook: {
    get title() { return tr("世界书"); },
    get description() { return EDITOR_TOOL_COPY.worldbook; },
    get points() { return [tr("可从零新建空白世界书编写设定"), tr("编辑条目内容与触发关键词"), tr("支持 ST 世界书 JSON 导入导出")]; },
    get importLabel() { return tr("导入世界书"); },
  },
};

/** 世界书资产选择卡的展示模型。 */
interface AssetPickerItem {
  id: string;
  title: string;
  entryCount: number;
  importedAt: number;
  updatedAt: number;
  sourceModifiedAt?: number;
  autoSaved?: boolean;
}

function formatStoryDate(value?: number): string {
  if (!value || !Number.isFinite(value)) return tr("时间未知");
  return new Date(value).toLocaleDateString(getLocale(), { year: 'numeric', month: '2-digit', day: '2-digit' });
}

const ToolsContent = () => {
  useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focus = searchParams.get('focus');
  const focusView = storyWorkspaceViewForEditorFocus(focus);
  const assetFocus = focus === 'worldbook' ? focus : null;
  const focusCopy = focus ? FOCUS_COPY[focus] ?? null : null;
  const [dragOver, setDragOver] = useState(false);
  const [pending, setPending] = useState<{ file: File; guess: ToolFileType | null } | null>(null);
  const [chosenType, setChosenType] = useState<ToolFileType>('chat');
  const [stories, setStories] = useState<StoryIndexEntry[]>([]);
  const [characters, setCharacters] = useState<CharacterIndexEntry[]>([]);
  const [assetItems, setAssetItems] = useState<AssetPickerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (assetFocus === 'worldbook') {
        const items = await listAssetIndex('worldbooks');
        setAssetItems(items.map((item) => ({
          id: item.id,
          title: item.title,
          entryCount: item.entryCount,
          importedAt: item.createdAt,
          updatedAt: item.updatedAt,
          sourceModifiedAt: item.sourceModifiedAt,
          autoSaved: item.autoSaved,
        })));
        return;
      }
      const [stories, cards] = await Promise.all([
        listStoryIndex(),
        listCharacterIndex().catch(() => []),
      ]);
      const sortedStories = [...stories]
        .sort((a, b) => (b.lastViewedAt ?? b.updatedAt) - (a.lastViewedAt ?? a.updatedAt));
      setStories(sortedStories);
      setCharacters(cards);
    } catch (error: unknown) {
      setAssetItems([]);
      setStories([]);
      setCharacters([]);
      setLoadError(error instanceof Error ? error.message : tr("无法读取归档数据"));
    } finally {
      setLoading(false);
    }
  }, [assetFocus]);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleFile = useCallback(async (file: File) => {
    let content: string | undefined;
    if (file.name.toLowerCase().endsWith('.json')) {
      try {
        content = await file.text();
      } catch { /* 读失败按无内容处理 */ }
    }
    const guess = guessFileType(file.name, content);
    setPending({ file, guess });
    setChosenType(guess ?? 'chat');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }, [handleFile]);

  const handleConfirm = () => {
    if (!pending) return;
    const target = TOOLS.find((t) => t.type === chosenType);
    if (!target) return;
    setPendingToolFile(chosenType, pending.file);
    setPending(null);
    navigate(target.path);
  };

  const openStory = useCallback((storyId: string) => {
    if (!focusView) return;
    setEditorStoryId(storyId);
    navigate(buildEditorStoryPath(storyId, focusView));
  }, [focusView, navigate]);

  const openAsset = useCallback((assetId: string) => {
    if (!assetFocus) return;
    navigate(`/worldbook?assetId=${encodeURIComponent(assetId)}`);
  }, [assetFocus, navigate]);

  const storyPickerItems = buildEditorStoryPickerItems(stories, characters, query);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredAssetItems = normalizedQuery
    ? assetItems.filter((item) => item.title.toLocaleLowerCase().includes(normalizedQuery))
    : assetItems;
  const currentStoryId = getEditorStoryId();
  const lastStory = !assetFocus && currentStoryId ? stories.find((story) => story.id === currentStoryId) : undefined;
  const listTotal = assetFocus ? assetItems.length : stories.length;

  if (!focusView && !assetFocus) return <Navigate to="/chat" replace />;

  return (
    <AppLayout>
      <div
        className="relative h-full min-h-0 overflow-hidden px-5 py-4"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false); }}
        onDrop={handleDrop}
      >
        <input
          id="tools-file-input"
          type="file"
          accept=".jsonl,.json,.txt,.png"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ''; }}
        />

        {focusCopy && (
          <div className="mx-auto flex h-full min-h-0 max-w-6xl flex-nowrap overflow-hidden items-stretch gap-4 animate-fade-in">
            <aside className="flex min-h-0 basis-[16.5rem] grow-0 shrink-0 flex-col gap-3 rounded-lg border border-[color:var(--border-normal)] bg-elevated p-4">
              <div className="shrink-0">
                <h1 className="font-serif text-[22px] font-semibold tracking-wide text-[color:var(--text-primary)]">
                  {focusCopy.title}
                </h1>
                <p className="mt-1 text-xs leading-relaxed text-[color:var(--text-muted)]">
                  {focusCopy.description}
                </p>
              </div>
              <ul className="space-y-1.5 text-xs text-[color:var(--text-body)]">
                {focusCopy.points.map((point) => (
                  <li key={point} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-accent" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto shrink-0 rounded-md bg-chrome p-3">
                <p className="text-xs font-medium text-[color:var(--text-primary)]">{tr("支持导入")}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-[color:var(--text-muted)]">{tr("聊天记录 (.jsonl/.json/.txt) · 角色卡 (.png/.json) · 世界书 / 预设 / 正则 (.json)")}</p>
                <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">{tr("把文件拖进本页任意位置即可开始。")}</p>
              </div>
            </aside>

            <section
              className="flex min-h-0 min-w-[24rem] flex-1 flex-col overflow-hidden rounded-lg border border-[color:var(--border-normal)] bg-elevated p-4"
              data-editor-story-picker
              data-editor-focus={focus}
            >
              <div className="flex shrink-0 items-start justify-between gap-3">
                <div>
                  <h2 className="font-serif text-base font-semibold text-[color:var(--text-primary)]">
                    {assetFocus ? tr("选择要编辑的{{v0}}", { v0: focusCopy.title }) : tr("选择要处理的故事")}
                  </h2>
                  <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                    {assetFocus ? tr("按最近更新排序，点击直接进入编辑器。") : tr("默认显示最近 10 个故事，更早内容可通过搜索找到。")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {assetFocus === 'worldbook' && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        sessionStorage.setItem('ste-create-blank-worldbook', '1');
                        navigate('/worldbook');
                      }}
                    >
                      <Plus className="mr-1.5 h-4 w-4" />{tr("新建空白世界书")}</Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-tour="tools-dropzone"
                    onClick={() => document.getElementById('tools-file-input')?.click()}
                  >
                    <DownloadCloud className="mr-1.5 h-4 w-4" />
                    {focusCopy.importLabel}
                  </Button>
                </div>
              </div>
              {lastStory && !normalizedQuery && (
                <button
                  type="button"
                  onClick={() => openStory(lastStory.id)}
                  className="mt-3 flex w-full shrink-0 items-center gap-2 rounded-md border border-[color:var(--brand-hairline)] bg-chrome px-3 py-2 text-left transition-colors hover:bg-elevated-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="shrink-0 rounded bg-[var(--brand-active-bg)] px-1.5 py-0.5 text-[11px] text-brand">{tr("继续上次")}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-[color:var(--text-body)]" title={lastStory.title}>{lastStory.title}</span>
                  <span className="shrink-0 text-[11px] text-[color:var(--text-muted)]">{tr("{{v0}} 楼", { v0: lastStory.floorCount })}</span>
                </button>
              )}
              {listTotal > 0 && (
                <div className="mt-3 flex shrink-0 items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--text-muted)]" />
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={assetFocus ? tr("搜索{{v0}}标题", { v0: focusCopy.title }) : tr("搜索故事或角色")}
                      aria-label={assetFocus ? tr("搜索{{v0}}标题", { v0: focusCopy.title }) : tr("搜索故事或角色")}
                      className="w-full rounded-md border border-[color:var(--border-normal)] bg-chrome py-2 pl-9 pr-3 text-xs text-[color:var(--text-body)] outline-none placeholder:text-[color:var(--text-muted)] focus:border-brand focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <span className="shrink-0 text-[11px] text-[color:var(--text-muted)]">
                    {assetFocus
                      ? (normalizedQuery ? tr("{{v0}}/{{v1}} 份世界书", { v0: filteredAssetItems.length, v1: assetItems.length }) : tr("共 {{v0}} 份世界书", { v0: assetItems.length }))
                      : (normalizedQuery ? tr("{{v0}}/{{v1}} 个故事", { v0: storyPickerItems.length, v1: stories.length }) : tr("最近 {{v0}} 个故事", { v0: storyPickerItems.length }))}
                  </span>
                </div>
              )}

              {loadError ? (
                <div
                  className="mt-3 flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg bg-chrome px-4 py-5 text-center"
                  data-tools-load-error
                >
                  <p className="text-sm text-destructive">{tr("读取失败：{{v0}}", { v0: loadError })}</p>
                  <p className="mt-1 text-xs text-[color:var(--text-muted)]">{tr("没有把读取失败当成空库，你可以重试。")}</p>
                  <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void loadData()}>{tr("重试")}</Button>
                </div>
              ) : assetFocus ? (
                filteredAssetItems.length > 0 ? (
                  <div
                    data-asset-scroll-region
                    className="mt-3 min-h-0 flex-1 overflow-y-scroll overscroll-contain pr-1 scrollbar-thin"
                  >
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(17rem,1fr))] gap-2">
                    {filteredAssetItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openAsset(item.id)}
                        aria-label={item.title}
                        className="flex min-w-0 flex-col items-start rounded-md border border-transparent bg-chrome px-3 py-2.5 text-left transition-colors hover:border-[color:var(--brand-hairline)] hover:bg-elevated-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="flex w-full items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-[color:var(--text-body)]" title={item.title}>{item.title}</span>
                          {item.autoSaved && (
                            <span className="shrink-0 rounded bg-chrome px-1.5 py-0.5 text-[11px] text-[color:var(--text-muted)] ring-1 ring-[color:var(--border-normal)]">{tr("历史")}</span>
                          )}
                        </span>
                        <span className="mt-1 flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[color:var(--text-muted)]">
                          <span>{tr("{{v0}} 个条目", { v0: item.entryCount })}</span>
                          <span className="flex min-w-0 items-center gap-1 truncate" title={item.title}>
                            <CalendarRange className="h-3 w-3 shrink-0" />
                            <span className="truncate" title={item.title}>
                              {item.sourceModifiedAt !== undefined ? tr("源文件 {{v0}}", { v0: formatStoryDate(item.sourceModifiedAt) }) : tr("STE 更新 {{v0}}", { v0: formatStoryDate(item.updatedAt) })}
                            </span>
                          </span>
                          {item.sourceModifiedAt !== undefined && <span>{tr("导入 {{v0}}", { v0: formatStoryDate(item.importedAt) })}</span>}
                        </span>
                      </button>
                    ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg bg-chrome px-4 py-5 text-center">
                    <p className="text-sm text-[color:var(--text-body)]">{assetItems.length > 0 ? tr("没有匹配的结果") : tr("还没有保存的{{v0}}", { v0: focusCopy.title })}</p>
                    <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                      {assetItems.length > 0 ? tr("换一个标题关键词试试。") : tr("点上方「新建空白世界书」或「{{v0}}」，也可把 JSON 文件直接拖进本页。", { v0: focusCopy.importLabel })}
                    </p>
                  </div>
                )
              ) : storyPickerItems.length > 0 ? (
                <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-thin">
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(17rem,1fr))] gap-2">
                  {storyPickerItems.map(({ story, characterName, floorCount, startedAt, endedAt }) => (
                    <button
                      key={story.id}
                      type="button"
                      onClick={() => openStory(story.id)}
                      aria-label={`${story.title} · ${characterName}`}
                      className="flex min-w-0 flex-col items-start rounded-md border border-transparent bg-chrome px-3 py-2.5 text-left transition-colors hover:border-[color:var(--brand-hairline)] hover:bg-elevated-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="w-full truncate text-sm font-medium text-[color:var(--text-body)]" title={story.title}>{story.title}</span>
                      <span className="mt-1 w-full truncate text-xs text-[color:var(--text-muted)]" title={characterName}>{tr("所属角色：{{v0}}", { v0: characterName })}</span>
                      <span className="mt-1 flex w-full items-center gap-3 text-[11px] text-[color:var(--text-muted)]">
                        <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />{tr("{{v0}} 楼", { v0: floorCount })}</span>
                        <span className="flex min-w-0 items-center gap-1 truncate" title={`${formatStoryDate(startedAt)} - ${formatStoryDate(endedAt)}`}>
                          <CalendarRange className="h-3 w-3 shrink-0" />
                          <span className="truncate" title={`${formatStoryDate(startedAt)} - ${formatStoryDate(endedAt)}`}>{formatStoryDate(startedAt)} - {formatStoryDate(endedAt)}</span>
                        </span>
                      </span>
                    </button>
                  ))}
                  </div>
                </div>
              ) : loading ? (
                <div
                  data-story-picker-loading
                  className="mt-3 flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg bg-chrome px-4 py-5 text-center"
                >
                  <p className="text-sm text-[color:var(--text-muted)]">{tr(LOADING_LABEL)}</p>
                </div>
              ) : (
                <div className="mt-3 flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg bg-chrome px-4 py-5 text-center">
                  <p className="text-sm text-[color:var(--text-body)]">{stories.length > 0 ? tr("没有匹配的故事") : tr("还没有可以处理的故事")}</p>
                  <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                    {stories.length > 0 ? tr("换一个标题或角色关键词试试。") : tr("点右上角「导入新聊天」，或把文件直接拖进本页。")}
                  </p>
                </div>
              )}
            </section>
          </div>
        )}

        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center border-2 border-dashed border-brand bg-[var(--brand-active-bg)]">
            <div className="rounded-lg bg-elevated px-6 py-4 text-center shadow-lg">
              <DownloadCloud className="mx-auto h-7 w-7 text-brand" />
              <p className="mt-2 text-sm font-medium text-[color:var(--text-primary)]">{tr("松开导入文件")}</p>
              <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">{tr("聊天记录 · 角色卡 · 世界书 / 预设 / 正则")}</p>
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!pending} onOpenChange={(v) => { if (!v) setPending(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("这是什么文件？")}</DialogTitle>
            <DialogDescription>
              {pending?.file.name}
              {pending?.guess
                ? tr(" — 看起来像{{v0}}，确认后进入对应工具", { v0: TOOL_TYPE_LABELS[pending.guess] })
                : tr(" — 没认出来，请选择用哪个工具处理")}
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={chosenType} onValueChange={(v) => setChosenType(v as ToolFileType)} className="space-y-2">
            {TOOLS.map((tool) => (
              <div
                key={tool.type}
                className="flex items-center gap-3 p-2.5 rounded-lg border border-border hover:bg-accent/50 cursor-pointer"
                onClick={() => setChosenType(tool.type)}
              >
                <RadioGroupItem value={tool.type} id={`type-${tool.type}`} />
                <Label htmlFor={`type-${tool.type}`} className="cursor-pointer flex-1">
                  {TOOL_TYPE_LABELS[tool.type]}
                  {pending?.guess === tool.type && (
                    <span className="ml-2 text-xs text-primary">{tr("（猜测）")}</span>
                  )}
                </Label>
              </div>
            ))}
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>{tr("取消")}</Button>
            <Button onClick={handleConfirm}>{tr("确认并处理")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default function Tools() {
  const [params] = useSearchParams();
  if (params.get('focus') === 'preset') return <Navigate to={presetLibraryRedirect(params.toString(), true)} replace />;
  return <ToolsContent />;
}
