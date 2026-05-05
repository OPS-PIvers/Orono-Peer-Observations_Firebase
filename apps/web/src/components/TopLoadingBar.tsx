import { useEffect, useState } from 'react';

/**
 * Indeterminate progress bar used as the Suspense fallback inside the
 * persistent app shell. It only paints after `delay` ms so that brief
 * lazy-chunk loads (which RR v7 wraps in `startTransition`, leaving the
 * previous page on screen) don't cause any visible flicker at all.
 *
 * The bar is positioned `absolute` and expects a `relative` ancestor
 * (Layout's `<main>`).
 */
export function TopLoadingBar({ delay = 150 }: { delay?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden"
    >
      <div className="bg-ops-blue h-full w-1/3 animate-[ops-topbar_1.1s_ease-in-out_infinite]" />
    </div>
  );
}
