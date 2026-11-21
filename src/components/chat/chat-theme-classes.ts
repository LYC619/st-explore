import type { ThemeStyle } from '@/types/chat';

export interface ProcessedMessage {
  depth: number;
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  name?: string;
  timestamp?: number;
  hidden?: boolean;
  rawData?: unknown;
  paragraphs: string[];
  isNewSpeaker: boolean;
  ooc: boolean;
  swipeTotal: number;
  swipeId: number;
  swipeIsSteEdit: boolean;
}

export type ThemeClasses = ReturnType<typeof getThemeClasses>;

export function getThemeClasses(theme: ThemeStyle) {
  switch (theme) {
    case 'novel':
      return {
        container: 'paper-bg p-4 md:p-8 font-serif',
        title: 'text-center mb-8 pb-4 border-b-2 border-primary/30',
        message: 'mb-5',
        userBubble: '',
        charBubble: '',
        content: 'reading-flow',
        name: 'font-display text-primary/70 text-sm mb-1',
        separator: 'hidden',
      };
    case 'social':
      return {
        container: 'bg-background p-6',
        title: 'text-left mb-6 pb-3 border-b border-border',
        message: 'mb-4 flex gap-3 w-full',
        userBubble: 'flex-row-reverse',
        charBubble: 'flex-row',
        content: 'rounded-2xl px-4 py-2.5 max-w-[80%]',
        name: 'text-xs text-muted-foreground mb-1',
        separator: 'hidden',
      };
    case 'minimal':
      return {
        container: 'bg-background p-4 md:p-8',
        title: 'mb-8 pb-2 border-b border-border',
        message: 'mb-4 py-2',
        userBubble: 'border-l-2 border-primary pl-4',
        charBubble: 'border-l-2 border-muted-foreground/30 pl-4',
        content: '',
        name: 'font-medium text-sm mb-1',
        separator: 'hidden',
      };
    case 'elegant':
    default:
      return {
        container: 'paper-bg p-4 md:p-10 decorative-border',
        title: 'text-center mb-10 space-y-2',
        message: 'mb-5',
        userBubble: '',
        charBubble: '',
        content: 'reading-flow',
        name: 'font-display text-base text-primary/70 mb-1',
        separator: 'hidden',
      };
  }
}
