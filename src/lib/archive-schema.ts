/** Bump before any on-disk change an older STE cannot read and write safely. */
// v3 adds recoverable character-pair saves; older builds cannot recover an interrupted pair.
export const ARCHIVE_SCHEMA_VERSION = 3;
