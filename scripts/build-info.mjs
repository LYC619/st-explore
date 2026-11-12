import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Only inputs shipped in the application or used to build it affect the label.
export const BUILD_INPUT_PATHS = Object.freeze([
  'src', 'public', 'vendor', 'index.html', 'src-tauri/src', 'src-tauri/icons',
  'src-tauri/capabilities', 'src-tauri/tauri.conf.json', 'src-tauri/build.rs',
  'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'package.json', 'package-lock.json',
  'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json',
  'tailwind.config.ts', 'postcss.config.js', 'scripts/tavern',
  'scripts/build-info.mjs', 'scripts/release-pack.mjs',
]);
export function isBuildInput(file) {
  if (/(^|\/)(node_modules|target|test|tests|__tests__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) return false;
  return BUILD_INPUT_PATHS.some(p => file === p || file.startsWith(p + '/'));
}
export function collectBuildInfo(root = process.cwd(), { now = new Date(), git = execFileSync } = {}) {
  const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  let commit = null, dirty = null, dirtyFiles = [];
  try {
    const options = { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] };
    commit = git('git', ['rev-parse', '--short=12', 'HEAD'], options).trim();
    // A union avoids porcelain rename parsing and detects staged, unstaged and new inputs.
    const files = [
      ...git('git', ['diff', 'HEAD', '--no-renames', '--name-only', '-z'], options).split('\0'),
      ...git('git', ['ls-files', '--others', '--exclude-standard', '-z', '--', ...BUILD_INPUT_PATHS], options).split('\0'),
    ];
    dirtyFiles = [...new Set(files.filter(isBuildInput))].sort();
    dirty = dirtyFiles.length > 0;
  } catch { commit = null; dirty = null; dirtyFiles = []; }
  return { schema: 1, version, commit, dirty, builtAt: now.toISOString(), dirtyFiles, inputPaths: [...BUILD_INPUT_PATHS] };
}

export function resolveBuildInfo(root = process.cwd()) {
  // The pack command supplies one immutable receipt to every build stage.
  if (process.env.STE_BUILD_INFO_FILE) {
    const info = JSON.parse(readFileSync(process.env.STE_BUILD_INFO_FILE, 'utf8'));
    const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    if (info.schema !== 1 || info.version !== version || typeof info.builtAt !== 'string') throw Error('Invalid build receipt');
    return info;
  }
  return collectBuildInfo(root);
}
