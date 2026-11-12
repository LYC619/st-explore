import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const TARGETS = Object.freeze([
  'package-lock.json',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'src/components/GlobalSettings.tsx',
  'public/sw.js',
  'README.md',
]);

export function replaceExactlyOnce(text, expression, replacement, label) {
  const flags = expression.flags.includes('g') ? expression.flags : `${expression.flags}g`;
  const matcher = new RegExp(expression.source, flags);
  const matches = [...text.matchAll(matcher)];
  if (matches.length !== 1) {
    throw new Error(`${label}: expected one marker, got ${matches.length}`);
  }
  return text.replace(new RegExp(expression.source, expression.flags), replacement);
}

function sectionBlocks(text) {
  const headers = [
    ...text.matchAll(/^\[\[package\]\][ \t]*(?:\r?\n|$)|^\[(?!\[)[^\r\n]+\][ \t]*(?:\r?\n|$)/gm),
  ];
  return headers.map((header, index) => ({
    start: header.index,
    end: headers[index + 1]?.index ?? text.length,
    text: text.slice(header.index, headers[index + 1]?.index ?? text.length),
  }));
}

export function cargoLockPackageBlocks(text) {
  return sectionBlocks(text).filter((block) => /^\[\[package\]\]/.test(block.text));
}

export function replaceCargoLockVersion(text, version) {
  const matches = cargoLockPackageBlocks(text).filter((block) =>
    /^name[ \t]*=[ \t]*"ste-explorer"[ \t]*\r?$/m.test(block.text));
  if (matches.length !== 1) {
    throw new Error('Cargo.lock: expected one ste-explorer package');
  }
  const block = matches[0];
  const replaced = replaceExactlyOnce(
    block.text,
    /^version[ \t]*=[ \t]*"[^"]+"/m,
    (match) => match.replace(/"[^"]+"$/, `"${version}"`),
    'Cargo.lock self version',
  );
  return text.slice(0, block.start) + replaced + text.slice(block.end);
}

export function replaceCargoPackageVersion(text, version) {
  const packageHeaders = [...text.matchAll(/^\[package\][ \t]*(?:\r?\n|$)/gm)];
  if (packageHeaders.length !== 1) {
    throw new Error(`Cargo.toml package section: expected one marker, got ${packageHeaders.length}`);
  }
  const start = packageHeaders[0].index;
  const nextHeader = text.slice(start + packageHeaders[0][0].length).search(/^\[/m);
  const end = nextHeader < 0 ? text.length : start + packageHeaders[0][0].length + nextHeader;
  const block = text.slice(start, end);
  const replaced = replaceExactlyOnce(
    block,
    /^(version[ \t]*=[ \t]*)"[^"]+"/m,
    (_match, prefix) => `${prefix}"${version}"`,
    'Cargo package version',
  );
  return text.slice(0, start) + replaced + text.slice(end);
}

function parseJson(text, file) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${file}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireString(value, label) {
  if (typeof value !== 'string') throw new Error(`${label}: expected a string version`);
  return value;
}

function targetPath(root, relative) {
  return join(root, relative);
}

export async function syncVersion(root, mode = 'check') {
  if (mode !== 'check' && mode !== 'write') throw new Error(`unknown mode: ${mode}`);
  const projectRoot = resolve(root);
  const packageFile = targetPath(projectRoot, 'package.json');
  const packageJson = parseJson(await readFile(packageFile, 'utf8'), 'package.json');
  const version = requireString(packageJson.version, 'package.json version');
  if (!VERSION_PATTERN.test(version)) throw new Error(`package.json version is not a stable semver: ${version}`);

  const sourceTexts = new Map();
  await Promise.all(TARGETS.map(async (relative) => {
    sourceTexts.set(relative, await readFile(targetPath(projectRoot, relative), 'utf8'));
  }));

  const packageLock = parseJson(sourceTexts.get('package-lock.json'), 'package-lock.json');
  requireString(packageLock.version, 'package-lock.json version');
  const rootPackage = packageLock.packages?.[''];
  if (!rootPackage || typeof rootPackage !== 'object') {
    throw new Error('package-lock.json packages[""].version: missing root package');
  }
  requireString(rootPackage.version, 'package-lock.json packages[""].version');

  const tauri = parseJson(sourceTexts.get('src-tauri/tauri.conf.json'), 'src-tauri/tauri.conf.json');
  requireString(tauri.version, 'tauri.conf.json version');

  const nextTexts = new Map(sourceTexts);
  const nextPackageLock = structuredClone(packageLock);
  nextPackageLock.version = version;
  nextPackageLock.packages[''].version = version;
  nextTexts.set('package-lock.json', packageLock.version === version && rootPackage.version === version
    ? sourceTexts.get('package-lock.json') : `${JSON.stringify(nextPackageLock, null, 2)}\n`);
  nextTexts.set(
    'src-tauri/tauri.conf.json',
    tauri.version === version ? sourceTexts.get('src-tauri/tauri.conf.json') : `${JSON.stringify({ ...tauri, version }, null, 2)}\n`,
  );
  nextTexts.set(
    'src-tauri/Cargo.toml',
    replaceCargoPackageVersion(sourceTexts.get('src-tauri/Cargo.toml'), version),
  );
  nextTexts.set(
    'src-tauri/Cargo.lock',
    replaceCargoLockVersion(sourceTexts.get('src-tauri/Cargo.lock'), version),
  );
  nextTexts.set(
    'src/components/GlobalSettings.tsx',
    replaceExactlyOnce(
      sourceTexts.get('src/components/GlobalSettings.tsx'),
      /\bAPP_VERSION\s*=\s*'[^']+'/,
      `APP_VERSION = 'v${version}'`,
      'GlobalSettings APP_VERSION',
    ),
  );
  nextTexts.set(
    'public/sw.js',
    replaceExactlyOnce(
      sourceTexts.get('public/sw.js'),
      /\bCACHE_VERSION\s*=\s*'[^']+'/,
      `CACHE_VERSION = 'v${version}'`,
      'Service Worker CACHE_VERSION',
    ),
  );

  nextTexts.set(
    'README.md',
    replaceExactlyOnce(
      sourceTexts.get('README.md'),
      /https:\/\/img\.shields\.io\/badge\/version-v\d+\.\d+\.\d+-orange/,
      `https://img.shields.io/badge/version-v${version}-orange`,
      'README version badge',
    ),
  );

  const changedFiles = TARGETS
    .filter((relative) => sourceTexts.get(relative) !== nextTexts.get(relative))
    .map((relative) => targetPath(projectRoot, relative));
  if (mode === 'write') {
    await Promise.all(changedFiles.map(async (file) => {
      const relative = file.slice(projectRoot.length + 1).replaceAll('\\', '/');
      await writeFile(file, nextTexts.get(relative), 'utf8');
    }));
  }
  return { version, mode, changedFiles };
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== '--check' && argv[0] !== '--write')) {
    console.error('Usage: node scripts/sync-version.mjs [--check|--write]');
    process.exitCode = 2;
    return;
  }
  const mode = argv[0] === '--write' ? 'write' : 'check';
  try {
    const result = await syncVersion(dirname(dirname(fileURLToPath(import.meta.url))), mode);
    if (result.changedFiles.length > 0) {
      console.error(`${mode}: ${result.changedFiles.length} version source(s) ${mode === 'check' ? 'out of sync' : 'updated'}`);
      result.changedFiles.forEach((file) => console.error(`- ${file}`));
      if (mode === 'check') process.exitCode = 1;
    } else {
      console.log(`${mode}: version sources are synchronized at ${result.version}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
