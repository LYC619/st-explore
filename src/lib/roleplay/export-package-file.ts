import type { StoryPackageExport } from './story-package';

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
  const url = URL.createObjectURL(new Blob([output.text], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = output.fileName;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
