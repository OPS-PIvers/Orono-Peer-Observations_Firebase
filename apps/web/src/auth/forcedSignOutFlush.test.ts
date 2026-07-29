/**
 * PLAT-09 × the observation editor: the forced-sign-out flush registry.
 *
 * The contract these tests pin down is deliberately lopsided — pending work
 * gets a real chance to land, but nothing a callback does can stop the caller
 * from going on to sign the user out. A flush that rejects, or one that never
 * settles at all, must not keep an expired session alive.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FORCED_SIGN_OUT_FLUSH_TIMEOUT_MS,
  registerForcedSignOutFlush,
  runForcedSignOutFlush,
} from './forcedSignOutFlush';

const unregisterAll: (() => void)[] = [];

function register(callback: () => void | Promise<void>) {
  const unregister = registerForcedSignOutFlush(callback);
  unregisterAll.push(unregister);
  return unregister;
}

afterEach(() => {
  while (unregisterAll.length > 0) {
    unregisterAll.pop()?.();
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('runForcedSignOutFlush', () => {
  it('awaits every registered flush before resolving', async () => {
    const order: string[] = [];
    register(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('slow');
    });
    register(() => {
      order.push('sync');
    });

    await runForcedSignOutFlush();

    expect(order).toEqual(['sync', 'slow']);
  });

  it('resolves anyway when a flush rejects, so sign-out still happens', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    register(() => Promise.reject(new Error('permission-denied')));
    const done = vi.fn();

    register(done);
    await expect(runForcedSignOutFlush()).resolves.toBeUndefined();

    expect(done).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it('gives up after the timeout so a hung flush cannot block sign-out', async () => {
    vi.useFakeTimers();
    register(() => new Promise<void>(() => undefined)); // never settles

    const settled = vi.fn();
    const run = runForcedSignOutFlush(50).then(settled);

    await vi.advanceTimersByTimeAsync(49);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('no longer runs a callback once it has been unregistered', async () => {
    const callback = vi.fn();
    const unregister = register(callback);

    unregister();
    await runForcedSignOutFlush();

    expect(callback).not.toHaveBeenCalled();
  });

  it('bounds the default wait', () => {
    expect(FORCED_SIGN_OUT_FLUSH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(FORCED_SIGN_OUT_FLUSH_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });
});
