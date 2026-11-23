import * as React from 'react';
import { createPortal } from 'react-dom';
import { ForeignDialogContext, PortalDialogContext } from './foreign-dialog-context';

type Props = React.HTMLAttributes<HTMLDivElement> & {
  container: HTMLElement;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

// Radix's modal effects use its JS realm's global document. A foreign portal
// needs document-local focus, dismissal and scroll ownership instead.
export const ForeignDialogContent = React.forwardRef<HTMLDivElement, Props>(function ForeignDialogContent(
  { container, children, onEscapeKeyDown, onOpenAutoFocus, onCloseAutoFocus, ...props }, forwardedRef,
) {
  const state = React.useContext(PortalDialogContext);
  const content = React.useRef<HTMLDivElement | null>(null);
  const latest = React.useRef({ state, onEscapeKeyDown, onOpenAutoFocus, onCloseAutoFocus });
  latest.current = { state, onEscapeKeyDown, onOpenAutoFocus, onCloseAutoFocus };
  const setRef = React.useCallback((node: HTMLDivElement | null) => {
    content.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  React.useLayoutEffect(() => {
    const node = content.current;
    if (!state.open || !node) return;
    const doc = container.ownerDocument;
    const previous = doc.activeElement as HTMLElement | null;
    const previousOverflow = doc.body.style.overflow;
    doc.body.style.overflow = 'hidden';
    const focusable = () => [...node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]')]
      .filter(el => el.tabIndex >= 0 && !el.hasAttribute('disabled') && !el.closest('[hidden], [inert]'));
    if (!node.hasAttribute('aria-labelledby') && !node.hasAttribute('aria-label')) {
      const title = node.querySelector('h2[id]');
      if (title) node.setAttribute('aria-labelledby', title.id);
    }
    if (!node.hasAttribute('aria-describedby')) {
      const description = node.querySelector('p[id]');
      if (description) node.setAttribute('aria-describedby', description.id);
    }
    const focus = () => (focusable()[0] ?? node).focus();
    const autoFocus = new Event('openAutoFocus', { cancelable: true });
    latest.current.onOpenAutoFocus?.(autoFocus);
    if (!autoFocus.defaultPrevented) focus();
    const onFocus = (event: FocusEvent) => {
      if (event.target && !node.contains(event.target as Node)) focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        latest.current.onEscapeKeyDown?.(event);
        if (!event.defaultPrevented) { event.preventDefault(); latest.current.state.onOpenChange(false); }
      } else if (event.key === 'Tab') {
        const items = focusable();
        const index = items.indexOf(doc.activeElement as HTMLElement);
        if (!items.length || (event.shiftKey ? index <= 0 : index === items.length - 1 || index < 0)) {
          event.preventDefault();
          (items[event.shiftKey ? items.length - 1 : 0] ?? node).focus();
        }
      }
    };
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('focusin', onFocus);
    return () => {
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('focusin', onFocus);
      doc.body.style.overflow = previousOverflow;
      const autoFocus = new Event('closeAutoFocus', { cancelable: true });
      latest.current.onCloseAutoFocus?.(autoFocus);
      if (!autoFocus.defaultPrevented && previous?.isConnected) previous.focus();
    };
  }, [state.open, container]);

  if (!state.open) return null;
  return createPortal(<ForeignDialogContext.Provider value={true}>
    <div data-foreign-dialog-overlay="" data-state="open" className="fixed inset-0 z-50 bg-black/80"
      onPointerDown={event => { if (event.target === event.currentTarget && event.button === 0) state.onOpenChange(false); }} />
    <div role="dialog" aria-modal="true" tabIndex={-1} data-state="open" {...props} ref={setRef}>{children}</div>
  </ForeignDialogContext.Provider>, container);
});
