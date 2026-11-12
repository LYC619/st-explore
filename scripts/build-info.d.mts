export interface BuildInfo {
  schema: number;
  version: string;
  commit: string | null;
  dirty: boolean | null;
  builtAt: string;
  dirtyFiles: string[];
  inputPaths: string[];
}
export const BUILD_INPUT_PATHS: readonly string[];
export function isBuildInput(file: string): boolean;
export function collectBuildInfo(root?: string): BuildInfo;
export function resolveBuildInfo(root?: string): BuildInfo;
