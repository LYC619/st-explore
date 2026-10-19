import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext, useSearchParams } from 'react-router-dom';

export interface AssetIdentity {
  assetId: string | null;
  characterId: string | null;
}

function readAssetIdentity(params: URLSearchParams): AssetIdentity {
  return { assetId: params.get('assetId'), characterId: params.get('characterId') };
}

function sameAssetIdentity(a: AssetIdentity, b: AssetIdentity): boolean {
  return a.assetId === b.assetId && a.characterId === b.characterId;
}

interface PendingTarget<T> {
  sequence: number;
  identity: AssetIdentity;
  data: T;
}

interface LoadContext {
  initial: boolean;
  isCurrent: () => boolean;
}

interface Options<T> {
  isDirty: boolean;
  load: (identity: AssetIdentity, context: LoadContext) => Promise<T>;
  accept: (data: T, identity: AssetIdentity) => void;
  onError: (error: unknown) => void;
}

/** Only accepted targets own the draft. Query changes invalidate both reads and save UI. */
export function useAssetIdentityNavigation<T>(options: Options<T>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const dataRouter = useContext(UNSAFE_DataRouterContext)?.router;
  const deferredQuery = useRef<(() => void) | null>(null);
  useEffect(() => () => { deferredQuery.current?.(); }, []);
  const { assetId, characterId } = readAssetIdentity(searchParams);
  const requestedIdentity = useRef({ assetId, characterId });
  requestedIdentity.current = { assetId, characterId };
  const requestSeq = useRef(0);
  const acceptedIdentity = useRef<AssetIdentity | null>(null);
  const pendingRef = useRef<PendingTarget<T> | null>(null);
  const [pendingTarget, setPendingTarget] = useState<PendingTarget<T> | null>(null);
  const latest = useRef({ ...options, setSearchParams });
  latest.current = { ...options, setSearchParams };

  const clearPending = useCallback(() => {
    pendingRef.current = null;
    setPendingTarget(null);
  }, []);

  const invalidate = useCallback(() => { ++requestSeq.current; }, []);

  const writeIdentity = useCallback((identity: AssetIdentity) => {
    deferredQuery.current?.();
    deferredQuery.current = null;
    const write = () => latest.current.setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const key of ['assetId', 'characterId'] as const) {
        const value = identity[key];
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      return next;
    }, { replace: true });
    // A save can create a COW identity while Back is waiting for that save.
    // Replacing the query then would replace the pending navigation itself.
    const blocked = () => dataRouter && [...dataRouter.state.blockers.values()].some(value => value.state !== 'unblocked');
    if (dataRouter && blocked()) {
      const locationKey = dataRouter.state.location.key;
      deferredQuery.current = dataRouter.subscribe(() => {
        if (blocked()) return;
        deferredQuery.current?.();
        deferredQuery.current = null;
        // If navigation succeeded, the next page owns the address. If saving
        // failed, publish the successfully saved identity in the same editor.
        if (dataRouter.state.location.key === locationKey) queueMicrotask(write);
      });
    } else write();
  }, [dataRouter]);

  const restoreAcceptedIdentityQuery = useCallback(() => {
    if (acceptedIdentity.current) writeIdentity(acceptedIdentity.current);
  }, [writeIdentity]);

  const acceptTarget = useCallback((target: PendingTarget<T>) => {
    if (target.sequence !== requestSeq.current) return;
    acceptedIdentity.current = target.identity;
    // Radix calls onOpenChange(false) after the action's onClick.
    clearPending();
    latest.current.accept(target.data, target.identity);
  }, [clearPending]);

  const confirmPending = useCallback(() => {
    if (pendingRef.current) acceptTarget(pendingRef.current);
  }, [acceptTarget]);

  const cancelPending = useCallback(() => {
    if (!pendingRef.current) return;
    ++requestSeq.current;
    clearPending();
    restoreAcceptedIdentityQuery();
  }, [clearPending, restoreAcceptedIdentityQuery]);

  const captureCurrent = useCallback(() => {
    const sequence = requestSeq.current;
    const owner = acceptedIdentity.current;
    // A save may start while B is pending. Accepting B also invalidates that save's UI.
    return () => sequence === requestSeq.current && owner === acceptedIdentity.current;
  }, []);

  const ownsLocation = useCallback(() => !!acceptedIdentity.current && sameAssetIdentity(requestedIdentity.current, acceptedIdentity.current), []);

  const requestAsset = useCallback((id: string) => {
    writeIdentity({ assetId: id, characterId: acceptedIdentity.current?.characterId ?? null });
  }, [writeIdentity]);

  const acceptLocalAsset = useCallback((id: string, apply: () => void) => {
    ++requestSeq.current;
    clearPending();
    const identity = { assetId: id, characterId: acceptedIdentity.current?.characterId ?? null };
    acceptedIdentity.current = identity;
    apply();
    writeIdentity(identity);
  }, [clearPending, writeIdentity]);

  useEffect(() => {
    const sequence = ++requestSeq.current;
    const identity = { assetId, characterId };
    const isCurrent = () => sequence === requestSeq.current;
    clearPending();
    if (!acceptedIdentity.current || !sameAssetIdentity(identity, acceptedIdentity.current)) {
      void latest.current.load(identity, { initial: acceptedIdentity.current === null, isCurrent })
        .then((data) => {
          if (!isCurrent()) return;
          const target = { sequence, identity, data };
          if (latest.current.isDirty) {
            pendingRef.current = target;
            setPendingTarget(target);
          } else acceptTarget(target);
        })
        .catch((error: unknown) => {
          if (!isCurrent()) return;
          latest.current.onError(error);
          restoreAcceptedIdentityQuery();
        });
    }
    return invalidate;
  }, [assetId, characterId, acceptTarget, clearPending, restoreAcceptedIdentityQuery, invalidate]);

  return { pendingTarget, confirmPending, cancelPending, captureCurrent, requestAsset, acceptLocalAsset, ownsLocation };
}
