import { createContext, useState } from 'react';

export interface PortalDialogState { open: boolean; onOpenChange: (open: boolean) => void }
export const PortalDialogContext = createContext<PortalDialogState>({ open: false, onOpenChange: () => {} });
export const ForeignDialogContext = createContext(false);

export function usePortalDialogState(props: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [localOpen, setLocalOpen] = useState(props.defaultOpen ?? false);
  return { open: props.open ?? localOpen, onOpenChange: (open: boolean) => {
    if (props.open === undefined) setLocalOpen(open);
    props.onOpenChange?.(open);
  } };
}

export function isForeignContainer(container?: HTMLElement | null): container is HTMLElement {
  return !!container && container.ownerDocument !== document;
}
