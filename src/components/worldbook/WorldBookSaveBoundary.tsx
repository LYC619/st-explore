import { useContext, useEffect, useRef } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom';

interface Props { dirty: boolean; saving: boolean; flush: () => Promise<void>; currentId: string | null; onError: (error: unknown) => void }
function DataBoundary({ dirty, saving, flush, currentId, onError }: Props) {
  const latest = useRef({ flush, onError }); latest.current = { flush, onError };
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    // COW updates its own pointer after saving without leaving the editing session.
    if (currentLocation.pathname === nextLocation.pathname
      && new URLSearchParams(nextLocation.search).get('assetId') === currentId
      && new URLSearchParams(nextLocation.search).get('characterId') === new URLSearchParams(currentLocation.search).get('characterId')) return false;
    return dirty || saving;
  });
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let active = true;
    void latest.current.flush().then(() => { if (active) blocker.proceed(); }).catch(error => {
      if (active) { blocker.reset(); latest.current.onError(error); }
    });
    return () => { active = false; };
  }, [blocker]);
  return null;
}

/** The application uses a data router; standalone editor harnesses may use MemoryRouter. */
export function WorldBookSaveBoundary(props: Props) {
  const router = useContext(UNSAFE_DataRouterContext);
  return router ? <DataBoundary {...props} /> : null;
}
