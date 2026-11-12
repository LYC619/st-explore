import { ARCHIVE_SCHEMA_VERSION } from '@/lib/archive-schema';
import type { VaultFs } from './fs';

export const NEWER_VAULT_MESSAGE = '这个库被更新版本的 STE 使用过，请用新版本打开';
export class NewerVaultFormatError extends Error {
  constructor() { super(NEWER_VAULT_MESSAGE); this.name = 'NewerVaultFormatError'; }
}

/** Read directly before activation: creating/scanning a backend can recover journals or write caches. */
export async function assertCompatibleVault(fs: VaultFs): Promise<void> {
  if (!(await fs.stat('库信息.json')).exists) return;
  const text = await fs.readText('库信息.json');
  let metadata: unknown;
  try { metadata = JSON.parse(text); }
  catch { return; } // Preserve the existing malformed/legacy metadata handling in the backend.
  const version = metadata && typeof metadata === 'object' && 'schemaVersion' in metadata
    ? metadata.schemaVersion : undefined;
  if (typeof version === 'number' && version > ARCHIVE_SCHEMA_VERSION) throw new NewerVaultFormatError();
}
