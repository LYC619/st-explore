export function branchKey(branchId: string | null): string {
  return branchId === null ? 'main' : `branch-${encodeURIComponent(branchId).replace(/\./g, '%2E')}`;
}

export function isRuntimePath(path: unknown, prefix = false): path is string {
  // eslint-disable-next-line no-control-regex -- Reject unsafe control bytes in portable filesystem paths.
  if (typeof path !== 'string' || !path || path.length > 2048 || /[\\:\x00-\x1f<>"|?*]/.test(path)) return false;
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
    || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) return false;
  const offset = parts[0] === 'memory' ? 1 : parts[0] === '.ste-control' && parts[1] === 'roleplay' ? 2 : -1;
  if (offset < 0) return false;
  if (prefix && parts.length === offset) return true;
  if (parts[offset] !== 'main' && !/^branch-[^/]+$/.test(parts[offset] ?? '')) return false;
  return parts.length >= offset + (prefix ? 1 : 2);
}

export const runtimeFileId = (storyId: string, path: string) => JSON.stringify([storyId, path]);
