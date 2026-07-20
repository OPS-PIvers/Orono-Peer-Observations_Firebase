import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { UnsavedChangesGuardContext, useUnsavedChangesGuard } from './useUnsavedChangesGuard';

describe('useUnsavedChangesGuard', () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when isDirty is false', () => {
    renderHook(() => useUnsavedChangesGuard(false));
    expect(addEventListenerSpy).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });

  it('installs a beforeunload handler when isDirty is true', () => {
    renderHook(() => useUnsavedChangesGuard(true));
    expect(addEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });

  it('removes the beforeunload handler when isDirty becomes false', () => {
    const { rerender } = renderHook(
      ({ isDirty }: { isDirty: boolean }) => useUnsavedChangesGuard(isDirty),
      { initialProps: { isDirty: false } },
    );

    expect(addEventListenerSpy).not.toHaveBeenCalled();

    rerender({ isDirty: true });
    expect(addEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    const handlerCall = addEventListenerSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'beforeunload',
    );
    const handler = handlerCall?.[1] as EventListener;

    rerender({ isDirty: false });
    expect(removeEventListenerSpy).toHaveBeenCalledWith('beforeunload', handler);
  });

  it('registers and unregisters a guard with context', () => {
    const registerGuard = vi.fn();
    const unregisterGuard = vi.fn();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <UnsavedChangesGuardContext.Provider
        value={{ isGuarded: false, registerGuard, unregisterGuard }}
      >
        {children}
      </UnsavedChangesGuardContext.Provider>
    );

    const { unmount, rerender } = renderHook(
      ({ isDirty }: { isDirty: boolean }) => useUnsavedChangesGuard(isDirty),
      { wrapper, initialProps: { isDirty: false } },
    );

    expect(registerGuard).not.toHaveBeenCalled();

    rerender({ isDirty: true });
    expect(registerGuard).toHaveBeenCalledWith(expect.any(Object));

    const guard = registerGuard.mock.calls[0]?.[0];

    rerender({ isDirty: false });
    expect(unregisterGuard).toHaveBeenCalledWith(guard);

    unmount();
  });

  it('cleans up on unmount', () => {
    const registerGuard = vi.fn();
    const unregisterGuard = vi.fn();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <UnsavedChangesGuardContext.Provider
        value={{ isGuarded: false, registerGuard, unregisterGuard }}
      >
        {children}
      </UnsavedChangesGuardContext.Provider>
    );

    const { unmount, rerender } = renderHook(
      ({ isDirty }: { isDirty: boolean }) => useUnsavedChangesGuard(isDirty),
      { wrapper, initialProps: { isDirty: false } },
    );

    rerender({ isDirty: true });
    const guard = registerGuard.mock.calls[0]?.[0];

    unmount();
    expect(unregisterGuard).toHaveBeenCalledWith(guard);
    expect(removeEventListenerSpy).toHaveBeenCalled();
  });
});
