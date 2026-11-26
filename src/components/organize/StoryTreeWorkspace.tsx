import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import type { RemoveOptions } from '@/lib/repo';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { useCallback, useEffect, useState } from 'react';
import { Download, Network, Plus, Trash2, Upload } from 'lucide-react';
import { HelpCard } from '@/components/HelpCard';
import { TreeWorkbench } from '@/components/organize/TreeWorkbench';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { getBranchLine } from '@/lib/archive-db';
import { downloadMarkdown, storyTreeToObsidian } from '@/lib/obsidian-export';
import { routeTextFileExportResult } from '@/lib/text-file-export';
import { deleteStoryTree, getAllStoryTrees, saveStoryTree } from '@/lib/story-tree-db';
import { parseStoryTreeJSON, storyTreeToJSON } from '@/lib/story-tree-io';
import type { ArchiveStory } from '@/types/archive';
import { generateStoryTreeId, type StoryTree } from '@/types/story-tree';
import { LOADING_LABEL } from '@/lib/ui-copy';

interface StoryTreeWorkspaceProps {
  story: ArchiveStory;
  currentBranchId: string | null;
  initialTarget?: { type: 'record' | 'tree'; id: string };
  onJumpToFloor?: (floor: number, branchId?: string | null) => void;
}

function downloadJSON(name: string, content: string): void {
  const safeName = name.replace(/[/\\:*?"<>|]/g, '_');
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName.endsWith('.json') ? safeName : `${safeName}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function StoryTreeWorkspace({ story, currentBranchId, initialTarget, onJumpToFloor }: StoryTreeWorkspaceProps) {
  useI18n();
  const { toast } = useToast();
  const [trees, setTrees] = useState<StoryTree[]>([]);
  const [currentTreeId, setCurrentTreeId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const currentLine = getBranchLine(story, currentBranchId) ?? getBranchLine(story, null)!;
  const currentTree = trees.find((tree) => tree.id === currentTreeId) ?? null;

  const reload = useCallback(async (preferredId?: string | null) => {
    setLoadError(null);
    try {
      const mine = (await getAllStoryTrees())
        .filter((tree) => tree.bookId === story.id)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      setTrees(mine);
      setCurrentTreeId((current) => {
        const target = preferredId ?? current;
        if (target && mine.some((tree) => tree.id === target)) return target;
        if (initialTarget?.type === 'tree' && mine.some((tree) => tree.id === initialTarget.id)) return initialTarget.id;
        return mine[0]?.id ?? null;
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : tr("读取故事树失败，请检查文件库连接后重试"));
    } finally {
      setLoaded(true);
    }
  }, [initialTarget, story.id]);

  useEffect(() => { void reload(); }, [reload]);

  const createTree = async () => {
    const now = Date.now();
    const item: StoryTree = {
      id: generateStoryTreeId(), bookId: story.id, bookTitle: story.title,
      branchId: currentBranchId ?? undefined, title: tr("{{v0}} 的故事树", { v0: story.title }), nodes: [],
      createdAt: now, updatedAt: now, autoSaved: false,
    };
    try {
      await saveStoryTree(item);
      await reload(item.id);
      toast({ title: tr("已新建故事树") });
    } catch (error) {
      toast({
        title: tr("新建故事树未成功"),
        description: error instanceof Error ? error.message : tr("请检查文件库目录是否可写后重试"),
        variant: 'destructive',
      });
    }
  };

  const importTree = async (file: File) => {
    try {
      const parsed = parseStoryTreeJSON(await file.text());
      if (parsed.ok !== true) {
        toast({ title: tr("导入失败"), description: parsed.error, variant: 'destructive' });
        return;
      }
      const now = Date.now();
      const item: StoryTree = {
        id: generateStoryTreeId(), bookId: story.id, bookTitle: story.title,
        branchId: currentBranchId ?? undefined, title: parsed.title, nodes: parsed.nodes,
        createdAt: now, updatedAt: now, autoSaved: false,
      };
      await saveStoryTree(item);
      await reload(item.id);
      toast({ title: tr("已导入故事树"), description: tr("{{v0}} 个节点", { v0: item.nodes.length }) });
    } catch (error) {
      toast({
        title: tr("导入故事树未成功"),
        description: error instanceof Error ? error.message : tr("请检查文件内容及库目录权限后重试"),
        variant: 'destructive',
      });
    }
  };

  const deleteTree = async (options: RemoveOptions) => {
    if (!currentTree) return;
    await deleteStoryTree(currentTree.id, options);
    setDeleteOpen(false);
    await reload(null);
    toast({ title: tr("已删除故事树") });
  };

  const exportJSON = () => {
    if (!currentTree) return;
    downloadJSON(currentTree.title || tr("故事树"), storyTreeToJSON(currentTree));
    toast({ title: tr("已导出 JSON") });
  };

  const exportMarkdown = async () => {
    if (!currentTree) return;
    const result = await downloadMarkdown(currentTree.title || tr("故事树"), storyTreeToObsidian(currentTree));
    routeTextFileExportResult(result, {
      onComplete: () => toast({ title: tr("已导出 Markdown"), description: tr("Obsidian 友好（含 frontmatter）") }),
      onFailure: () => toast({ title: tr("导出失败"), description: tr("没有写入任何文件，请重新选择位置后再试。"), variant: 'destructive' }),
    });
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain container mx-auto px-4 py-5">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg gold-gradient flex items-center justify-center shadow-card"><Network className="w-5 h-5 text-primary-foreground" /></div>
            <div>
              <div className="flex items-center gap-1"><h1 className="font-display text-xl font-semibold">{tr("故事树")}</h1><HelpCard>{tr("用可视化事实树整理人物、事件、关系与地点；点击节点即可在右侧展开详情编辑，支持跳回提及楼层。")}</HelpCard></div>
              <p className="text-xs text-muted-foreground">{tr("回顾故事的记忆锚点")}</p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground text-right pt-1"><span className="font-medium text-foreground">{story.title}</span> · {currentLine.session.messages.length}{tr(" 楼")}</div>
        </div>

        {currentTree ? (
          <TreeWorkbench
            key={currentTree.id}
            tree={currentTree}
            session={getBranchLine(story, currentTree.branchId ?? null)?.session ?? null}
            onChanged={() => { void reload(currentTree.id); }}
            onJumpToFloor={onJumpToFloor ? (floor) => onJumpToFloor(floor, currentTree.branchId ?? null) : undefined}
            renderHeader={({ title, onTitleChange }) => (
              <Card data-story-tree-selector>
                <CardContent className="p-3 flex items-center gap-2 flex-wrap">
                  <Select value={currentTree.id} onValueChange={setCurrentTreeId}>
                    <SelectTrigger className="h-8 w-52 shrink-0"><SelectValue placeholder={tr("选择故事树")} /></SelectTrigger>
                    <SelectContent>{trees.map((item) => <SelectItem key={item.id} value={item.id}>{tr("{{v0}}（{{v1}} 节点）", { v0: item.title, v1: item.nodes.length })}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input value={title} onChange={(event) => onTitleChange(event.target.value)} className="flex-1 min-w-[160px]" placeholder={tr("故事树名称")} />
                  <div className="flex items-center gap-1 ml-auto">
                    <Button variant="outline" size="sm" className="gap-1" onClick={createTree}><Plus className="w-4 h-4" />{tr("新建")}</Button>
                    <label><Button variant="ghost" size="sm" className="gap-1" asChild><span><Download className="w-4 h-4" />{tr("导入")}</span></Button><input type="file" accept=".json,application/json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importTree(file); event.target.value = ''; }} /></label>
                    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="gap-1"><Upload className="w-4 h-4" />{tr("导出")}</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={exportJSON}>{tr("JSON（可再次导入）")}</DropdownMenuItem><DropdownMenuItem onSelect={exportMarkdown}>{tr("Markdown（Obsidian 友好）")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
                    <Button variant="ghost" size="sm" className="gap-1 text-destructive" onClick={() => setDeleteOpen(true)}><Trash2 className="w-4 h-4" />{tr("删除")}</Button>
                  </div>
                </CardContent>
              </Card>
            )}
          />
        ) : loadError ? (
          <Card role="alert"><CardContent className="p-8 text-center space-y-3"><Network className="w-8 h-8 mx-auto text-muted-foreground" /><p className="font-medium text-foreground">{tr("故事树列表暂时没能读出来，库里的原文件未受影响")}</p><p className="text-sm text-muted-foreground break-words">{loadError}</p><Button variant="outline" onClick={() => void reload()}>{tr("重新读取")}</Button></CardContent></Card>
        ) : loaded ? (
          <Card data-story-tree-selector><CardContent className="p-8 text-center space-y-3"><Network className="w-8 h-8 mx-auto text-muted-foreground" /><p className="text-muted-foreground">{tr("用一棵事实树梳理这个故事的人物、事件与关系。")}</p><div className="flex gap-2 justify-center flex-wrap"><Button onClick={createTree} className="gap-1"><Plus className="w-4 h-4" />{tr("新建故事树")}</Button><label><Button variant="outline" className="gap-1" asChild><span><Download className="w-4 h-4" />{tr("导入")}</span></Button><input type="file" accept=".json,application/json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importTree(file); event.target.value = ''; }} /></label></div></CardContent></Card>
        ) : <div className="py-16 text-center text-sm text-muted-foreground">{tr(LOADING_LABEL)}</div>}
      </div>

      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title={tr("删除整棵故事树？")}
        description={tr("该故事树将从列表移除。")} fileTarget={currentTree ? { store: 'stories', id: currentTree.id } : undefined}
        onConfirm={deleteTree} />
    </div>
  );
}
