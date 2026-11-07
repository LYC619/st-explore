import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useGridColumns } from '@/hooks/use-grid-columns';

it('measures a grid mounted after loading and reconnects after switching views', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const measure = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  const observe = vi.fn(), disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe = observe; disconnect = disconnect; });
  function Grid({ ready }: { ready: boolean }) {
    const { ref, cols } = useGridColumns(240);
    return <><output>{cols}</output>{ready && <div ref={ref} />}</>;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    act(() => root.render(<Grid ready={false} />));
    act(() => root.render(<Grid ready />));
    expect(container.querySelector('output')!.textContent).toBe('3');
    expect(observe).toHaveBeenCalledTimes(1);
    act(() => root.render(<Grid ready={false} />)); expect(disconnect).toHaveBeenCalledOnce();
    act(() => root.render(<Grid ready />)); expect(observe).toHaveBeenCalledTimes(2);
  } finally { act(() => root.unmount()); measure.mockRestore(); vi.unstubAllGlobals(); }
});
