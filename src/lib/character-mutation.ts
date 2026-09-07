import type { ArchiveCharacter } from '@/types/archive';
import type { VaultBackend } from '@/lib/vault/vault-backend';

export interface MutationCleanupReport {
  warnings: string[];
}

export interface MutationRecoveryReport {
  action: 'finalized' | 'rolled-back' | 'blocked';
  warnings: string[];
  operationId?: string;
}

export interface PreparedCharacterMutation {
  patch: Partial<ArchiveCharacter>;
  commitAfterPersist(): Promise<MutationCleanupReport>;
  recoverAfterPersistFailure(
    readPersisted: () => Promise<ArchiveCharacter | undefined>,
  ): Promise<MutationRecoveryReport>;
}

export type CharacterUpdaterResult =
  | Partial<ArchiveCharacter>
  | PreparedCharacterMutation
  | undefined;

export interface CharacterMutationContext {
  vault: VaultBackend | null;
}

export type CharacterUpdater = (
  current: ArchiveCharacter,
  context: CharacterMutationContext,
) => CharacterUpdaterResult | Promise<CharacterUpdaterResult>;

export function isPreparedCharacterMutation(
  value: CharacterUpdaterResult,
): value is PreparedCharacterMutation {
  return typeof value === 'object'
    && value !== null
    && typeof (value as PreparedCharacterMutation).commitAfterPersist === 'function'
    && typeof (value as PreparedCharacterMutation).recoverAfterPersistFailure === 'function';
}

export function mutationWarnings(...reports: MutationCleanupReport[]): MutationCleanupReport {
  return { warnings: reports.flatMap((report) => report.warnings) };
}
