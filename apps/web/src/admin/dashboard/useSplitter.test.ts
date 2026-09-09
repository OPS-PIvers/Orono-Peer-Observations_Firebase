import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SPLITTER_DEFAULT,
  SPLITTER_MAX,
  SPLITTER_MIN,
  SPLITTER_STORAGE_KEY,
  clampFraction,
  useSplitter,
} from './useSplitter';

describe('clampFraction', () => {
  it('clamps into the allowed band and rejects NaN', () => {
    expect(clampFraction(0)).toBe(SPLITTER_MIN);
    expect(clampFraction(1)).toBe(SPLITTER_MAX);
    expect(clampFraction(0.5)).toBe(0.5);
    expect(clampFraction(Number.NaN)).toBe(SPLITTER_DEFAULT);
  });
});

describe('useSplitter', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts at the 60/40 default and persists it', () => {
    const { result } = renderHook(() => useSplitter());
    expect(result.current.fraction).toBe(SPLITTER_DEFAULT);
    expect(localStorage.getItem(SPLITTER_STORAGE_KEY)).toBe(String(SPLITTER_DEFAULT));
  });

  it('restores a stored fraction, clamped', () => {
    localStorage.setItem(SPLITTER_STORAGE_KEY, '0.95');
    const { result } = renderHook(() => useSplitter());
    expect(result.current.fraction).toBe(SPLITTER_MAX);
  });

  it('ignores garbage in storage', () => {
    localStorage.setItem(SPLITTER_STORAGE_KEY, 'wat');
    const { result } = renderHook(() => useSplitter());
    expect(result.current.fraction).toBe(SPLITTER_DEFAULT);
  });

  it('nudges with arrow keys, snaps with Home/End, resets on double-click', () => {
    const { result } = renderHook(() => useSplitter());
    const key = (k: string) =>
      act(() =>
        result.current.handleProps.onKeyDown({
          key: k,
          preventDefault: () => undefined,
        } as unknown as React.KeyboardEvent<HTMLElement>),
      );
    key('ArrowLeft');
    expect(result.current.fraction).toBeCloseTo(SPLITTER_DEFAULT - 0.05);
    key('End');
    expect(result.current.fraction).toBe(SPLITTER_MAX);
    key('Home');
    expect(result.current.fraction).toBe(SPLITTER_MIN);
    act(() => result.current.handleProps.onDoubleClick());
    expect(result.current.fraction).toBe(SPLITTER_DEFAULT);
    expect(localStorage.getItem(SPLITTER_STORAGE_KEY)).toBe(String(SPLITTER_DEFAULT));
  });

  it('exposes separator aria values as percentages', () => {
    const { result } = renderHook(() => useSplitter());
    expect(result.current.handleProps.role).toBe('separator');
    expect(result.current.handleProps['aria-valuenow']).toBe(60);
    expect(result.current.handleProps['aria-valuemin']).toBe(35);
    expect(result.current.handleProps['aria-valuemax']).toBe(75);
  });
});
