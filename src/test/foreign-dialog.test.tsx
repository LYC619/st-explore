import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogCancel } from '@/components/ui/alert-dialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, frame: HTMLIFrameElement;
beforeEach(() => {
  host = document.createElement('div'); frame = document.createElement('iframe');
  document.body.append(host, frame); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); frame.remove(); });

it.each(['dialog', 'sheet', 'alert'] as const)('%s confines its modal effects and dismissal to the child document', async kind => {
  const child = frame.contentDocument!;
  const RootComponent = kind === 'dialog' ? Dialog : kind === 'sheet' ? Sheet : AlertDialog;
  const Content = kind === 'dialog' ? DialogContent : kind === 'sheet' ? SheetContent : AlertDialogContent;
  const Title = kind === 'dialog' ? DialogTitle : kind === 'sheet' ? SheetTitle : AlertDialogTitle;
  function Harness() {
    const [open, setOpen] = useState(true);
    return <><button onClick={() => setOpen(true)}>Open</button><RootComponent open={open} onOpenChange={setOpen}>
      <Content container={child.body}><Title>Synthetic modal</Title>
        {kind === 'alert' ? <AlertDialogCancel>Cancel</AlertDialogCancel> : <button>Inside</button>}
      </Content>
    </RootComponent></>;
  }
  await act(async () => root.render(<Harness />));
  expect(child.querySelector('[aria-modal="true"]')).toBeTruthy();
  expect(document.body.style.overflow).not.toBe('hidden');
  expect(document.body).not.toHaveAttribute('data-scroll-locked');
  expect(document.body.style.pointerEvents).not.toBe('none');
  expect(child.body.style.overflow).toBe('hidden');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(child.querySelector('[aria-modal="true"]')).toBeTruthy();
  await act(async () => child.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(child.querySelector('[aria-modal="true"]')).toBeNull();
  expect(child.body.style.overflow).toBe('');
  await act(async () => host.querySelector('button')!.click());
  await act(async () => child.querySelector('[data-foreign-dialog-overlay]')!.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true })));
  expect(child.querySelector('[aria-modal="true"]')).toBeNull();
  if (kind === 'alert') {
    await act(async () => host.querySelector('button')!.click());
    await act(async () => child.querySelector<HTMLButtonElement>('button')!.click());
    expect(child.querySelector('[aria-modal="true"]')).toBeNull();
  }
});
