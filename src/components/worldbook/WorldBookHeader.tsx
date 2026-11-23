import { useEffect, useRef, useState } from 'react';
import { Clock, Globe, Plus, Save, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WorldBookImporter } from '@/components/worldbook/WorldBookImporter';
import { WorldBookExporter } from '@/components/worldbook/WorldBookExporter';
import { StagedWorldBookList } from '@/components/worldbook/StagedWorldBookList';
import type { WorldBook, WorldBookItem } from '@/types/worldbook';

export type WorldBookTab = 'edit' | 'quick';

interface WorldBookHeaderProps {
  worldbook: WorldBook | null;
  filename: string;
  onRename?: (nextName: string) => void;
  onCreateBlank?: () => void;
  cowCharacterName: string;
  /** 条目计数摘要（含 token 粗估），没有世界书时为 null */
  summary: { text: string; title: string } | null;
  activeTab: WorldBookTab;
  onTabChange: (tab: WorldBookTab) => void;
  onImport: (wb: WorldBook, name: string, sourceModifiedAt?: number) => void;
  onAppend: (wb: WorldBook) => void;
  onOpenAiDialog: () => void;
  savedItems: WorldBookItem[];
  stagedDialogOpen: boolean;
  onStagedDialogOpenChange: (open: boolean) => void;
  onRefreshStaged: () => void;
  onLoadStaged: (item: WorldBookItem) => void;
  onDeleteStaged: (item: WorldBookItem) => void;
  onSave: () => void;
  saveStatus?: 'saved' | 'pending' | 'saving' | 'error';
  saveError?: string;
  onBeforeExport?: () => Promise<WorldBook | void>;
  sourceTitle?: string;
  onRestoreSource?: () => void;
  /** 页面自己挂的模态框（确认切换 / 确认删除）插在工具栏里，保持原有 DOM 位置 */
  children?: React.ReactNode;
}

const TabSwitcher = ({ value, onChange, mobile }: { value: WorldBookTab; onChange: (t: WorldBookTab) => void; mobile?: boolean }) => (
  <Tabs value={value} onValueChange={(v) => onChange(v as WorldBookTab)} className={mobile ? undefined : 'hidden sm:block'}>
    <TabsList className={mobile ? 'w-full h-8' : 'h-8'}>
      <TabsTrigger value="edit" className={mobile ? 'text-xs flex-1 h-6' : 'text-xs px-3 h-6'}>编辑模式</TabsTrigger>
      <TabsTrigger value="quick" className={mobile ? 'text-xs flex-1 h-6' : 'text-xs px-3 h-6'}>快速添加</TabsTrigger>
    </TabsList>
  </Tabs>
);

/** 世界书页内工具栏：标题重命名 + 计数 + 模式切换 + 新建/导入/AI/最近打开/保存/导出 */
export function WorldBookHeader({
  worldbook, filename, onRename, onCreateBlank, cowCharacterName, summary,
  activeTab, onTabChange,
  onImport, onAppend, onOpenAiDialog,
  savedItems, stagedDialogOpen, onStagedDialogOpenChange, onRefreshStaged, onLoadStaged, onDeleteStaged,
  onSave, saveStatus, saveError, onBeforeExport, sourceTitle, onRestoreSource, children,
}: WorldBookHeaderProps) {
  const [nameDraft, setNameDraft] = useState(filename);
  const cancelBlur = useRef(false);
  useEffect(() => { setNameDraft(filename); }, [filename]);

  const commitName = () => {
    if (cancelBlur.current) { cancelBlur.current = false; return; }
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameDraft(filename);
      return;
    }
    if (trimmed !== filename) onRename?.(trimmed);
  };

  return (
    <header className="border-b bg-card/80 backdrop-blur sticky top-0 z-30">
      <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center gap-2">
        <Globe className="w-5 h-5 text-primary shrink-0" />
        {worldbook && onRename ? (
          <Input
            size="sm"
            aria-label="世界书名称"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelBlur.current = true;
                setNameDraft(filename);
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="w-40 sm:w-52 font-medium text-sm"
          />
        ) : (
          <h1 className="font-semibold text-foreground text-lg mr-2 hidden sm:block">世界书编辑器</h1>
        )}
        {cowCharacterName && (
          <Badge variant="secondary" className="shrink-0" title="从角色页进入的处理：保存共享世界书时会生成该角色的派生副本，原资产不动">
            为「{cowCharacterName}」处理
          </Badge>
        )}

        {/* 条目计数 + token 粗估 */}
        {summary && (
          <span className="text-xs text-muted-foreground truncate max-w-[260px] hidden lg:inline" title={summary.title}>
            {summary.text}
          </span>
        )}

        <TabSwitcher value={activeTab} onChange={onTabChange} />

        <div className="flex-1" />
        {sourceTitle && <Button type="button" variant="outline" size="sm" onClick={onRestoreSource}
          title={`来源：${sourceTitle}。将来源内容恢复到当前世界书并自动保存，来源书继续保留。`}>恢复来源内容</Button>}
        {worldbook && saveStatus && <span role="status" title={saveError} className="text-xs shrink-0">
          {saveStatus === 'saving' ? '保存中…' : saveStatus === 'error' ? '保存失败，请重试' : saveStatus === 'pending' ? '待保存' : '已保存'}
        </span>}

        {onCreateBlank && (
          <Button type="button" variant="outline" size="sm" onClick={onCreateBlank} title="从零创建一本空白世界书">
            <Plus className="w-4 h-4 mr-1" /> <span className="hidden sm:inline">新建空白</span>
          </Button>
        )}

        <div data-tour="wb-import">
          <WorldBookImporter onImport={onImport} onAppend={onAppend} hasExisting={!!worldbook} />
        </div>

        {worldbook && (
          <Button type="button" data-tour="wb-ai" variant="outline" size="sm" onClick={onOpenAiDialog} title="根据聊天记录用 AI 提炼新设定，追加为新条目">
            <Sparkles className="w-4 h-4 mr-1" /> <span className="hidden sm:inline">AI 追加</span>
          </Button>
        )}

        <Dialog open={stagedDialogOpen} onOpenChange={onStagedDialogOpenChange}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" size="sm" data-tour="wb-staged" onClick={onRefreshStaged} title="从资产库里换一本世界书来编辑">
              <Clock className="w-4 h-4 mr-1" /> <span className="hidden sm:inline">最近打开</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[70vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>最近打开的世界书</DialogTitle>
              <DialogDescription>都存在资产库里，按最近编辑排序。点一本切过去编辑。</DialogDescription>
            </DialogHeader>
            {savedItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">资产库里还没有世界书</p>
            ) : (
              <StagedWorldBookList items={savedItems} variant="dialog" onSelect={onLoadStaged} onDelete={onDeleteStaged} />
            )}
          </DialogContent>
        </Dialog>

        {children}

        {worldbook && activeTab === 'edit' && (
          <>
            <Button type="button" variant="outline" size="sm" onClick={onSave} className="hidden sm:inline-flex">
              <Save className="w-4 h-4 mr-1" /> 保存
            </Button>
            <WorldBookExporter worldbook={worldbook} filename={filename} onBeforeExport={onBeforeExport} draft={saveStatus === 'error'} />
          </>
        )}
      </div>

      {/* Mobile tab switcher */}
      <div className="sm:hidden px-4 pb-2">
        <TabSwitcher value={activeTab} onChange={onTabChange} mobile />
      </div>
    </header>
  );
}
