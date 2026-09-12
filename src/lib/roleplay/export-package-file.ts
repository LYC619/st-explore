import type { StoryPackageExport } from './story-package';

/** Export through each shell's existing file/share surface, with truthful cancellation. */
export async function saveStoryPackageFile(output: Pick<StoryPackageExport, 'fileName' | 'text'>): Promise<'saved' | 'downloaded' | 'shared' | 'cancelled'> {
  if ('__TAURI_INTERNALS__' in window) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: output.fileName, filters: [{ name: 'STE 完整故事包', extensions: ['ste-play'] }] });
    if (!path) return 'cancelled';
    const { writeAbsText } = await import('@/lib/vault/tauri-fs');
    await writeAbsText(path, output.text); return 'saved';
  }
  const { Capacitor } = await import('@capacitor/core');
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const path = 'ste-story-export/' + output.fileName;
    const file = await Filesystem.writeFile({ path, directory: Directory.Cache, data: output.text, encoding: Encoding.UTF8, recursive: true });
    try { await Share.share({ title: '完整故事包', url: file.uri, dialogTitle: '保存或分享故事包' }); return 'shared'; }
    catch (error) { if (/cancel/i.test(String(error))) return 'cancelled'; throw error; }
  }
  const url = URL.createObjectURL(new Blob([output.text], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = output.fileName;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
