import { useEffect, useState } from 'react';

/**
 * Tracks browser-reported connectivity via `navigator.onLine` plus the
 * `online`/`offline` window events.
 *
 * `navigator.onLine` only reflects "the OS reports a network interface with
 * a link" — not "can actually reach Firestore" — so it won't catch every
 * failure mode (e.g. a captive portal or a flaky proxy that's technically
 * "online"). But it's a cheap, reliable signal for the common cases this is
 * meant to cover: Wi-Fi dropping, airplane mode, a laptop lid closing and
 * reopening away from a known network. Real request failures while
 * `navigator.onLine` is still true continue to surface as ordinary save
 * errors.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
