import { Languages } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { setLocale, tr, type Locale } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';

export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const locale = useI18n();
  return <div className={compact ? 'flex justify-end' : 'flex min-w-0 items-center justify-between gap-4'}>
    {!compact && <div className="flex items-start gap-3">
      <Languages className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div><h3 className="text-sm font-semibold">{tr('界面语言')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{tr('只改变界面语言，角色、故事和提示词保留原文。')}</p></div>
    </div>}
    <Select value={locale} onValueChange={value => setLocale(value as Locale)}>
      <SelectTrigger className="min-h-11 w-40 shrink-0" aria-label="Language / 语言"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="zh-CN">简体中文</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
    </Select>
  </div>;
}
