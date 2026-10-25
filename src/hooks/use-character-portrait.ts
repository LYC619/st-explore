import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { loadCharacterPortrait } from '@/lib/character-portrait-cache';
import { getRecordVersion, subscribeRecordChanges } from '@/lib/repo/changes';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import type { ArchiveCharacter } from '@/types/archive';

export function useCharacterPortrait(character: Pick<ArchiveCharacter, 'id' | 'updatedAt' | 'pngBase64'>) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch, getVaultEpoch);
  const subscribe = useCallback((listener: () => void) => subscribeRecordChanges(change => {
    if (change.store === 'characters' && change.id === character.id) listener();
  }), [character.id]);
  const version = useSyncExternalStore(subscribe, () => getRecordVersion('characters', character.id));
  const key = `${epoch}:${JSON.stringify(character.id)}:${character.updatedAt}:${version}`;
  const [loaded, setLoaded] = useState<{ key: string; value: string | undefined }>();
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      setVisible(entries.some(entry => entry.isIntersecting));
    }, { rootMargin: '200px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (character.pngBase64 || !visible) { setLoaded(undefined); return; }
    let cancelled = false;
    void loadCharacterPortrait(character.id, character.updatedAt).then(value => {
      if (!cancelled) setLoaded({ key, value });
    }, () => { if (!cancelled) setLoaded(undefined); });
    return () => { cancelled = true; };
  }, [character.id, character.updatedAt, character.pngBase64, visible, key]);
  return { ref, pngBase64: character.pngBase64 ?? (visible && loaded?.key === key ? loaded.value : undefined) };
}
