import type { StoryPackageExport } from './story-package';

export type FileSaveResult = 'saved' | 'downloaded' | 'shared' | 'cancelled';

/** Binary exports use the same shell surface as text, without granting vault access. */
export async function saveBinaryFile(output: { fileName: string; base64: string; label: string; extension: 'png'; mime: string }): Promise<FileSaveResult> {
  if ('__TAURI_INTERNALS__' in window) {
    const { saveBinaryExport } = await import('@/lib/vault/tauri-fs');
    return await saveBinaryExport({ fileName: output.fileName, extension: output.extension, base64: output.base64 }) ? 'saved' : 'cancelled';
  }
  const { Capacitor } = await import('@capacitor/core');
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const file = await Filesystem.writeFile({ path: 'ste-story-export/' + output.fileName, directory: Directory.Cache, data: output.base64, recursive: true });
    try { await Share.share({ title: output.label, url: file.uri, dialogTitle: '保存或分享' + output.label }); return 'shared'; }
    catch (error) { if (/cancel/i.test(String(error))) return 'cancelled'; throw error; }
  }
  const bytes = Uint8Array.from(atob(output.base64), ch => ch.charCodeAt(0));
  downloadBlob(new Blob([bytes], { type: output.mime }), output.fileName);
  return 'downloaded';
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName;
  try { document.body.append(anchor); anchor.click(); }
  finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

/** Export through each shell's existing file/share surface, with truthful cancellation. */
export async function saveStoryPackageFile(output: Pick<StoryPackageExport, 'fileName' | 'text'>): Promise<'saved' | 'downloaded' | 'shared' | 'cancelled'> {
  return saveTextFile({ ...output, label: 'STE 完整故事包', extension: 'ste-play' });
}

/** Also used for recovery: the text comes from the live editor, without a repository write. */
export async function saveTextFile(output: { fileName: string; text: string; label: string; extension: string }): Promise<'saved' | 'downloaded' | 'shared' | 'cancelled'> {
  if ('__TAURI_INTERNALS__' in window) {
    const { saveTextExport } = await import('@/lib/vault/tauri-fs');
    const saved = await saveTextExport({ fileName: output.fileName, extension: output.extension, content: output.text });
    return saved ? 'saved' : 'cancelled';
  }
  const { Capacitor } = await import('@capacitor/core');
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const path = 'ste-story-export/' + output.fileName;
    const file = await Filesystem.writeFile({ path, directory: Directory.Cache, data: output.text, encoding: Encoding.UTF8, recursive: true });
    try { await Share.share({ title: output.label, url: file.uri, dialogTitle: '保存或分享' + output.label }); return 'shared'; }
    catch (error) { if (/cancel/i.test(String(error))) return 'cancelled'; throw error; }
  }
  downloadBlob(new Blob([output.text], { type: 'application/json;charset=utf-8' }), output.fileName);
  return 'downloaded';
}
