import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { EntryEditor } from '@/components/worldbook/EntryEditor';
import type { WorldBookEntry } from '@/types/worldbook';

interface EntryEditorPaneProps {
  entry: WorldBookEntry | null;
  entryKey: string | null;
  onChange: (key: string, updated: WorldBookEntry) => void;
  onDelete: (key: string) => void;
  usedUids?: number[];
  isMobile: boolean;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

/** 条目编辑器：桌面固定右栏，移动端底部抽屉，两处共用同一份编辑体 */
export function EntryEditorPane({
  entry, entryKey, onChange, onDelete, isMobile, mobileOpen, onMobileOpenChange, usedUids,
}: EntryEditorPaneProps) {
  useI18n();
  const body = entry && entryKey ? (
    <>
      <EntryEditor key={entryKey} entry={entry} usedUids={usedUids} onChange={(updated) => onChange(entryKey, updated)} />
      <div className="px-4 pb-4">
        <Button variant="destructive" size="sm" onClick={() => onDelete(entryKey)}>
          <Trash2 className="w-4 h-4 mr-1" />{tr(" 删除此条目")}</Button>
      </div>
    </>
  ) : null;

  return (
    <>
      <div className="h-full min-h-0 w-[400px] shrink-0 hidden md:block border-l bg-card/50">
        {body ? (
          <ScrollArea className="h-full">{body}</ScrollArea>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">{tr("点击左侧条目进行编辑")}</div>
        )}
      </div>

      {isMobile && (
        <Sheet open={mobileOpen && !!entry} onOpenChange={onMobileOpenChange}>
          <SheetContent side="bottom" className="h-[85vh] p-0">
            <SheetHeader className="px-4 pt-4 pb-2">
              <SheetTitle className="text-base">{tr("编辑：{{v0}}", { v0: entry?.comment || tr("(无标题)") })}
              </SheetTitle>
            </SheetHeader>
            <ScrollArea className="h-[calc(85vh-3.5rem)]">{body}</ScrollArea>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
