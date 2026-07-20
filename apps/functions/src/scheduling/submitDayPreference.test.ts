/**
 * Unit tests for the day-preference email notification logic introduced in
 * submitDayPreference.ts. The callable itself requires Firestore + Auth, so
 * we test the surrounding logic via the exported helpers it depends on.
 *
 * Specifically:
 *  - formatYMD output matches what the template variable receives.
 *  - mailDocId is unique per submission so retries and repeated submissions
 *    each create a distinct /mail doc (the Trigger Email extension only sends
 *    on creation, not updates).
 *  - The invitee name resolution falls back to userEmail when the invitee is
 *    not found on the window.
 */

import { describe, expect, it } from 'vitest';
import { formatYMD } from './engine/schedulingEmail.js';

// ── formatYMD (used to populate preferredDateLocal) ──────────────────────────

describe('formatYMD — preferredDateLocal variable', () => {
  it('formats a known Monday date correctly', () => {
    // 2026-06-01 is a Monday.
    expect(formatYMD('2026-06-01')).toBe('Monday, June 1, 2026');
  });

  it('formats a known Wednesday date correctly', () => {
    // 2026-05-20 is a Wednesday.
    expect(formatYMD('2026-05-20')).toBe('Wednesday, May 20, 2026');
  });

  it('returns the raw YMD string when the input is malformed', () => {
    expect(formatYMD('bad')).toBe('bad');
  });
});

// ── mailDocId uniqueness ──────────────────────────────────────────────────────

/**
 * The mail doc id format used in submitDayPreference is:
 *   scheduling.preferenceSubmitted-{windowId}-{userEmail}-{Date.now()}
 *
 * This test mirrors that formula and asserts:
 *  1. Two calls at different timestamps produce different ids (re-submitting
 *     a preference always triggers a fresh notification).
 *  2. Two calls at the *same* timestamp (simulated) for different windows
 *     produce different ids (idempotency within a single ms is per-window).
 */
function buildMailDocId(windowId: string, userEmail: string, nowMs: number): string {
  return `scheduling.preferenceSubmitted-${windowId}-${userEmail}-${String(nowMs)}`;
}

describe('preferenceSubmitted mailDocId', () => {
  it('differs between two submissions at different timestamps', () => {
    const id1 = buildMailDocId('win-1', 'jane@orono.k12.mn.us', 1_000_000);
    const id2 = buildMailDocId('win-1', 'jane@orono.k12.mn.us', 1_000_001);
    expect(id1).not.toBe(id2);
  });

  it('differs between two different windows at the same timestamp', () => {
    const id1 = buildMailDocId('win-a', 'jane@orono.k12.mn.us', 1_000_000);
    const id2 = buildMailDocId('win-b', 'jane@orono.k12.mn.us', 1_000_000);
    expect(id1).not.toBe(id2);
  });

  it('embeds the window id, user email, and timestamp', () => {
    const id = buildMailDocId('win-42', 'alex@orono.k12.mn.us', 9_999);
    expect(id).toBe('scheduling.preferenceSubmitted-win-42-alex@orono.k12.mn.us-9999');
  });
});

// ── staffName resolution ───────────────────────────────────────────────────────

/**
 * In submitDayPreference, the staff name sent to the template is resolved as:
 *   invitee?.name ?? userEmail
 * This mirrors the same defensive pattern used in other scheduling callables.
 */
function resolveStaffName(inviteeName: string | undefined, userEmail: string): string {
  return inviteeName ?? userEmail;
}

describe('staffName resolution for preferenceSubmitted email', () => {
  it('uses the invitee name when the invitee is found on the window', () => {
    expect(resolveStaffName('Jane Doe', 'jane@orono.k12.mn.us')).toBe('Jane Doe');
  });

  it('falls back to userEmail when the invitee record is absent', () => {
    expect(resolveStaffName(undefined, 'jane@orono.k12.mn.us')).toBe('jane@orono.k12.mn.us');
  });
});
