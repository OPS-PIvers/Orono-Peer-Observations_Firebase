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
      nowMs: deadlineMs - SESSION_WARNING_WINDOW_MS - 1,
    });
    expect(status).toEqual({ kind: 'ok' });
  });

  it('expires once now reaches the deadline', () => {
    const deadlineMs = AUTH_TIME_MS + SESSION_DURATION_MS;
    const status = computeSessionTimeoutStatus({
      authTimeMs: AUTH_TIME_MS,
      sessionDurationMs: SESSION_DURATION_MS,
      nowMs: deadlineMs,
    });
    expect(status).toEqual({ kind: 'expired' });
  });

  it('expires once now is past the deadline', () => {
    const deadlineMs = AUTH_TIME_MS + SESSION_DURATION_MS;
    const status = computeSessionTimeoutStatus({
      authTimeMs: AUTH_TIME_MS,
      sessionDurationMs: SESSION_DURATION_MS,
      nowMs: deadlineMs + 1,
    });
    expect(status).toEqual({ kind: 'expired' });
  });

  it('a real re-authentication (fresh auth_time) pushes the deadline out', () => {
    // Simulates what `reauthenticateWithPopup` produces: a brand new
    // auth_time, not a client-tracked extension anchor. There is exactly
    // one input that can move the deadline now — authTimeMs itself.
    const originalDeadlineMs = AUTH_TIME_MS + SESSION_DURATION_MS;
    const reauthTimeMs = originalDeadlineMs - 30 * 1000; // re-authed just before expiry
    const status = computeSessionTimeoutStatus({
      authTimeMs: reauthTimeMs,
      sessionDurationMs: SESSION_DURATION_MS,
      nowMs: reauthTimeMs + HOUR_MS,
    });
    expect(status).toEqual({ kind: 'ok' });
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
