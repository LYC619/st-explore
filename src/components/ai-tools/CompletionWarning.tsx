import { COMPLETION_WARNING } from '@/lib/llm';
import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';

/** A warning belongs to the editor UI, never to the generated or saved text. */
export function CompletionWarning({ truncated }: { truncated: boolean }) {
  useI18n();
  return truncated ? <p role="status" className="text-xs text-[color:var(--status-warn)]">{tr(COMPLETION_WARNING)}</p> : null;
}
