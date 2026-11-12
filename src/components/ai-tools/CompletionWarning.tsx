import { COMPLETION_WARNING } from '@/lib/llm';

/** A warning belongs to the editor UI, never to the generated or saved text. */
export function CompletionWarning({ truncated }: { truncated: boolean }) {
  return truncated ? <p role="status" className="text-xs text-[color:var(--status-warn)]">{COMPLETION_WARNING}</p> : null;
}
