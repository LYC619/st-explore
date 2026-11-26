import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite, siteUrl, root } from '../site/build.mjs';
import { collectBuildInfo } from '../build-info.mjs';

export function parseOptions(args, env = process.env) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--target', '--site-url'].includes(key) || args[i + 1] === undefined || args[i + 1].startsWith('--') || values[key]) {
      throw Error('Usage: npm run deploy:prepare -- [--target app|pages] [--site-url https://example.org/]');
    }
    values[key] = args[i + 1];
  }
  const target = values['--target'] ?? 'app';
  if (!['app', 'pages'].includes(target)) throw Error('Target must be app or pages.');
  const rawUrl = (values['--site-url'] ?? env.STE_SITE_URL ?? '').trim();
  const parsed = rawUrl ? siteUrl(rawUrl, target) : null;
  return { target, url: parsed?.href ?? null };
}

export async function checksums(folder) {
  const files = [];
  async function walk(relative = '') {
    for (const entry of await readdir(path.join(folder, relative), { withFileTypes: true })) {
      const next = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(next);
      else if (!['SHA256SUMS', 'deployment.json'].includes(next)) files.push(next);
    }
  }
  await walk();
  const rows = [];
  for (const file of files.sort()) {
    rows.push(`${createHash('sha256').update(await readFile(path.join(folder, file))).digest('hex')}  ${file}`);
  }
  return rows;
}

export async function prepare(options) {
  const out = path.join(root, options.target === 'app' ? 'dist' : 'site-dist');
  if (options.target === 'pages') {
    await rm(out, { recursive: true, force: true });
  } else {
    const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: root, stdio: 'inherit', windowsHide: true });
    if (result.error || result.status !== 0) throw Error('Production build failed.');
  }
  const site = await buildSite({ out, mode: options.target, url: options.url });
  const source = collectBuildInfo(root);
  const manifest = {
    schema: 1,
    target: options.target,
    siteUrl: site.siteUrl,
    source: { version: source.version, commit: source.commit, dirty: source.dirty, builtAt: source.builtAt },
    publicPages: site.pages.map(p => p.url),
  };
  await writeFile(path.join(out, 'deployment.json'), JSON.stringify(manifest, null, 2) + '\n');
  const rows = await checksums(out);
  rows.push(`${createHash('sha256').update(await readFile(path.join(out, 'deployment.json'))).digest('hex')}  deployment.json`);
  await writeFile(path.join(out, 'SHA256SUMS'), rows.join('\n') + '\n');
  console.log(`Prepared ${rows.length} files in ${path.basename(out)} (commit: ${source.commit ?? 'unknown'}).`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepare(parseOptions(process.argv.slice(2)));
}
