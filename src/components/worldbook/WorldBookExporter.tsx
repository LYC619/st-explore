import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { WorldBook } from '@/types/worldbook';
import { exportWorldBook } from '@/types/worldbook';
import { saveTextFile } from '@/lib/roleplay/export-package-file';
import { useToast } from '@/hooks/use-toast';

interface Props {
  worldbook: WorldBook;
  filename?: string;
  onBeforeExport?: () => Promise<WorldBook | void>;
  draft?: boolean;
}

export function WorldBookExporter({ worldbook, filename = 'worldbook', onBeforeExport, draft = false }: Props) {
  const { toast } = useToast();
  const handleExport = async () => {
    try {
    const current = draft ? worldbook : await onBeforeExport?.();
    const json = exportWorldBook(current ?? worldbook);
    const name = filename.replace(/[\\/:*?"<>|]/g, '_') + (draft ? '-未保存草稿' : '');
    const result = await saveTextFile({ text: json, fileName: `${name}.json`, label: '世界书', extension: 'json' });
    if (result !== 'cancelled') toast({ title: draft ? '已导出未保存草稿' : result === 'downloaded' ? '已发起世界书下载' : '已导出世界书',
      description: `${name}.json${draft ? '；库内内容未更改，草稿仍未保存到库内。' : ''}` });
    } catch (error) { toast({ title: '导出失败', description: String(error), variant: 'destructive' }); }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleExport}>
      <Upload className="w-4 h-4 mr-2" />
      {draft ? '导出未保存草稿' : '导出世界书'}
    </Button>
  );
}
