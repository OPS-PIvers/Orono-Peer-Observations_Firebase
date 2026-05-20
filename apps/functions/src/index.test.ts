import { describe, expect, it } from 'vitest';

describe('functions index', () => {
  it('exports the deployed function set', async () => {
    // Set fake env to satisfy the Firebase Functions param resolver before
    // any module-level `defineString().value()` calls fire at import time.
    process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
    process.env['GCLOUD_PROJECT'] = 'test';
    const mod = await import('./index.js');
    expect(typeof mod.syncMyClaims).not.toBe('undefined');
    expect(typeof mod.onStaffWritten).not.toBe('undefined');
    expect(typeof mod.uploadAudio).not.toBe('undefined');
    expect(typeof mod.getAudio).not.toBe('undefined');
    expect(typeof mod.requestTranscription).not.toBe('undefined');
    expect(typeof mod.onTranscriptionJobCreated).not.toBe('undefined');
    expect(typeof mod.finalizeObservation).not.toBe('undefined');
    expect(typeof mod.onObservationWritten).not.toBe('undefined');
    expect(typeof mod.pruneAuditLog).not.toBe('undefined');
    expect(typeof mod.uploadEvidenceFile).not.toBe('undefined');
    expect(typeof mod.onRoleYearMappingWritten).not.toBe('undefined');
    expect(typeof mod.scheduledEmailReminders).not.toBe('undefined');
    expect(typeof mod.sendManualEmail).not.toBe('undefined');
    expect(typeof mod.createObservationWindow).not.toBe('undefined');
    expect(typeof mod.cancelObservationWindow).not.toBe('undefined');
    expect(typeof mod.expireObservationWindows).not.toBe('undefined');
    expect(typeof mod.onBuildingScheduleWritten).not.toBe('undefined');
    expect(typeof mod.bookObservationSlot).not.toBe('undefined');
    expect(typeof mod.submitDayPreference).not.toBe('undefined');
    expect(typeof mod.assignObservationFromPreference).not.toBe('undefined');
    expect(typeof mod.cancelBooking).not.toBe('undefined');
  }, 15_000);
});
