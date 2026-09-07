import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { STImportSummary, STScanResult } from '@/lib/vault/st-import';

const mocks = vi.hoisted(() => ({
  createTauriFs: vi.fn(),
  importSelected: vi.fn(),
  pickDirectory: vi.fn(),
  pickSTBackupImport: vi.fn(),
  cleanupSTBackupImport: vi.fn(),
  scanSTUserDir: vi.fn(),
  setAppConfig: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/vault/tauri-fs', () => ({
  createTauriFs: mocks.createTauriFs,
  isTauri: () => true,
  pickDirectory: mocks.pickDirectory,
  pickSTBackupImport: mocks.pickSTBackupImport,
  cleanupSTBackupImport: mocks.cleanupSTBackupImport,
  setAppConfig: mocks.setAppConfig,
}));

vi.mock('@/lib/vault/st-import', () => ({
  importSelected: mocks.importSelected,
  scanSTUserDir: mocks.scanSTUserDir,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/components/tools/st-import/STImportSelectionDialog', () => ({
  STImportSelectionDialog: ({ onImport, onCancel }: { onImport: () => void; onCancel: () => void }) => (
    <div data-testid="st-import-selection">
      <button type="button" onClick={onCancel}>取消导入</button>
      <button type="button" onClick={onImport}>确认导入</button>
    </div>
  ),
}));

vi.mock('@/components/tools/st-import/STImportResultDialog', () => ({
  STImportResultDialog: ({ result, onClose }: { result: STImportSummary | null; onClose: () => void }) => result
    ? (
      <div data-testid="st-import-result">
        <span>{result.characters} 个角色已处理</span>
        <button type="button" onClick={onClose}>关闭结果</button>
      </div>
    )
    : null,
}));

import { STImportCard } from '@/components/tools/STImportCard';
import { VAULT_CHANGED_EVENT } from '@/lib/vault/vault-registry-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scan: STScanResult = {
  userDir: '',
  characters: [{
    name: '演示角色',
    pngPath: 'characters/demo.png',
    pngSize: 1,
    chats: [],
    chatBytes: 0,
  }],
  strayChats: [],
  worldbooks: [],
  presets: [],
  regex: null,
  archives: [],
  relationships: { status: 'missing', globalWorldbooks: [], characterWorldbooks: [] },
  warnings: [],
};

