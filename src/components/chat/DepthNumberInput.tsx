import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';

/** Keep incomplete input local; only complete integers change the rule. */
export function DepthNumberInput({ value, min, nullable = false, label, disabled, onChange }: {
  value: number | null; min: number; nullable?: boolean; label: string; disabled?: boolean;
  onChange: (value: number | null) => void;
}) {
  useI18n();
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  const composing = useRef(false);
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);
  const commit = (text: string) => {
    if (composing.current) return;
    if (text === '' && nullable) { onChange(null); return; }
    if (!/^-?\d+$/.test(text)) return;
    const number = Number(text);
    if (Number.isSafeInteger(number) && number >= min) onChange(number);
  };
  const finish = () => {
    commit(draft);
    const number = Number(draft);
    if ((!draft && !nullable) || (draft && (!/^-?\d+$/.test(draft) || !Number.isSafeInteger(number) || number < min))) {
      setDraft(value === null ? '' : String(value));
    }
  };
  return <Input aria-label={label} inputMode="numeric" placeholder={nullable ? tr("不限") : undefined} value={draft} disabled={disabled}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={event => { composing.current = false; commit(event.currentTarget.value); }}
    onChange={event => { setDraft(event.target.value); commit(event.target.value); }} onBlur={finish}
    onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) finish(); }} />;
}
