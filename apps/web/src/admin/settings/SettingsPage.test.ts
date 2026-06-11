import { describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@ops/shared';

// The page module imports the real Firebase client at module scope; stub it
// so the pure validator can be exercised without env credentials (CI has none).
vi.mock('@/lib/firebase', () => ({
  firebaseApp: {},
  auth: {},
  db: {},
  storage: {},
  functions: {},
  functionsHttpUrl: (name: string) => `https://example.test/${name}`,
}));

const { validateAppSettingsDraft } = await import('./SettingsPage');

describe('validateAppSettingsDraft', () => {
  it('passes an empty draft (all fields optional when partial)', () => {
    expect(validateAppSettingsDraft({})).toHaveLength(0);
  });

  it('passes a fully valid draft', () => {
    const draft: Partial<AppSettings> = {
      sessionDurationHours: 8,
      auditLogRetentionDays: 90,
      securityAdminEmail: 'admin@orono.k12.mn.us',
      outboundEmailAddress: 'obs@orono.k12.mn.us',
      globalBannerText: '',
      newObservationsDisabled: false,
    };
    expect(validateAppSettingsDraft(draft)).toHaveLength(0);
  });

  it('rejects sessionDurationHours of 0 (positive constraint)', () => {
    const errors = validateAppSettingsDraft({ sessionDurationHours: 0 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects sessionDurationHours exceeding max (168)', () => {
    const errors = validateAppSettingsDraft({ sessionDurationHours: 200 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects auditLogRetentionDays of 0', () => {
    const errors = validateAppSettingsDraft({ auditLogRetentionDays: 0 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts securityAdminEmail of empty string (treated as absent)', () => {
    // Empty string is coerced to "absent" — valid because it is optional.
    const errors = validateAppSettingsDraft({ securityAdminEmail: '' });
    expect(errors).toHaveLength(0);
  });

  it('rejects a malformed securityAdminEmail', () => {
    const errors = validateAppSettingsDraft({ securityAdminEmail: 'not-an-email' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts outboundEmailAddress of empty string (treated as absent)', () => {
    const errors = validateAppSettingsDraft({ outboundEmailAddress: '' });
    expect(errors).toHaveLength(0);
  });

  it('rejects a malformed outboundEmailAddress', () => {
    const errors = validateAppSettingsDraft({
      outboundEmailAddress: 'not-valid',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts signupLink of empty string (treated as absent)', () => {
    const errors = validateAppSettingsDraft({ signupLink: '' });
    expect(errors).toHaveLength(0);
  });

  it('rejects rate limits with zero values', () => {
    const errors = validateAppSettingsDraft({
      rateLimits: {
        observationSavesPerMinute: 0,
        audioUploadsPerHour: 20,
        transcriptionRequestsPerDay: 50,
      },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('observationSavesPerMinute');
  });

  it('passes rate limits with valid positive integers', () => {
    const errors = validateAppSettingsDraft({
      rateLimits: {
        observationSavesPerMinute: 30,
        audioUploadsPerHour: 10,
        transcriptionRequestsPerDay: 25,
      },
    });
    expect(errors).toHaveLength(0);
  });

  it('includes field path in error messages', () => {
    const errors = validateAppSettingsDraft({ sessionDurationHours: -1 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('sessionDurationHours');
  });
});
