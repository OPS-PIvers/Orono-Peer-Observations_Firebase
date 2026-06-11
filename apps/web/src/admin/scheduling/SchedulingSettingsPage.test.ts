import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULING_SETTINGS } from '@ops/shared';
import { validateSchedulingSettingsDraft } from './SchedulingSettingsPage';

describe('validateSchedulingSettingsDraft', () => {
  it('passes the default scheduling settings', () => {
    expect(validateSchedulingSettingsDraft(DEFAULT_SCHEDULING_SETTINGS)).toHaveLength(0);
  });

  it('passes valid custom settings', () => {
    const errors = validateSchedulingSettingsDraft({
      ...DEFAULT_SCHEDULING_SETTINGS,
      travelBufferMinutes: 30,
      bookingLeadTimeHours: 24,
      allowedBookingModes: ['direct'],
      defaultBookingMode: 'direct',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects travelBufferMinutes exceeding max (240)', () => {
    const errors = validateSchedulingSettingsDraft({
      ...DEFAULT_SCHEDULING_SETTINGS,
      travelBufferMinutes: 300,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('travelBufferMinutes');
  });

  it('accepts travelBufferMinutes of 0 (min is 0)', () => {
    const errors = validateSchedulingSettingsDraft({
      ...DEFAULT_SCHEDULING_SETTINGS,
      travelBufferMinutes: 0,
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects bookingLeadTimeHours exceeding max (720)', () => {
    const errors = validateSchedulingSettingsDraft({
      ...DEFAULT_SCHEDULING_SETTINGS,
      bookingLeadTimeHours: 800,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('bookingLeadTimeHours');
  });

  it('rejects allowedBookingModes with no entries (min 1)', () => {
    const errors = validateSchedulingSettingsDraft({
      ...DEFAULT_SCHEDULING_SETTINGS,
      allowedBookingModes: [],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('allowedBookingModes');
  });

  it('rejects defaultPerDayCap of 0 (positive constraint)', () => {
    const errors = validateSchedulingSettingsDraft({
      ...DEFAULT_SCHEDULING_SETTINGS,
      defaultPerDayCap: 0,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts null defaultPerDayCap (uncapped)', () => {
    const errors = validateSchedulingSettingsDraft({
      ...DEFAULT_SCHEDULING_SETTINGS,
      defaultPerDayCap: null,
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts positive defaultPerDayCap', () => {
    const errors = validateSchedulingSettingsDraft({
      ...DEFAULT_SCHEDULING_SETTINGS,
      defaultPerDayCap: 5,
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects gcalSendUpdates with an invalid value', () => {
    // Cast through unknown to simulate a bad value arriving from Firestore
    // without suppressing TypeScript at the call site.
    const bad = { ...DEFAULT_SCHEDULING_SETTINGS, gcalSendUpdates: 'invalid' } as unknown;
    const errors = validateSchedulingSettingsDraft(
      bad as Parameters<typeof validateSchedulingSettingsDraft>[0],
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('includes field path in error messages', () => {
    const errors = validateSchedulingSettingsDraft({
      ...DEFAULT_SCHEDULING_SETTINGS,
      travelBufferMinutes: -1,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('travelBufferMinutes');
  });
});
