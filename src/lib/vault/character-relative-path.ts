import type { AttachedFile } from '@/types/archive';

export function isSafeFileSegment(segment: string): boolean {
  return segment.length > 0
    && segment !== '.'
    && segment !== '..'
    && !/[\\/:<>"|?*]/.test(segment)
    && !Array.from(segment).some(char => char.charCodeAt(0) < 32)
    && !/[. ]$/.test(segment)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment);
}

export function isCharacterRelativeSafePath(
  relativePath: string,
  kind: 'portrait' | 'journal',
): boolean {
  const parts = relativePath.split('/');
  if (parts.length !== 3 || !parts.every(isSafeFileSegment)) return false;
  if (kind === 'portrait') return parts[0] === '立绘';
  return parts[0] === '.ste-control'
    && parts[1] === 'portrait-journal'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i.test(parts[2]);
}

/** Resolve an attachment to a path below the current character directory. */
export function resolveAttachmentRelativePath(record: AttachedFile): string | undefined {
  const parts = record.path.replaceAll('\\', '/').split('/');
  if (!parts.every(isSafeFileSegment)) return undefined;
  if (record.pathBase === 'character') {
    return parts.length === 2 && parts[0] === '附件' ? parts.join('/') : undefined;
  }
  if (record.pathBase !== undefined) return undefined;
  return parts.length === 4 && parts[0] === '角色' && parts[2] === '附件'
    ? `附件/${parts[3]}`
    : undefined;
}

export function attachmentFileName(record: AttachedFile): string | undefined {
  return resolveAttachmentRelativePath(record)?.split('/')[1];
}
