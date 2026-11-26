import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copy } from './content.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
const repository = 'https://github.com/LYC619/st-explore';
const locales = ['en', 'zh-CN'];
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function siteUrl(value, mode = 'pages') {
  if (!value) return null;
  if (/\\|\/\.\.?(?:\/|$)/.test(value)) throw Error('Site URL must not contain backslashes or relative path segments.');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw Error('Site URL must be an HTTP(S) URL without credentials, query, or fragment.');
  }
  if (mode === 'app' && url.pathname !== '/') {
    throw Error('The full web app must be hosted at the origin root. Use Pages mode for a subpath documentation site.');
  }
  url.pathname = url.pathname.replace(/\/$/, '') + '/';
  return url;
}

export async function buildSite({ out = path.join(root, 'site-dist'), mode = 'pages', url: inputUrl } = {}) {
  if (!['pages', 'app'].includes(mode)) throw Error('Mode must be pages or app.');
  const url = siteUrl(inputUrl, mode);
  const base = url?.pathname ?? '/';
  const prefix = mode === 'app' ? 'about/' : '';
  const route = (lang, help = false) => `${base}${prefix}${lang}/${help ? 'guide/' : ''}`;
  const absolute = routePath => url ? new URL(routePath, url).href : null;
  const asset = `${base}${prefix}site-assets/`;
  const outputPrefix = path.join(out, prefix);
  await mkdir(path.join(outputPrefix, 'site-assets'), { recursive: true });
  await copyFile(path.join(root, 'scripts/site/style.css'), path.join(outputPrefix, 'site-assets/style.css'));
  await copyFile(path.join(root, 'public/icon-512.png'), path.join(outputPrefix, 'site-assets/icon.png'));
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  const rendered = [];
  for (const lang of locales) for (const help of [false, true]) {
    const c = copy[lang], other = lang === 'en' ? 'zh-CN' : 'en';
    const pageUrl = absolute(route(lang, help));
    const title = `${help ? c.docsTitle : c.name} · ST Explorer`;
    const description = help ? c.docsDescription : c.description;
    const e = escapeHtml;
    const alternates = url ? [...locales, 'x-default'].map(l => `<link rel="alternate" hreflang="${l}" href="${e(absolute(route(l === 'x-default' ? 'en' : l, help)))}">`).join('\n') : '';
    const structured = help
      ? { '@context': 'https://schema.org', '@type': 'TechArticle', headline: title, description, inLanguage: lang, url: pageUrl }
      : { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'ST Explorer', description, applicationCategory: 'UtilitiesApplication', operatingSystem: 'Windows, Web', softwareVersion: version, license: 'https://www.gnu.org/licenses/agpl-3.0.html', inLanguage: lang, url: pageUrl };
    const githubDoc = name => `${repository}/blob/HEAD/docs/${name}${lang === 'zh-CN' ? '.zh-CN' : ''}.md`;
    const article = help
      ? `<div class="guide">${c.steps.map(([heading, text], i) => `<section class="step"><h2>${i + 1}. ${e(heading)}</h2><p>${e(text)}</p></section>`).join('')}<section class="note"><h2>${e(c.troubleshootingTitle)}</h2>${c.troubleshooting.map(([h, p]) => `<details><summary>${e(h)}</summary><p>${e(p)}</p></details>`).join('')}</section></div>`
      : `<div class="shelves">${c.features.map(([n, h, p]) => `<section class="shelf"><p class="eyebrow">${e(n)}</p><div><h2>${e(h)}</h2><p>${e(p)}</p></div></section>`).join('')}</div><section class="note"><h2>${e(c.privacyTitle)}</h2><p>${e(c.privacy)}</p></section><section class="note"><h2>${e(c.platformTitle)}</h2><p>${e(c.platforms)}</p></section>`;
    const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">
<title>${e(title)}</title><meta name="description" content="${e(description)}"><meta name="robots" content="${url ? 'index,follow' : 'noindex,follow'}">
${pageUrl ? `<link rel="canonical" href="${e(pageUrl)}">` : ''}${alternates}
<meta property="og:type" content="website"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:locale" content="${lang === 'en' ? 'en_US' : 'zh_CN'}"><meta property="og:locale:alternate" content="${lang === 'en' ? 'zh_CN' : 'en_US'}">
${pageUrl ? `<meta property="og:url" content="${e(pageUrl)}"><meta property="og:image" content="${e(absolute(`${asset}icon.png`))}">` : ''}<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${e(title)}"><meta name="twitter:description" content="${e(description)}">
<link rel="icon" href="${asset}icon.png"><link rel="stylesheet" href="${asset}style.css"><script type="application/ld+json">${JSON.stringify(structured).replace(/</g, '\\u003c')}</script></head>
<body><a class="skip" href="#main">${lang === 'en' ? 'Skip to content' : '跳到正文'}</a><header><a class="brand" href="${route(lang)}">ST EXPLORER</a><nav aria-label="${lang === 'en' ? 'Main navigation' : '主导航'}"><a href="${route(lang, !help)}">${e(help ? c.home : c.guide)}</a><a href="${route(other, help)}" lang="${other}" hreflang="${other}">${e(c.switch)}</a><a href="${repository}">GitHub ↗</a></nav></header>
<main id="main"><section class="hero"><p class="eyebrow">${e(c.eyebrow)}</p><h1>${e(help ? c.docsTitle : c.title)}</h1><p class="intro">${e(help ? c.docsDescription : c.intro)}</p>${help ? '' : `<div class="actions"><a class="button" href="${mode === 'app' ? `/?lang=${lang}` : repository}">${e(mode === 'app' ? c.open : c.source)}</a><a href="${route(lang, true)}">${e(c.guide)} →</a></div>`}</section>${article}</main>
<footer><nav><a href="${githubDoc('DEPLOYMENT')}">${e(c.deploy)}</a><a href="${githubDoc('I18N')}">${e(c.contribute)}</a></nav><p>${e(c.footer)} · v${version}</p></footer></body></html>\n`;
    const folder = path.join(outputPrefix, lang, help ? 'guide' : '');
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'index.html'), html);
    rendered.push({ lang, help, url: pageUrl });
  }
  await writeFile(path.join(outputPrefix, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>ST Explorer · Choose a language</title><link rel="stylesheet" href="${asset}style.css"></head><body><main class="hero"><h1>ST Explorer</h1><nav><a href="${route('en')}">English</a><a href="${route('zh-CN')}" lang="zh-CN">简体中文</a></nav></main></body></html>`);
  const sitemap = url ? `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rendered.map(p => `<url><loc>${escapeHtml(p.url)}</loc></url>`).join('')}</urlset>\n` : '';
  await writeFile(path.join(out, 'sitemap.xml'), sitemap);
  // Allow crawlers to read noindex on app routes. robots.txt is not access control.
  await writeFile(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\n${url ? `Sitemap: ${new URL(`${base}sitemap.xml`, url).href}\n` : ''}`);
  if (mode === 'pages') {
    await writeFile(path.join(out, '.nojekyll'), '');
    await writeFile(path.join(out, '404.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Page not found · ST Explorer</title></head><body><h1>Page not found / 页面不存在</h1><a href="' + base + '">ST Explorer</a></body></html>');
  }
  return { mode, siteUrl: url?.href ?? null, pages: rendered };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--site-url')) throw Error('Usage: npm run site:build -- [--site-url https://example.org/project/]');
  const result = await buildSite({ url: args[1] ?? process.env.STE_SITE_URL });
  console.log(`Built ${result.pages.length} public pages in site-dist (${result.siteUrl ?? 'local preview; noindex'}).`);
}
