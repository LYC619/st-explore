import { useEffect } from 'react';
import { isCapacitor } from '@/lib/runtime';
import { useAndroidBackButton } from '@/hooks/use-android-back';
/** Independent play routes sit outside AppLayout, so they own the Android back/background listeners. */
export function usePlayLifecycle(suspend: () => void) {
  useAndroidBackButton();
  useEffect(() => {
    if (!isCapacitor()) return; let disposed = false, remove: (() => Promise<void>) | undefined;
    void import('@capacitor/app').then(async ({ App }) => {
      if (disposed) return;
      const listener = await App.addListener('appStateChange', ({ isActive }) => { if (!isActive) suspend(); });
      if (disposed) await listener.remove(); else remove = () => listener.remove();
    });
    return () => { disposed = true; void remove?.(); };
  }, [suspend]);
}
