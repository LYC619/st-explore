/** Profile IDs refer to api-profiles.ts; credentials never belong to the library. */
export interface RoleplayPreferences {
  mainProfileId?: string;
  toolProfileId?: string;
  tavern?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  userAvatars?: Record<string, string>;
  deletedDefaultAvatars?: string[];
  installedBaiBai?: import('@/lib/roleplay/baibai-package').InstalledBaiBai | null;
  installedTavernHelper?: import('@/lib/roleplay/tavern-helper-package').InstalledTavernHelper | null;
}
