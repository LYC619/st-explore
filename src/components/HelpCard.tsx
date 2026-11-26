import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import type { ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface HelpCardProps {
  children: ReactNode;
}

export function HelpCard({ children }: HelpCardProps) {
  useI18n();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" title={tr("帮助说明")}>
          <HelpCircle className="w-4 h-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-w-[90vw] p-3 text-xs text-muted-foreground leading-relaxed"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
