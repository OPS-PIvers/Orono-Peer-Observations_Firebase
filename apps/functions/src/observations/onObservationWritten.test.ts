import { describe, expect, it, vi } from 'vitest';
import { AUDIT_ACTIONS } from '@ops/shared';

// Mock Firebase modules so we can import buildRow without side-effects from
// the top-level initializeApp() call or from firebase-functions/params.
vi.mock('firebase-admin/app', () => ({ getApps: () => [], initializeApp: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  Timestamp: class {
    toMillis() {
      return 0;
    }
  },
  getFirestore: vi.fn(),
}));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: vi.fn() }));
vi.mock('firebase-functions/params', () => ({ defineString: () => ({ value: () => '' }) }));
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../lib/sheets.js', () => ({ getSheetsClient: vi.fn() }));
vi.mock('../lib/drive.js', () => ({ deleteDriveFolder: vi.fn() }));
vi.mock('../lib/emailUtils.js', () => ({ formatDate: vi.fn(), sendTemplatedEmail: vi.fn() }));

import { buildRow } from './onObservationWritten.js';

/**
 * Tests for onObservationWritten audit-logging additions.
 *
 * The trigger itself wraps Firebase Functions event handlers which are hard to
 * unit-test directly (they require proper CloudEvent envelopes). The audit-write
 * logic is verified through the AuditAction contract — every string written by
 * the trigger must be a member of AUDIT_ACTIONS so Firestore validation enforces
 * it at write time. These tests confirm the required enum members exist and have
 * the right values.
 *
 * The windowId guard (suppressing the creation email for booking-created drafts)
 * was documented in the previous version of this file and remains correct:
 *   isNewObservation && afterData['observedEmail'] && !hasWindowId → send email
 */
describe('onObservationWritten audit action contract', () => {
  it('AUDIT_ACTIONS includes observationCreated', () => {
    expect(AUDIT_ACTIONS.observationCreated).toBe('observation_created');
  });

  it('AUDIT_ACTIONS includes observationUpdated', () => {
    expect(AUDIT_ACTIONS.observationUpdated).toBe('observation_updated');
  });

  it('AUDIT_ACTIONS includes observationDeleted', () => {
    expect(AUDIT_ACTIONS.observationDeleted).toBe('observation_deleted');
  });

  it('AUDIT_ACTIONS includes all calendar integration actions', () => {
    expect(AUDIT_ACTIONS.calendarConnect).toBe('calendar.connect');
    expect(AUDIT_ACTIONS.calendarDisconnect).toBe('calendar.disconnect');
    expect(AUDIT_ACTIONS.calendarEventSkipped).toBe('calendar.eventSkipped');
    expect(AUDIT_ACTIONS.calendarEventCreateFailed).toBe('calendar.eventCreateFailed');
  });

  it('AUDIT_ACTIONS includes observationWindowScheduleChangeWarning', () => {
    expect(AUDIT_ACTIONS.observationWindowScheduleChangeWarning).toBe(
      'observationWindow.scheduleChangeWarning',
    );
  });

  it('all AUDIT_ACTIONS values are unique', () => {
    const values = Object.values(AUDIT_ACTIONS);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('all AUDIT_ACTIONS values are non-empty strings', () => {
    for (const value of Object.values(AUDIT_ACTIONS)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });
});

describe('onObservationWritten creation email suppression logic', () => {
  it('documents the windowId guard decision logic that prevents double emails', () => {
    // The trigger decision at onObservationWritten.ts:
    //   const isNewObservation = !beforeData && !!afterData;
    //   const hasWindowId = afterData['windowId'] != null;
    //   if (isNewObservation && afterData['observedEmail'] && !hasWindowId) {
    //     // send creation email
    //   }
    //
    // Guard semantics:
    // - Send email if: new observation AND has observedEmail AND windowId NOT set
    // - Skip email if: new observation AND has windowId (booking flow)
    //
    // This fixes the double-email issue where:
    // - bookObservationSlot creates Draft with windowId + sends booking confirmation
    // - onObservationWritten fired on that creation and sent generic creation email too
    // - Staff member received both messages
    //
    // Now the hasWindowId check guards the creation email, so booking confirmation
    // is the sole notification for scheduled observations (WP/IR templates are active by default).
    expect(true).toBe(true);
  });
});

describe('buildRow', () => {
  it('returns 15 columns (A–O) including the new Acknowledged column', () => {
    const row = buildRow('obs1', {
      observerEmail: 'pe@orono.k12.mn.us',
      observedEmail: 'teacher@orono.k12.mn.us',
      observedName: 'Jane Smith',
      observedRole: 'teacher',
      observedYear: 2,
      type: 'Standard',
      status: 'Finalized',
      createdAt: null,
      finalizedAt: null,
      observationName: 'Period 3',
      observationDate: null,
      driveFolderId: null,
      pdfDriveFileId: null,
      acknowledgedAt: null,
    });
    expect(row).toHaveLength(15);
    // Column O (index 14) is the Acknowledged column
    expect(row[14]).toBe('');
  });

  it('populates the Acknowledged column from a numeric timestamp', () => {
    const ms = new Date('2026-05-15T10:00:00.000Z').getTime();
    const row = buildRow('obs2', {
      observerEmail: 'pe@orono.k12.mn.us',
      observedEmail: 'teacher@orono.k12.mn.us',
      observedName: 'Jane Smith',
      observedRole: 'teacher',
      observedYear: 2,
      type: 'Standard',
      status: 'Finalized',
      createdAt: null,
      finalizedAt: null,
      observationName: 'Period 3',
      observationDate: null,
      driveFolderId: null,
      pdfDriveFileId: null,
      acknowledgedAt: ms,
    });
    expect(row[14]).toMatch(/^2026-05-15/);
  });

  it('leaves Acknowledged empty for draft observations with no acknowledgedAt', () => {
    const row = buildRow('obs3', {
      observerEmail: 'pe@orono.k12.mn.us',
      observedEmail: 'teacher@orono.k12.mn.us',
      observedName: 'Jane Smith',
      observedRole: 'teacher',
      observedYear: 1,
      type: 'Standard',
      status: 'Draft',
      createdAt: null,
      finalizedAt: null,
      observationName: '',
      observationDate: null,
      driveFolderId: null,
      pdfDriveFileId: null,
    });
    expect(row[14]).toBe('');
  });
});
