export const FS_MUTATION_CODES = [
  'not-found',
  'not-file',
  'unsafe-path',
  'permission-denied',
  'io',
] as const;

export type FsMutationCode = (typeof FS_MUTATION_CODES)[number];

export interface FsMutationError {
  code: FsMutationCode;
  path: string;
  message: string;
}

export function isFsMutationError(value: unknown): value is FsMutationError {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.code === 'string'
    && FS_MUTATION_CODES.includes(record.code as FsMutationCode)
    && typeof record.path === 'string'
    && typeof record.message === 'string';
}

export function createFsMutationError(
  code: FsMutationCode,
  path: string,
  message: string,
): FsMutationError {
  return { code, path, message };
}

export function parseFsMutationError(error: unknown, path = ''): FsMutationError {
  if (isFsMutationError(error)) return error;
  if (typeof error === 'string') {
    try {
      const parsed: unknown = JSON.parse(error);
      if (isFsMutationError(parsed)) return parsed;
    } catch {
      // Older native commands returned human-readable strings.
    }
  }
  return createFsMutationError(
    'io',
    path,
    error instanceof Error ? error.message : String(error),
  );
}

export class FsMutationException extends Error implements FsMutationError {
  readonly code: FsMutationCode;
  readonly path: string;

  constructor(error: FsMutationError) {
    super(error.message);
    this.name = 'FsMutationException';
    this.code = error.code;
    this.path = error.path;
  }
}

export function throwFsMutationError(error: unknown, path = ''): never {
  throw new FsMutationException(parseFsMutationError(error, path));
}
