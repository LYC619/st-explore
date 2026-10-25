import { useContext, useEffect } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

export function PresetDiscardDialog({ open, cancel, discard }: { open: boolean; cancel: () => void; discard: () => void }) {
  return <AlertDialog open={open} onOpenChange={open => { if (!open) cancel(); }}>
    <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
      <AlertDialogDescription>返回继续整理可保留当前输入；放弃后将载入已保存的内容。</AlertDialogDescription>
    </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>返回继续整理</AlertDialogCancel>
      <AlertDialogAction onClick={discard}>放弃修改</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
  </AlertDialog>;
}

function RouteBoundary({ dirty }: { dirty: boolean }) {
  // Same editor identity transitions already have their own pending-target guard.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && (currentLocation.pathname !== nextLocation.pathname || !['/preset', '/presets'].includes(currentLocation.pathname)));
  return <PresetDiscardDialog open={blocker.state === 'blocked'} cancel={() => blocker.state === 'blocked' && blocker.reset()} discard={() => blocker.state === 'blocked' && blocker.proceed()} />;
}

export function PresetDraftBoundary({ dirty }: { dirty: boolean }) {
  const router = useContext(UNSAFE_DataRouterContext);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  return router ? <RouteBoundary dirty={dirty} /> : null;
}
