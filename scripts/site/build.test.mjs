import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildSite, siteUrl } from './build.mjs';
import { parseOptions, checksums } from '../deploy/prepare.mjs';

test('rejects unsafe and incompatible public URLs before building', () => {
  for (const url of ['ftp://example.org/', 'https://user:pass@example.org/', 'https://example.org/?token=x', 'https://example.org/../']) assert.throws(() => siteUrl(url));
  assert.throws(() => siteUrl('https://example.org/project/', 'app'));
  assert.throws(() => parseOptions(['--target', 'unknown'], {}));
  assert.equal(siteUrl('https://example.org/project').pathname, '/project/');
  assert.equal(siteUrl('http://192.168.1.20:8080', 'app').href, 'http://192.168.1.20:8080/');
  assert.deepEqual(parseOptions([], {}), { target: 'app', url: null });
  assert.equal(parseOptions(['--target', 'app', '--site-url', 'http://localhost:8080'], {}).url, 'http://localhost:8080/');
});

for (const mode of ['pages', 'app']) test(`${mode}: metadata and links only include public pages`, async t => {
  const out = await mkdtemp(path.join(tmpdir(), 'ste-public-site-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  const url = mode === 'pages' ? 'https://example.org/project/' : 'https://example.org/';
  const prefix = mode === 'app' ? 'about/' : '';
  const result = await buildSite({ out, mode, url });
  assert.equal(result.pages.length, 4);
  const html = await readFile(path.join(out, prefix, 'en/index.html'), 'utf8');
  assert.ok(html.includes(`rel="canonical" href="${url}${prefix}en/"`));
  assert.ok(html.includes(`hreflang="zh-CN" href="${url}${prefix}zh-CN/"`));
  assert.match(html, /"@type":"SoftwareApplication"/);
  assert.match(html, /name="robots" content="index,follow"/);
  assert.ok(html.includes(`href="${new URL(url).pathname}${prefix}en/guide/"`));
  const help = await readFile(path.join(out, prefix, 'zh-CN/guide/index.html'), 'utf8');
  assert.match(help, /"@type":"TechArticle"/);
  const sitemap = await readFile(path.join(out, 'sitemap.xml'), 'utf8');
  assert.equal((sitemap.match(/<url>/g) ?? []).length, 4);
  assert.doesNotMatch(sitemap, /\/library|\/chat|\/settings/);
  const robots = await readFile(path.join(out, 'robots.txt'), 'utf8');
  assert.ok(robots.includes(`Sitemap: ${url}sitemap.xml`));
  assert.doesNotMatch(robots, /Disallow: \/$/m);
  const hashes = await checksums(out);
  assert.ok(hashes.length >= 8);
  assert.ok(hashes.every(row => /^[a-f0-9]{64}  /.test(row)));
});

test('local previews have no invented canonical URL or indexable metadata', async t => {
  const out = await mkdtemp(path.join(tmpdir(), 'ste-local-site-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  await buildSite({ out });
  const html = await readFile(path.join(out, 'en/index.html'), 'utf8');
  assert.match(html, /noindex,follow/);
  assert.doesNotMatch(html, /rel="canonical"|property="og:url"/);
});

test('deployment config keeps public pages static, retains security headers in every location, and keeps private SPA routes noindex', async () => {
  const nginx = await readFile(new URL('../../nginx.conf', import.meta.url), 'utf8');
  assert.match(nginx, /location \^~ \/about\//);
  assert.match(nginx, /try_files \$uri \$uri\/ =404/);
  assert.match(nginx, /X-Robots-Tag "noindex, nofollow"/);
  assert.match(nginx, /location ~\* "\^\/assets\//, 'regex containing braces must be quoted for nginx');
  assert.match(nginx, /m\?js\|css\|less\|json/);
  assert.match(nginx, /location = \/sitemap\.xml \{[\s\S]*?\}/);
  const sitemapBlock = nginx.match(/location = \/sitemap\.xml \{[\s\S]*?\}/)?.[0] ?? '';
  assert.doesNotMatch(sitemapBlock, /noindex/);
  const blocksWithAddHeader = [...nginx.matchAll(/location\s+[^{]+\{([^}]*)\}/g)]
    .map(m => m[1])
    .filter(body => body.includes('add_header'));
  assert.ok(blocksWithAddHeader.length >= 7);
  for (const body of blocksWithAddHeader) {
    assert.match(body, /X-Content-Type-Options "nosniff"/, 'every location defining add_header must explicitly retain X-Content-Type-Options');
    assert.match(body, /Referrer-Policy "strict-origin-when-cross-origin"/, 'every location defining add_header must explicitly retain Referrer-Policy');
  }
  const app = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(app, /name="robots" content="noindex,nofollow"/);
  const workflow = await readFile(new URL('../../.github/workflows/pages.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /path: site-dist/);
  assert.doesNotMatch(workflow, /push:|pull_request:/);
});

test('public documentation links resolve to shipped source files', async () => {
  const files = ['README.md', 'README.zh-CN.md', 'CONTRIBUTING.md', 'SUPPORT.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md', ...['USAGE', 'DEPLOYMENT', 'I18N'].flatMap(name => [`docs/${name}.md`, `docs/${name}.zh-CN.md`])];
  const { access } = await import('node:fs/promises');
  for (const file of files) {
    const url = new URL(`../../${file}`, import.meta.url);
    const text = await readFile(url, 'utf8');
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const link = match[1];
      if (/^https?:|^#/.test(link)) continue;
      await assert.doesNotReject(access(new URL(link.split('#')[0], url)), `${file}: ${link}`);
    }
  }
});
