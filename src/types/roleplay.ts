/** Profile IDs refer to api-profiles.ts; credentials never belong to the library. */
export interface RoleplayPreferences {
  mainProfileId?: string;
  toolProfileId?: string;
  tavern?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  installedBaiBai?: import('@/lib/roleplay/baibai-package').InstalledBaiBai | null;
}
