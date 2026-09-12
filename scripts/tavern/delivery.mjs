import { lstat, mkdir, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isWithin, lookupAsset, readAsset, requestPath, safeRelativePath } from './source.mjs';

const RESERVED_DIRECTORIES = [
  'css', 'dist', 'img', 'lib', 'locales', 'scripts', 'sounds', 'tauri', 'webfonts',
  'vendor', '.cache', 'default',
];
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm',
};

function reservedPath(pathname) {
  const lower = pathname.toLowerCase();
  return RESERVED_DIRECTORIES.some((directory) => lower === `/${directory}` || lower.startsWith(`/${directory}/`))
    || (lower.startsWith('/@fs/') && ['/vendor', '/.cache', '/scripts/tavern'].some((part) => lower.endsWith(part) || lower.includes(`${part}/`)));
}

/** Vite filesystem URLs may include a Windows drive or a POSIX absolute path. */
function viteFsRequestPath(rawUrl) {
  const encoded = rawUrl.slice('/@fs/'.length).split(/[?#]/, 1)[0];
  if (/%(?:2f|5c)/i.test(encoded)) return null;
  try {
    const relative = decodeURIComponent(encoded).replace(/^(?:[a-z]:\/|\/)/i, '');
    return safeRelativePath(relative) ? `/@fs/${relative}` : null;
  } catch {
    return null;
  }
}

function sendText(response, status, message) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(message);
}

/** Runs before Vite's static handler, so upstream raw ESM is never transformed. */
export function createAssetMiddleware(assets) {
  return async (request, response, next) => {
    if (request.url?.startsWith('/@fs/')) {
      const pathname = viteFsRequestPath(request.url);
      if (pathname === null || reservedPath(pathname)) return sendText(response, 404, 'Not found');
      // Preserve Vite's request and let its own filesystem allowlist handle module access.
      return next();
    }
    const pathname = requestPath(request.url);
    if (pathname === null) return sendText(response, 404, 'Not found');
    const asset = lookupAsset(assets, request.url);
    if (!asset) {
      if (reservedPath(pathname)) return sendText(response, 404, 'Not found');
      return next();
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      return sendText(response, 405, 'Method not allowed');
    }
    try {
      const content = await readAsset(asset);
      response.statusCode = 200;
      response.setHeader('Content-Type', MIME_TYPES[path.extname(pathname).toLowerCase()] ?? 'application/octet-stream');
      response.setHeader('Content-Length', content.length);
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch {
      sendText(response, 500, 'Tavern asset integrity check failed');
    }
  };
}

/** Check all destinations before the first write, including case-insensitive collisions. */
export async function checkAssetCollisions(assets, outputRoot) {
  const absoluteRoot = path.resolve(outputRoot);
  const rootStat = await lstat(absoluteRoot);
  if (rootStat.isSymbolicLink()) throw new Error('Output root is a symlink/junction');
  if (!rootStat.isDirectory()) throw new Error('Output root collision: expected a directory');
  const canonicalRoot = await realpath(absoluteRoot);
  const destinations = [];
  const names = new Set();
  for (const [url, asset] of assets) {
    const relative = url.slice(1);
    if (requestPath(url) !== url || !safeRelativePath(relative) || asset.url !== url) throw new Error(`Unsafe output asset path: ${url}`);
    const name = relative.toLowerCase();
    if (names.has(name)) throw new Error(`Output path collision: ${url}`);
    names.add(name);
    destinations.push({ asset, relative, target: path.join(absoluteRoot, relative) });
  }
  const directoryEntries = new Map();
  for (const destination of destinations) {
    const parts = destination.relative.split('/');
    for (let i = 1; i < parts.length; i++) {
      if (names.has(parts.slice(0, i).join('/').toLowerCase())) throw new Error(`Output file/directory collision: ${destination.relative}`);
    }
    let current = absoluteRoot;
    for (let i = 0; i < parts.length; i++) {
      let entries = directoryEntries.get(current);
      if (!entries) {
        entries = await readdir(current, { withFileTypes: true });
        directoryEntries.set(current, entries);
      }
      const existing = entries.find((entry) => entry.name.toLowerCase() === parts[i].toLowerCase());
      if (!existing) break;
      const existingPath = path.join(current, existing.name);
      if (existing.isSymbolicLink() || !isWithin(canonicalRoot, await realpath(existingPath))) {
        throw new Error(`Output symlink/junction escapes an approved directory: ${destination.relative}`);
      }
      if (i === parts.length - 1 || !existing.isDirectory() || existing.name !== parts[i]) {
        throw new Error(`Output collision with existing file or directory: ${destination.relative}`);
      }
      current = existingPath;
    }
  }
  return { canonicalRoot, destinations };
}

export async function copyAssets(assets, outputRoot) {
  await mkdir(outputRoot, { recursive: true });
  const { canonicalRoot, destinations } = await checkAssetCollisions(assets, outputRoot);
  // Verify all source bytes before publishing any of this asset set.
  const pending = [];
  for (const destination of destinations) pending.push({ ...destination, content: await readAsset(destination.asset) });
  for (const { target, content } of pending) {
    await mkdir(path.dirname(target), { recursive: true });
    if (!isWithin(canonicalRoot, await realpath(path.dirname(target)))) throw new Error('Output parent escapes the build directory');
    await writeFile(target, content, { flag: 'wx' });
  }
  return pending.length;
}
