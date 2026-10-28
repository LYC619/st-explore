import { strToU8, zipSync } from 'fflate';
import { sha256 } from 'js-sha256';
import { type PresetCatalog, type PresetItem, type PresetPackageFile } from '@/types/preset';
import { exportPreset, isValidPreset, parsePreset } from './preset-parser';
import { inspectPresetScripts, normalizePresetCatalog, presetContentFingerprint, suggestPresetModels } from './preset-catalog';
import { getCurrentRepo } from './repo';
import { getActiveVault, getVaultEpoch } from './vault/active';
import { safeName } from './vault/naming';
import { joinPath } from './vault/fs';
import { savePackBytes } from './reading-pack/save';
import { stableJson } from './roleplay/fingerprint';
import { saveTextFile } from './roleplay/export-package-file';
import { presetName } from './preset-presentation';

export const PACKAGE_KIND_LABELS: Record<PresetPackageFile['kind'], string> = {
  regex: '正则', script: '脚本', notes: '说明', other: '其他文件',
};
const MAX_FILES = 100;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

export interface PresetImportCandidate {
  key: string;
  name: string;
  preset: PresetItem['preset'];
  suggestedModels: string[];
  duplicateTitles: string[];
}
export interface PresetPackagePreview {
  epoch: number;
  presets: PresetImportCandidate[];
  files: PresetPackageFile[];
  errors: string[];
}

function isRegex(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  return typeof object.findRegex === 'string' && typeof object.replaceString === 'string';
}

/** Standalone, community pack and extracted ST extension shapes. */
export function presetAttachmentRegexEntries(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value.length && value.every(isRegex) ? value : undefined;
  if (isRegex(value)) return [value];
  if (!value || typeof value !== 'object') return;
  const entry = value as Record<string, unknown>;
  for (const key of ['scripts', 'regex_scripts', 'extensions']) {
    const entries = presetAttachmentRegexEntries(entry[key]);
    if (entries) return entries;
  }
}

export function classifyPresetAttachment(name: string, text: string): PresetPackageFile['kind'] {
  if (/\.(md|txt)$/i.test(name)) return 'notes';
  if (/\.(js|mjs)$/i.test(name)) return 'script';
  try {
    const value: unknown = JSON.parse(text);
    if (presetAttachmentRegexEntries(value)) return 'regex';
    if (inspectPresetScripts(value).length > 0) return 'script';
  } catch { /* Unknown or broken JSON is preserved as an attachment, not executed. */ }
  return 'other';
}

