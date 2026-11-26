import { useMemo, useSyncExternalStore, type DependencyList } from 'react';
import { getLocale, subscribeLocale } from './index';

/** Subscribe without replacing the editor tree or discarding unsaved state. */
export function useI18n() {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/** Display computations may read translated getters indirectly. Invalidate them on locale changes. */
export function useLocalizedMemo<T>(factory: () => T, dependencies: DependencyList): T {
  const locale = useI18n();
  // Callers supply their data dependencies; locale is an additional display dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(factory, [locale, ...dependencies]);
}
