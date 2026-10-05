import { unzipSync, strFromU8 } from 'fflate';
import { digest } from './fingerprint';

export const HELPER_PIN = {
  version: '4.11.3', commit: '87ca341a2a2279f4c18cd1918c5ae9dbd1dac492',
  js: 'e735f6ee5a0c2198dc980847f9b6284e3d36d6b394bbe38b0c4d801482fba7f7',
  css: '74e471b8565f8a9bb95d2b2ac7616105aa5e3bd12f9692dae75d9427ae5190af',
  editor: '983629948b23a48a87150d4c0338d619da5158beda31805c5dc68e24c6f64b8f',
  tailwind: '3573a896869009f2ab0ea9870ba0279cb8bda0dd45d710a83950367d19ee7ea9',
} as const;
export const HELPER_ZIP_URL = `https://codeload.github.com/N0VI028/JS-Slash-Runner/zip/${HELPER_PIN.commit}`;
export interface InstalledTavernHelper { version: string; sourceCommit: string; installedAt: number; files: Record<string, string> }
const REQUIRED = ['manifest.json', 'dist/index.js', 'dist/index.css', 'LICENSE', 'lib/jsoneditor.js', 'lib/tailwindcss.min.js', 'i18n/en.json'];

export function validateTavernHelper(pkg: InstalledTavernHelper): InstalledTavernHelper {
  if (!pkg?.files || pkg.version !== HELPER_PIN.version || pkg.sourceCommit !== HELPER_PIN.commit
    || Object.values(pkg.files).some(text => typeof text !== 'string' || text.length > 3_000_000)) throw new Error('酒馆助手安装包格式无效');
  const manifest = JSON.parse(pkg.files['manifest.json']);
  if (manifest.version !== HELPER_PIN.version || manifest.js !== 'dist/index.js' || manifest.css !== 'dist/index.css'
    || !pkg.files.LICENSE || digest(pkg.files['dist/index.js'] ?? '') !== HELPER_PIN.js || digest(pkg.files['dist/index.css'] ?? '') !== HELPER_PIN.css
    || digest(pkg.files['lib/jsoneditor.js'] ?? '') !== HELPER_PIN.editor || digest(pkg.files['lib/tailwindcss.min.js'] ?? '') !== HELPER_PIN.tailwind) {
    throw new Error('请使用已验证的酒馆助手 4.11.3 原版 ZIP（安装面板提供下载链接）');
  }
  return pkg;
}
export function readTavernHelperZip(bytes: Uint8Array): InstalledTavernHelper {
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error('插件 ZIP 需小于 25 MB');
  const zip = unzipSync(bytes, { filter: file => file.originalSize <= 3_000_000 && REQUIRED.some(path => file.name === path || file.name.endsWith('/' + path)) });
  const manifests = Object.keys(zip).filter(path => path === 'manifest.json' || path.endsWith('/manifest.json'));
  if (manifests.length !== 1) throw new Error('ZIP 中应只有一个插件 manifest.json');
  const root = manifests[0].slice(0, -'manifest.json'.length);
  if (root.includes('\\') || root.startsWith('/') || root.split('/').some(part => part === '.' || part === '..')) throw new Error('插件目录无效');
  const files = Object.fromEntries(REQUIRED.filter(path => zip[root + path]).map(path => [path, strFromU8(zip[root + path])]));
  return validateTavernHelper({ version: HELPER_PIN.version, sourceCommit: HELPER_PIN.commit, installedAt: Date.now(), files });
}

/** The pinned bundle's only relative ESM references target the original ST root. */
export function linkTavernHelper(pkg: InstalledTavernHelper, origin: string, editorUrl: string, tailwindUrl: string): string {
  const base = new URL('/', origin).href;
  return validateTavernHelper(pkg).files['dist/index.js'].replaceAll('../../../../../', base)
    .replace('../lib/jsoneditor.js', editorUrl).replace('/scripts/extensions/third-party/JS-Slash-Runner/lib/tailwindcss.min.js', tailwindUrl);
}
