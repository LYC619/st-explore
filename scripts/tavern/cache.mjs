import { lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isWithin, safeRelativePath } from './source.mjs';

function unsafeCache(message, target) {
  return new Error(`Unsafe Tavern cache ${message}: ${target}`);
}

async function inspect(context, target, directory = false, retries = 2) {
  const stat = await lstat(target);
  if (stat.isSymbolicLink()) throw unsafeCache('symlink/junction', target);
  if (directory ? !stat.isDirectory() : !stat.isDirectory() && !stat.isFile()) {
    throw unsafeCache(directory ? 'path is not a directory' : 'entry is not a regular file/directory', target);
  }
  if (stat.isFile() && stat.nlink > 1) throw unsafeCache('file is hard-linked', target);
  const actual = await realpath(target);
  // NTFS can report $Extend/$Deleted for a temporary file removed during realpath.
  // Re-stat the named entry: disappearance is handled by tree inspection, while
  // replacement must be inspected afresh rather than trusting the earlier inode.
  const current = await lstat(target);
  if (stat.dev !== current.dev || stat.ino !== current.ino || current.isSymbolicLink() || (current.isFile() && current.nlink > 1)) {
    if (retries === 0) throw unsafeCache('entry changed repeatedly during validation', target);
    return inspect(context, target, directory, retries - 1);
  }
  const expected = path.join(context.canonicalRoot, path.relative(context.projectRoot, target));
  if (!isWithin(context.canonicalRoot, actual) || path.relative(expected, actual) !== '') {
    throw unsafeCache('path resolves outside its expected directory', `${target} -> ${actual}`);
  }
  return stat;
}

async function inspectTree(context, root) {
  await inspect(context, root, true);
  for (const entry of await readdir(root)) {
    const target = path.join(root, entry);
    try {
      const stat = await inspect(context, target);
      if (stat.isDirectory()) await inspectTree(context, target);
    } catch (error) {
      // Rspack replaces temporary cache files; an entry that disappeared cannot be followed.
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

async function walkDirectory(context, relative, create) {
  await inspect(context, context.projectRoot, true);
  let current = context.projectRoot;
  for (const component of relative.split('/')) {
    const parent = current;
    current = path.join(parent, component);
    try {
      await inspect(context, current, true);
    } catch (error) {
      if (error?.code !== 'ENOENT' || !create) throw error;
      // No recursive mkdir: validate the existing parent before creating this one level.
      const parentRelative = path.relative(context.projectRoot, parent).split(path.sep).join('/');
      if (parentRelative) await walkDirectory(context, parentRelative, false);
      else await inspect(context, context.projectRoot, true);
      try {
        await mkdir(current);
      } catch (mkdirError) {
        if (mkdirError?.code !== 'EEXIST') throw mkdirError;
      }
      await inspect(context, current, true);
    }
  }
  return current;
}

/**
 * Prepare only directories below this project's .cache/tavern. Existing link
 * ancestors and entries are refused before cache reads or compiler writes.
 * Call again at each write boundary; this is not a lock against a hostile
 * same-user process changing paths between Node/native filesystem operations.
 */
async function prepareDirectories(projectRoot, relativePaths, inspectContents) {
  for (const relative of relativePaths) {
    if (relative !== '' && !safeRelativePath(relative)) throw unsafeCache('relative path', relative);
  }
  const absoluteRoot = path.resolve(projectRoot);
  const rootStat = await lstat(absoluteRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw unsafeCache('project root symlink or non-directory', absoluteRoot);
  const context = { projectRoot: absoluteRoot, canonicalRoot: await realpath(absoluteRoot) };
  const cacheRoot = await walkDirectory(context, '.cache/tavern', true);
  // Full preparation runs before the compiler exists. Its live native snapshot
  // directories are replaced concurrently, so active compiler hooks check only
  // the declared output/storage ancestry instead of walking those temporary files.
  if (inspectContents) await inspectTree(context, cacheRoot);
  const directories = [];
  for (const relative of relativePaths) {
    directories.push(await walkDirectory(context, relative ? `.cache/tavern/${relative}` : '.cache/tavern', true));
  }
  await walkDirectory(context, '.cache/tavern', false);
  for (const relative of relativePaths) {
    await walkDirectory(context, relative ? `.cache/tavern/${relative}` : '.cache/tavern', false);
  }
  return { cacheRoot, directories };
}

export async function prepareCacheDirectories(projectRoot, relativePaths = []) {
  return prepareDirectories(projectRoot, relativePaths, true);
}

export async function prepareCacheDirectory(projectRoot, relativePath = '') {
  const { directories } = await prepareCacheDirectories(projectRoot, [relativePath]);
  return directories[0];
}

/** Ancestry recheck for a trusted active compiler; full preparation must run first. */
export async function revalidateCompilerCacheDirectories(projectRoot, relativePaths) {
  return prepareDirectories(projectRoot, relativePaths, false);
}
