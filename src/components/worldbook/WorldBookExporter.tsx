import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
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
  useI18n();
  const { toast } = useToast();
  const handleExport = async () => {
    try {
    const current = draft ? worldbook : await onBeforeExport?.();
    const json = exportWorldBook(current ?? worldbook);
    const name = filename.replace(/[\\/:*?"<>|]/g, '_') + (draft ? tr("-未保存草稿") : '');
    const result = await saveTextFile({ text: json, fileName: `${name}.json`, label: tr("世界书"), extension: 'json' });
    if (result !== 'cancelled') toast({ title: draft ? tr("已导出未保存草稿") : result === 'downloaded' ? tr("已发起世界书下载") : tr("已导出世界书"),
      description: draft ? tr("{{v0}}.json；库内内容未更改，草稿仍未保存到库内。", { v0: name }) : `${name}.json` });
    } catch (error) { toast({ title: tr("导出失败"), description: String(error), variant: 'destructive' }); }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleExport}>
      <Upload className="w-4 h-4 mr-2" />
      {draft ? tr("导出未保存草稿") : tr("导出世界书")}
    </Button>
  );
}
