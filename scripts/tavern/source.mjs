import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PINNED_COMMIT = '9693a4ec47cd4552f90878bccab453f176de0f18';
export const PINNED_REPOSITORY = 'https://github.com/Darkatse/TauriTavern.git';
export const ORIGINAL_BUILD_FILES = ['LICENSE', 'package.json', 'pnpm-lock.yaml', 'rspack.config.js'];
export const SOURCE_MANIFEST_NAME = 'SOURCE-MANIFEST.json';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Reject paths before resolving them: URL normalization must never erase traversal. */
export function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || /[\\:%\x00-\x1f\x7f]/.test(value)) return false;
  return value.split('/').every((part) => part && part !== '.' && part !== '..');
}

export function requestPath(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/') || rawUrl.startsWith('//')) return null;
  const encoded = rawUrl.split(/[?#]/, 1)[0];
  if (/%(?:2f|5c)/i.test(encoded)) return null;
  try {
    const decoded = decodeURIComponent(encoded);
    const relative = decoded.endsWith('/') ? decoded.slice(1, -1) : decoded.slice(1);
    return decoded === '/' || safeRelativePath(relative) ? decoded : null;
  } catch {
    return null;
  }
}

export function isWithin(root, target) {
  const relative = path.relative(root, target);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

export async function safeFile(root, relativePath) {
  if (!safeRelativePath(relativePath)) throw new Error(`Unsafe relative asset path: ${relativePath}`);
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(path.resolve(root, relativePath))]);
  if (!isWithin(realRoot, realFile)) throw new Error(`Asset path escapes outside its root: ${relativePath}`);
  if (!(await lstat(realFile)).isFile()) throw new Error(`Asset path is not a regular file: ${relativePath}`);
  return realFile;
}

/** Read the allowlisted file again for each use so a later edit cannot bypass preparation. */
export async function readAsset(asset) {
  if (!asset) throw new Error('Missing manifest asset');
  const file = await safeFile(asset.root, asset.path);
  const bytes = await readFile(file);
  if (bytes.length !== asset.size || sha256(bytes) !== asset.sha256) {
    throw new Error(`Asset integrity/hash mismatch: ${asset.path}`);
  }
  if (asset.transform === 'entry-html') {
    let html = bytes.toString('utf8');
    for (const [original, replacement] of [
      ['href="manifest.json"', 'href="tavern.webmanifest"'],
      ['href="favicon.ico"', 'href="tavern-favicon.ico"'],
    ]) {
      if (html.split(original).length !== 2) throw new Error(`Pinned entry attribute changed: ${original}`);
      html = html.replace(original, replacement);
    }
    return Buffer.from(html);
  }
  return bytes;
}

async function walkFiles(root, relative = '') {
  const results = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const file = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symlink in pinned source: ${file}`);
    if (entry.isDirectory()) results.push(...await walkFiles(root, file));
    else if (entry.isFile()) results.push(file);
    else throw new Error(`Non-regular pinned source: ${file}`);
  }
  return results.sort();
}

export async function originalFilePaths(vendorRoot) {
  const sourceFiles = (await walkFiles(path.join(vendorRoot, 'src'))).map((file) => `src/${file}`);
  const defaults = (await walkFiles(path.join(vendorRoot, 'default/content'))).map((file) => `default/content/${file}`);
  return [...ORIGINAL_BUILD_FILES, ...sourceFiles, ...defaults].sort();
}

/** Maintenance command only; normal preparation never updates the reviewed manifest. */
export async function recordSourceManifest(projectRoot = PROJECT_ROOT) {
  const vendorRoot = path.join(projectRoot, 'vendor/tauritavern');
  const provenance = JSON.parse(await readFile(path.join(vendorRoot, 'UPSTREAM.json'), 'utf8'));
  validatePin(provenance);
  const files = [];
  for (const file of await originalFilePaths(vendorRoot)) {
    const bytes = await readFile(await safeFile(vendorRoot, file));
    files.push({ path: file, sha256: sha256(bytes), size: bytes.length });
  }
  const manifest = { schemaVersion: 1, commit: PINNED_COMMIT, hashAlgorithm: 'sha256', files };
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path.join(vendorRoot, SOURCE_MANIFEST_NAME), content);
  provenance.sourceManifest = { file: SOURCE_MANIFEST_NAME, sha256: sha256(content) };
  await writeFile(path.join(vendorRoot, 'UPSTREAM.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  return manifest;
}

function validatePin(provenance) {
  if (provenance.schemaVersion !== 1 || provenance.repository !== PINNED_REPOSITORY || provenance.commit !== PINNED_COMMIT) {
    throw new Error('Unreviewed TauriTavern repository/commit pin');
  }
  if (provenance.packageVersion !== '2.2.0' || provenance.sillyTavernVersion !== '1.18.0' || provenance.localEdits?.length !== 0) {
    throw new Error('Unreviewed upstream version or source edits');
  }
}

export async function loadPinnedSource(projectRoot = PROJECT_ROOT) {
  const vendorRoot = path.join(projectRoot, 'vendor/tauritavern');
  const provenance = JSON.parse(await readFile(await safeFile(vendorRoot, 'UPSTREAM.json'), 'utf8'));
  validatePin(provenance);
  const bytes = await readFile(await safeFile(vendorRoot, SOURCE_MANIFEST_NAME));
  const manifestHash = sha256(bytes);
  if (provenance.sourceManifest?.file !== SOURCE_MANIFEST_NAME || manifestHash !== provenance.sourceManifest.sha256) {
    throw new Error('Source manifest integrity/hash mismatch');
  }
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.schemaVersion !== 1 || manifest.commit !== PINNED_COMMIT || manifest.hashAlgorithm !== 'sha256' || !Array.isArray(manifest.files)) {
    throw new Error('Invalid pinned source manifest');
  }
  const names = new Set();
  for (const file of manifest.files) {
    if (!safeRelativePath(file.path) || (!file.path.startsWith('src/') && !file.path.startsWith('default/content/') && !ORIGINAL_BUILD_FILES.includes(file.path))) {
      throw new Error(`Path outside source subset: ${file.path}`);
    }
    if (names.has(file.path.toLowerCase())) throw new Error(`Source manifest path collision: ${file.path}`);
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0) {
      throw new Error(`Invalid source hash/size: ${file.path}`);
    }
    names.add(file.path.toLowerCase());
    await readAsset({ root: vendorRoot, ...file });
  }
  if (JSON.stringify(manifest.files.map((file) => file.path).sort()) !== JSON.stringify(await originalFilePaths(vendorRoot))) {
    throw new Error('Pinned source subset contains missing or unlisted files');
  }
  const upstreamPackage = JSON.parse(await readFile(path.join(vendorRoot, 'package.json'), 'utf8'));
  const compatibility = await readFile(path.join(vendorRoot, 'src/compat-version.js'), 'utf8');
  if (upstreamPackage.name !== 'tauritavern' || upstreamPackage.version !== provenance.packageVersion || !compatibility.includes(`'${provenance.sillyTavernVersion}'`)) {
    throw new Error('Pinned source version does not match provenance');
  }
  return { projectRoot, vendorRoot, provenance, manifest, manifestHash };
}

/** Explicit exceptions; any other collision must fail instead of overwriting STE. */
export const SOURCE_URL_OVERRIDES = Object.freeze({
  'src/index.html': '/tavern.html',
  'src/favicon.ico': '/tavern-favicon.ico',
  'src/manifest.json': '/tavern.webmanifest',
  'src/robots.txt': null,
});

export function sourceAssetEntries(source) {
  const assets = new Map();
  for (const file of source.manifest.files) {
    if (!file.path.startsWith('src/')) continue;
    const url = Object.hasOwn(SOURCE_URL_OVERRIDES, file.path) ? SOURCE_URL_OVERRIDES[file.path] : `/${file.path.slice(4)}`;
    if (url === null) continue;
    if (assets.has(url)) throw new Error(`Source URL collision: ${url}`);
    assets.set(url, { root: source.vendorRoot, ...file, url, ...(file.path === 'src/index.html' ? { transform: 'entry-html' } : {}) });
  }
  return assets;
}

export function lookupAsset(assets, rawUrl) {
  const pathname = requestPath(rawUrl);
  return pathname === null ? null : assets.get(pathname) ?? null;
}