/** File inputs only: never writes to or enumerates the community source directory. */
export async function readPresetPackage(files: File[]): Promise<PresetPackagePreview> {
  const epoch = getVaultEpoch();
  if (files.length > MAX_FILES || files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) {
    throw new Error('一次最多选择 100 个文件，总计不超过 32 MB');
  }
  const preview: PresetPackagePreview = { epoch, presets: [], files: [], errors: [] };
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES || !/\.(json|js|mjs|md|txt)$/i.test(file.name)) {
      preview.errors.push(`${file.name}：仅接受 8 MB 以内的 JSON、JS、MD、TXT；压缩包请先解压`);
      continue;
    }
    try {
      const text = await file.text();
      let raw: unknown;
      try { raw = JSON.parse(text); } catch { /* Keep unrecognized files below. */ }
      if (isValidPreset(raw)) {
        // A STE managed file can also be chosen. Metadata is not prompt content.
        const { __ste: _meta, ...data } = raw;
        const preset = parsePreset(data);
        preview.presets.push({ key: crypto.randomUUID(), name: file.name.replace(/\.json$/i, ''), preset,
          suggestedModels: suggestPresetModels(file.name, preset), duplicateTitles: [] });
      } else {
        preview.files.push({ id: crypto.randomUUID(), name: file.name, text, kind: classifyPresetAttachment(file.name, text) });
      }
    } catch (error) {
      preview.errors.push(`${file.name}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // Read failures must not be presented as "no duplicates".
  if (preview.presets.length) {
    const existing = await getCurrentRepo<PresetItem>('presets').list();
    const fingerprints = new Map<string, string[]>();
    for (const item of existing) {
      const hash = presetContentFingerprint(item.preset);
      fingerprints.set(hash, [...(fingerprints.get(hash) ?? []), item.title]);
    }
    for (const candidate of preview.presets) {
      const hash = presetContentFingerprint(candidate.preset);
      candidate.duplicateTitles = fingerprints.get(hash) ?? [];
      fingerprints.set(hash, [...candidate.duplicateTitles, `${candidate.name}（本批）`]);
    }
  }
  if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新选择文件');
  return preview;
}

export function buildImportedPreset(candidate: PresetImportCandidate, catalog: PresetCatalog, files: PresetPackageFile[]): PresetItem {
  const now = Date.now();
  return {
    id: `preset_${candidate.key}`, title: catalog.name?.trim() || candidate.name.trim() || '未命名预设',
    preset: structuredClone(candidate.preset), createdAt: now, updatedAt: now, autoSaved: false,
    catalog: normalizePresetCatalog({ ...catalog, updatedAt: now,
      releaseNotes: catalog.releaseNotes || files.filter(file => file.kind === 'notes').map(file => `【${file.name}】\n${file.text}`).join('\n\n') }),
    packageFiles: structuredClone(files),
  };
}

function exportFileName(name: string): string {
  const extension = name.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? '';
  return `${safeName(extension ? name.slice(0, -extension.length) : name)}${extension}`;
}

/** One source for native folders and ZIPs. Only the ST JSON contains executable settings. */
export function buildPresetExportFiles(item: PresetItem): Record<string, string> {
  const raw = JSON.parse(exportPreset(item.preset));
  delete raw.__ste;
  const files: Record<string, string> = Object.create(null);
  files[`${safeName(presetName(item))}.json`] = JSON.stringify(raw, null, 2);
  const c = item.catalog ?? {};
  files['STE-取用说明.txt'] = [
    `预设：${presetName(item)}`, `作者：${c.author || '未填写'}`, `系列：${c.series || '未填写'}`, `版本：${c.version || '未填写'}`,
    `变体：${c.variant || '未填写'}`, `适配模型（手动标记／作者声明）：${c.models?.join('、') || '未标记'}`,
    `来源：${c.sourceUrl || '未填写'}`, '',
    '根目录 JSON：在 SillyTavern 的聊天补全预设中导入。',
    '附带目录：保留作者提供的原文件，正则和脚本请按作者说明到对应扩展中导入。',
    '内嵌正则、脚本继续保留在预设 JSON 内；STE 不自动启用附带资源。',
    '这是本次生成的取用副本；在这里改文件不会回写 STE 预设库。',
  ].join('\n');
  if (c.releaseNotes) files['作者发布说明.md'] = c.releaseNotes;
  const used = new Set(Object.keys(files).map(name => name.toLowerCase()));
  for (const file of item.packageFiles ?? []) {
    const name = exportFileName(file.name);
    let path = `附带/${PACKAGE_KIND_LABELS[file.kind]}/${name}`;
    for (let n = 2; used.has(path.toLowerCase()); n++) path = `附带/${PACKAGE_KIND_LABELS[file.kind]}/${n}-${name}`;
    used.add(path.toLowerCase());
    files[path] = file.text;
  }
  return files;
}

/** Locate the managed original. Never create an export copy just to open its folder. */
export async function openPresetLocation(id: string): Promise<void> {
  const epoch = getVaultEpoch(), vault = getActiveVault();
  if (!vault?.fs.openPath) throw new Error('打开所在文件夹需要桌面文件库；浏览器中请使用导出预设');
  const path = await vault.pathOf('presets', id);
  if (!path) throw new Error('预设文件已不存在，请刷新列表');
  if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新操作');
  await vault.fs.openPath(path, true);
}

export async function exportPresetPackage(id: string, mode: 'folder' | 'zip' | 'json'): Promise<string | null> {
  const epoch = getVaultEpoch(), vault = getActiveVault();
  const item = await getCurrentRepo<PresetItem>('presets').get(id);
  if (!item) throw new Error('预设不存在，请刷新列表');
  const assertCurrent = () => { if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新操作'); };
  assertCurrent();
  if (mode === 'json') {
    const raw = JSON.parse(exportPreset(item.preset));
    delete raw.__ste;
    const result = await saveTextFile({ fileName: `${safeName(presetName(item))}.json`, text: JSON.stringify(raw, null, 2), label: '预设', extension: 'json' });
    return result === 'cancelled' ? null : '预设 JSON 已导出';
  }
  const files = buildPresetExportFiles(item);
  const c = item.catalog ?? {};
  const group = [safeName(c.author || '未分类作者'), safeName(c.series || item.title), safeName([c.version || '未标版本', c.variant].filter(Boolean).join(' · '))].join('/');
  if (mode === 'folder') {
    if (!vault?.fs.openPath) throw new Error('打开文件夹需要桌面文件库，请使用导出取用包');
    const token = crypto.randomUUID();
    const staged = `.ste/preset-exports/${token}`;
    const digest = sha256(stableJson({ id: item.id, files })).slice(0, 12);
    let destination = joinPath('导出/预设', `${group} · ${digest}`);
    if ((await vault.fs.stat(destination)).exists) {
      let intact = true;
      for (const [path, text] of Object.entries(files)) {
        try { if (await vault.fs.readText(joinPath(destination, path)) !== text) intact = false; }
        catch { intact = false; }
        if (!intact) break;
      }
      assertCurrent();
      if (intact) {
        try { await vault.fs.openPath(destination); }
        catch { throw new Error(`取用副本已存在，但无法打开文件管理器。库内位置：${destination}`); }
        return destination;
      }
      // A user may have edited their export copy; preserve it and choose a new folder.
      destination += ` · ${token.slice(0, 8)}`;
    }
    await vault.fs.mkdir(staged);
    try {
      for (const [path, text] of Object.entries(files)) {
        assertCurrent();
        await vault.fs.writeText(joinPath(staged, path), text);
      }
      assertCurrent();
      await vault.fs.mkdir(destination.slice(0, destination.lastIndexOf('/')));
      await vault.fs.rename(staged, destination); // Refuses existing destinations, including user files.
    } catch (error) {
      throw new Error(`取用文件夹生成未完成：${error instanceof Error ? error.message : String(error)}；临时文件保留在 ${staged}，可重试生成新副本`);
    }
    assertCurrent();
    try { await vault.fs.openPath(destination); }
    catch { throw new Error(`取用副本已生成，但无法打开文件管理器。库内位置：${destination}`); }
    return destination;
  }
  const archive = Object.fromEntries(Object.entries(files).map(([path, text]) => [`${group}/${path}`, strToU8(text)]));
  const bytes = zipSync(archive);
  assertCurrent();
  const outcome = await savePackBytes(bytes, `${safeName(presetName(item))}-取用包.zip`, { label: '预设取用包', extension: 'zip' });
  return outcome === 'cancelled' ? null : '预设取用包已导出';
}
