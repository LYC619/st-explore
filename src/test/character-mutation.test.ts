import { describe, expect, it } from 'vitest';
import type { ArchiveCharacter } from '@/types/archive';
import {
  isPreparedCharacterMutation,
  type PreparedCharacterMutation,
} from '@/lib/character-mutation';

const patch: PreparedCharacterMutation = {
  patch: { name: 'next' },
  async commitAfterPersist() { return { warnings: [] }; },
  async recoverAfterPersistFailure() { return { action: 'rolled-back', warnings: [] }; },
};

describe('prepared character mutation contract', () => {
  it('is distinguishable from a plain archive patch', () => {
    expect(isPreparedCharacterMutation(patch)).toBe(true);
    expect(isPreparedCharacterMutation({ name: 'next' } as Partial<ArchiveCharacter>)).toBe(false);
    expect(isPreparedCharacterMutation(undefined)).toBe(false);
  });
});