const summary: STImportSummary = {
  characters: 1,
  stories: 0,
  worldbooks: 0,
  presets: 0,
  regexes: 0,
  skipped: 0,
  failed: 0,
  relationships: 0,
  unresolvedRelationships: [],
  archivedFiles: 0,
  archiveBytes: 0,
  details: [],
  scanWarnings: [],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.pickDirectory.mockResolvedValue('D:/SillyTavern');
  mocks.pickSTBackupImport.mockResolvedValue({ root: 'C:/Temp/ste-st-import-1', displayName: 'backup.zip', skippedSecrets: 0 });
  mocks.cleanupSTBackupImport.mockResolvedValue(undefined);
  mocks.createTauriFs.mockReturnValue({});
  mocks.scanSTUserDir.mockResolvedValue(scan);
  mocks.setAppConfig.mockResolvedValue(undefined);
  mocks.importSelected.mockResolvedValue(summary);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('STImportCard lifecycle', () => {
  it('reports native cleanup failure even after the preparation owner unmounts', async () => {
    let fail!: (error: string) => void;
    mocks.pickSTBackupImport.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    await act(async () => root.render(<STImportCard />));
    await act(async () => container.querySelectorAll<HTMLButtonElement>('button')[1].click());
    await act(async () => root.render(null));
    await act(async () => fail('STE_ST_IMPORT_CLEANUP_FAILED: synthetic temp is locked'));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: '清理临时导入文件失败', description: expect.stringContaining('synthetic temp is locked'),
    }));
  });

  it('reports cleanup failure after vault invalidation so leftover files are visible', async () => {
    mocks.cleanupSTBackupImport.mockRejectedValueOnce(new Error('synthetic temp is locked'));
    await act(async () => root.render(<STImportCard />));
    await act(async () => container.querySelectorAll<HTMLButtonElement>('button')[1].click());
    await act(async () => window.dispatchEvent(new Event(VAULT_CHANGED_EVENT)));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: '清理临时导入文件失败', description: expect.stringContaining('synthetic temp is locked'),
    }));
  });

  it('aborts on unmount and cleans a preparation result that arrives afterwards', async () => {
    let complete!: (value: { root: string; displayName: string; skippedSecrets: number }) => void;
    mocks.pickSTBackupImport.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await act(async () => root.render(<STImportCard />));
    await act(async () => container.querySelectorAll<HTMLButtonElement>('button')[1].click());
    const controls = mocks.pickSTBackupImport.mock.calls[0][0];
    await act(async () => root.render(null));
    expect(controls.signal.aborted).toBe(true);
    await act(async () => complete({ root: 'C:/Temp/late-backup', displayName: 'late.zip', skippedSecrets: 0 }));
    expect(mocks.scanSTUserDir).not.toHaveBeenCalled();
    expect(mocks.cleanupSTBackupImport).toHaveBeenCalledWith('C:/Temp/late-backup');
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('ignores a stale scan and its finally after a vault change and immediate retry', async () => {
    let complete!: (value: STScanResult) => void;
    mocks.scanSTUserDir.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await act(async () => root.render(<STImportCard />));
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    const controls = mocks.scanSTUserDir.mock.calls[0][1];
    await act(async () => window.dispatchEvent(new Event(VAULT_CHANGED_EVENT)));
    expect(controls.signal.aborted).toBe(true);
    mocks.pickDirectory.mockResolvedValueOnce('D:/SecondST');
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    await act(async () => complete(scan));
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="st-import-selection"] button:last-child')!.click());
    expect(mocks.importSelected.mock.calls[0][1].stRoot).toBe('D:/SecondST');
    expect(mocks.setAppConfig).toHaveBeenCalledTimes(1);
  });

  it('cancels an active import on unmount and releases its source only after it settles', async () => {
    let complete!: (value: STImportSummary) => void;
    mocks.importSelected.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await act(async () => root.render(<STImportCard />));
    await act(async () => container.querySelectorAll<HTMLButtonElement>('button')[1].click());
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="st-import-selection"] button:last-child')!.click());
    const controls = mocks.importSelected.mock.calls[0][2];
    await act(async () => root.render(null));
    expect(controls.signal.aborted).toBe(true);
    expect(mocks.cleanupSTBackupImport).not.toHaveBeenCalled();
    await act(async () => complete({ ...summary, aborted: true }));
    expect(mocks.cleanupSTBackupImport).toHaveBeenCalledOnce();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('keeps the selection dialog mounted until the user finishes importing', async () => {
    const onChanged = vi.fn();
    await act(async () => {
      root.render(<STImportCard onChanged={onChanged} />);
    });

    const scanButton = container.querySelector<HTMLButtonElement>('button');
    expect(scanButton).not.toBeNull();
    await act(async () => {
      scanButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.setAppConfig).toHaveBeenCalledWith('stRoot', 'D:/SillyTavern');
    expect(document.querySelector('[data-testid="st-import-selection"]')).not.toBeNull();
    expect(onChanged).not.toHaveBeenCalled();

    const importButton = document.querySelector<HTMLButtonElement>('[data-testid="st-import-selection"] button:last-child');
    await act(async () => {
      importButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.importSelected).toHaveBeenCalledTimes(1);
    expect(onChanged).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="st-import-result"]')?.textContent)
      .toContain('1 个角色已处理');

    const closeResultButton = document.querySelector<HTMLButtonElement>('[data-testid="st-import-result"] button');
    await act(async () => {
      closeResultButton?.click();
      await Promise.resolve();
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('imports a backup through the temporary root without persisting stRoot, then cleans it up', async () => {
    await act(async () => {
      root.render(<STImportCard />);
    });

    const buttons = container.querySelectorAll<HTMLButtonElement>('button');
    await act(async () => {
      buttons[1]?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.createTauriFs).toHaveBeenCalledWith('C:/Temp/ste-st-import-1');
    expect(mocks.setAppConfig).not.toHaveBeenCalledWith('stRoot', expect.anything());
    expect(document.querySelector('[data-testid="st-import-selection"]')).not.toBeNull();

    const importButton = document.querySelector<HTMLButtonElement>('[data-testid="st-import-selection"] button:last-child');
    await act(async () => {
      importButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 第三个参数是进度/取消 controls（onProgress + signal），这里只关心计划本身走对了
    expect(mocks.importSelected).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stRoot: 'C:/Temp/ste-st-import-1',
        sourceLabel: 'backup.zip',
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.cleanupSTBackupImport).toHaveBeenCalledWith('C:/Temp/ste-st-import-1');
  });

  it('cleans up a backup when the selection is cancelled or scanning fails', async () => {
    await act(async () => {
      root.render(<STImportCard />);
    });
    let buttons = container.querySelectorAll<HTMLButtonElement>('button');
    await act(async () => {
      buttons[1]?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const cancelButton = document.querySelector<HTMLButtonElement>('[data-testid="st-import-selection"] button:first-child');
    await act(async () => {
      cancelButton?.click();
      await Promise.resolve();
    });
    expect(mocks.cleanupSTBackupImport).toHaveBeenCalledWith('C:/Temp/ste-st-import-1');

    mocks.cleanupSTBackupImport.mockClear();
    mocks.scanSTUserDir.mockRejectedValueOnce(new Error('坏包'));
    buttons = container.querySelectorAll<HTMLButtonElement>('button');
    await act(async () => {
      buttons[1]?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.cleanupSTBackupImport).toHaveBeenCalledWith('C:/Temp/ste-st-import-1');
  });
});
