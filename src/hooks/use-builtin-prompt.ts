import { useEffect, useState } from 'react';
import { BUILTIN_PROMPT_CHANGE, getBuiltinPrompt } from '@/lib/builtin-prompts';

/** Re-read on mount and local/cross-window preference changes; never caches at module load. */
export function useBuiltinPrompt(id: string): string {
  const [value, setValue] = useState(() => getBuiltinPrompt(id));
  useEffect(() => {
    const refresh = () => setValue(getBuiltinPrompt(id));
    refresh();
    window.addEventListener(BUILTIN_PROMPT_CHANGE, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(BUILTIN_PROMPT_CHANGE, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [id]);
  return value;
}
