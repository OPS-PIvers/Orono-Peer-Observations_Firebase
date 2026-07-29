import { describe, expect, it } from 'vitest';
import {
  SESSION_WARNING_WINDOW_MS,
  computeSessionTimeoutStatus,
  formatRemaining,
} from './sessionTimeout';

const HOUR_MS = 60 * 60 * 1000;
const AUTH_TIME_MS = new Date('2026-07-27T08:00:00Z').getTime();
const SESSION_DURATION_MS = 24 * HOUR_MS;

describe('computeSessionTimeoutStatus', () => {
  it('is ok well before the deadline', () => {
    const status = computeSessionTimeoutStatus({
      authTimeMs: AUTH_TIME_MS,
      sessionDurationMs: SESSION_DURATION_MS,
      extendedUntilMs: null,
      nowMs: AUTH_TIME_MS + HOUR_MS,
    });
    expect(status).toEqual({ kind: 'ok' });
  });

  it('warns once inside the warning window before the deadline', () => {
    const deadlineMs = AUTH_TIME_MS + SESSION_DURATION_MS;
    const nowMs = deadlineMs - 4 * 60 * 1000;
    const status = computeSessionTimeoutStatus({
      authTimeMs: AUTH_TIME_MS,
      sessionDurationMs: SESSION_DURATION_MS,
      extendedUntilMs: null,
      nowMs,
    });
    expect(status.kind).toBe('warning');
    if (status.kind === 'warning') {
      expect(status.remainingMs).toBe(4 * 60 * 1000);
    }
  });

  it('is not yet a warning exactly at the edge of the warning window', () => {
    const deadlineMs = AUTH_TIME_MS + SESSION_DURATION_MS;
    const status = computeSessionTimeoutStatus({
      authTimeMs: AUTH_TIME_MS,
      sessionDurationMs: SESSION_DURATION_MS,
      extendedUntilMs: null,
      nowMs: deadlineMs - SESSION_WARNING_WINDOW_MS - 1,
    });
    expect(status).toEqual({ kind: 'ok' });
  });

  it('expires once now reaches the deadline', () => {
    const deadlineMs = AUTH_TIME_MS + SESSION_DURATION_MS;
    const status = computeSessionTimeoutStatus({
      authTimeMs: AUTH_TIME_MS,
      sessionDurationMs: SESSION_DURATION_MS,
      extendedUntilMs: null,
      nowMs: deadlineMs,
    });
    expect(status).toEqual({ kind: 'expired' });
  });

  it('expires once now is past the deadline', () => {
    const deadlineMs = AUTH_TIME_MS + SESSION_DURATION_MS;
    const status = computeSessionTimeoutStatus({
      authTimeMs: AUTH_TIME_MS,
      sessionDurationMs: SESSION_DURATION_MS,
      extendedUntilMs: null,
      nowMs: deadlineMs + 1,
    });
    expect(status).toEqual({ kind: 'expired' });
  });

  it('a "Stay signed in" extension pushes the deadline out even though auth_time is unchanged', () => {
    const originalDeadlineMs = AUTH_TIME_MS + SESSION_DURATION_MS;
    const extendedUntilMs = originalDeadlineMs + HOUR_MS;
    const status = computeSessionTimeoutStatus({
      authTimeMs: AUTH_TIME_MS,
      sessionDurationMs: SESSION_DURATION_MS,
      extendedUntilMs,
      nowMs: originalDeadlineMs + 30 * 1000,
    });
    expect(status).toEqual({ kind: 'ok' });
  });

  it('ignores an extension that is earlier than the auth_time-based deadline', () => {
    const deadlineMs = AUTH_TIME_MS + SESSION_DURATION_MS;
    const status = computeSessionTimeoutStatus({
      authTimeMs: AUTH_TIME_MS,
      sessionDurationMs: SESSION_DURATION_MS,
      extendedUntilMs: AUTH_TIME_MS + HOUR_MS, // long past, earlier than deadline
      nowMs: deadlineMs + 1,
    });
    expect(status).toEqual({ kind: 'expired' });
  });
});

describe('formatRemaining', () => {
  it('rounds up to whole minutes', () => {
    expect(formatRemaining(4 * 60 * 1000 + 1)).toBe('5 minutes');
    expect(formatRemaining(4 * 60 * 1000)).toBe('4 minutes');
  });

  it('collapses anything under a minute', () => {
    expect(formatRemaining(30 * 1000)).toBe('less than a minute');
    expect(formatRemaining(0)).toBe('less than a minute');
  });
});
