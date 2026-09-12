import { unzipSync, strFromU8 } from 'fflate';
import { digest } from './fingerprint';

/** User-installed upstream package. No third-party plugin source is distributed with STE. */
export interface InstalledBaiBai {
  id: 'ST-BaiBai-Book';
  version: '1.2.7';
  sourceCommit: string;
  installedAt: number;
  files: Record<string, string>;
}
export const BAIBAI_PIN = {
  version: '1.2.7', commit: '5c8a6b60d8c1185e169c46d43f63fce7d35d8583',
  js: '44254f4049f19b43e3c548cd1329530d33142e3e65218cf7735bafcdafd8ac1f',
  css: '075d0810c8c60645fe2ec816bd8579da55e97bdb537654147256bb71982ed99f',
} as const;
const FILES = ['manifest.json', 'dist/index.js', 'dist/index.css', 'PUBLIC_API.md'];
const MAX_ZIP = 25 * 1024 * 1024;
const MAX_FILE = 4 * 1024 * 1024;

export function validateBaiBaiPackage(value: InstalledBaiBai): InstalledBaiBai {
  if (value?.id !== 'ST-BaiBai-Book' || value.version !== BAIBAI_PIN.version || value.sourceCommit !== BAIBAI_PIN.commit
    || !value.files || Object.values(value.files).some(text => typeof text !== 'string' || text.length > MAX_FILE)) {
    throw new Error('柏宝书安装包格式无效');
  }
  const manifest = JSON.parse(value.files['manifest.json']);
  if (manifest.version !== BAIBAI_PIN.version || manifest.js !== 'dist/index.js?ver=1.2.7'
    || manifest.generate_interceptor !== 'bbs_generateInterceptor'
    || digest(value.files['dist/index.js'] ?? '') !== BAIBAI_PIN.js || digest(value.files['dist/index.css'] ?? '') !== BAIBAI_PIN.css) {
    throw new Error('目前已验证柏宝书 1.2.7 的指定原版文件，请使用安装说明中的版本');
  }
  return structuredClone(value);
}

export function readBaiBaiZip(bytes: Uint8Array): InstalledBaiBai {
  if (!bytes.length || bytes.length > MAX_ZIP) throw new Error('插件 ZIP 需小于 25 MB');
  const zip = unzipSync(bytes, { filter: file => file.originalSize <= MAX_FILE
    && FILES.some(name => file.name === name || file.name.endsWith('/' + name)) });
  const manifests = Object.keys(zip).filter(name => name === 'manifest.json' || name.endsWith('/manifest.json'));
  if (manifests.length !== 1) throw new Error('ZIP 中应有且仅有一个插件 manifest.json');
  const root = manifests[0].slice(0, -'manifest.json'.length);
  if (root.split('/').some(part => part === '..' || part === '.') || root.includes('\\') || root.startsWith('/')) throw new Error('插件目录无效');
  const files: Record<string, string> = {};
  for (const path of FILES) if (zip[root + path]) files[path] = strFromU8(zip[root + path]);
  return validateBaiBaiPackage({ id: 'ST-BaiBai-Book', version: '1.2.7', sourceCommit: BAIBAI_PIN.commit, installedAt: Date.now(), files });
}

function replaceOnce(source: string, before: string, after: string) {
  if (source.split(before).length !== 2) throw new Error('柏宝书兼容接入点已变化，已停止加载');
  return source.replace(before, after);
}

/** Three version-checked host seams: asset URLs, module imports and the branch memory owner. */
export function linkBaiBaiModule(installed: InstalledBaiBai): string {
  let source = validateBaiBaiPackage(installed).files['dist/index.js'];
  source = replaceOnce(source, 'function Vc(e,t){const n=new URL(e,t);return n.searchParams.set("ver",is),n.href}',
    'function Vc(e,t){return globalThis.__STE_BAIBAI_ASSET_URL__(e)}');
  source = replaceOnce(source, 'function Ht(){return x.enabled&&!Fg()}',
    'function Ht(){return globalThis.__STE_MEMORY_OWNER__==="baibai"&&x.enabled&&!Fg()}');
  source = replaceOnce(source, 'e[b].extra={...e[b].extra??{},bbs_hidden:!0}', 'globalThis.__STE_BAIBAI_HIDE__(e[b])');
  source = replaceOnce(source, 'u.extra={...u.extra??{},bbs_hidden:!0}', 'globalThis.__STE_BAIBAI_HIDE__(u)');
  source = replaceOnce(source, 'function fl(){Ls&&(clearTimeout(Ls),Ls=null),pe()?.saveChat?.()}',
    'async function fl(){Ls&&(clearTimeout(Ls),Ls=null);await pe()?.saveChat?.()}');
  // All eight dynamic imports in the pinned build refer to genuine ST modules, including three variable paths.
  if (source.split('import(').length !== 9) throw new Error('柏宝书模块引用已变化，已停止加载');
  source = source.replaceAll('import(', 'globalThis.__STE_BAIBAI_IMPORT__(');
  // Keep the original public API; this host hook only refreshes its existing injection after ownership changes.
  return source + '\n;globalThis.__STE_BAIBAI_REFRESH__=()=>mt();globalThis.__STE_BAIBAI_BUSY__=()=>Ct;globalThis.__STE_BAIBAI_FLUSH__=fl;\n';
}
