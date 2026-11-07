import { useEffect } from "react";
import { useToast, clearToastsForModal } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";

export function Toaster() {
  const { toasts } = useToast();
  useEffect(() => {
    let visibleDialogs = new Set<Element>();
    const clear = () => {
      const next = new Set(document.querySelectorAll('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'));
      if ([...next].some(dialog => !visibleDialogs.has(dialog))) clearToastsForModal();
      visibleDialogs = next;
    };
    const observer = new MutationObserver(clear);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state', 'role'] });
    clear();
    return () => observer.disconnect();
  }, []);

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport className="z-[49]" />
    </ToastProvider>
  );
}
