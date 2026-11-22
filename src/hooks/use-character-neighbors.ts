import { useEffect, useState } from 'react';
import { listCharacterIndex, listStoryIndex } from '@/lib/archive-index';
import { isPlainSingleKeyShortcut } from '@/lib/keyboard-shortcuts';
import { displayCharacterName, filterCharacters, sortCharacters } from '@/lib/library-query';
import { readLibraryReturnState } from '@/lib/library-return-state';

export interface CharacterNeighbor {
  id: string;
  name: string;
}

export interface CharacterNeighbors {
  prev?: CharacterNeighbor;
  next?: CharacterNeighbor;
  positionLabel?: string;
}

export function useCharacterNeighbors(
  currentId: string | undefined,
  options: {
    disabled: boolean;
    onNavigateNeighbor: (targetId: string) => void;
  },
): CharacterNeighbors {
  const [neighbors, setNeighbors] = useState<CharacterNeighbors>({});
  const { disabled, onNavigateNeighbor } = options;

  useEffect(() => {
    if (!currentId) {
      setNeighbors({});
      return;
    }
    let cancelled = false;
    Promise.all([listCharacterIndex(), listStoryIndex().catch(() => [])])
      .then(([allChars, stories]) => {
        if (cancelled) return;
        const lastPlayed: Record<string, number> = {};
        for (const s of stories) {
          if (!s.characterId) continue;
          const t = Math.max(s.lastViewedAt ?? 0, s.updatedAt);
          if (t > (lastPlayed[s.characterId] ?? 0)) lastPlayed[s.characterId] = t;
        }
        const returnState = readLibraryReturnState();
        const sortKey = returnState?.sortKey ?? 'lastPlayed';
        const sortAsc = returnState?.sortAsc ?? false;

        let ordered = allChars;
        if (returnState) {
          const filtered = filterCharacters(allChars, {
            search: returnState.searchQuery,
            type: returnState.typeFilter,
            tags: returnState.tagFilters,
          });
          if (filtered.some((c) => c.id === currentId)) {
            ordered = filtered;
          }
        }
        const sorted = sortCharacters(ordered, sortKey, sortAsc, lastPlayed);
        const idx = sorted.findIndex((c) => c.id === currentId);
        if (idx < 0 || sorted.length <= 1) {
          setNeighbors({});
          return;
        }
        const prevItem = sorted[idx - 1];
        const nextItem = sorted[idx + 1];
        setNeighbors({
          prev: prevItem ? { id: prevItem.id, name: displayCharacterName(prevItem) } : undefined,
          next: nextItem ? { id: nextItem.id, name: displayCharacterName(nextItem) } : undefined,
          positionLabel: `${idx + 1} / ${sorted.length}`,
        });
      })
      .catch(() => {
        if (!cancelled) setNeighbors({});
      });
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  useEffect(() => {
    if (disabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isPlainSingleKeyShortcut(e)) return;
      if (e.key === '[' && neighbors.prev) {
        e.preventDefault();
        onNavigateNeighbor(neighbors.prev.id);
      } else if (e.key === ']' && neighbors.next) {
        e.preventDefault();
        onNavigateNeighbor(neighbors.next.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disabled, neighbors.next, neighbors.prev, onNavigateNeighbor]);

  return neighbors;
}
