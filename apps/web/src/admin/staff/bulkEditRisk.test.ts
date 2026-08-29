import { describe, expect, it } from 'vitest';
import { describeBulkEditRisk } from './bulkEditRisk';

describe('describeBulkEditRisk', () => {
  it('confirms archiving, because a bulk isActive:false locks every selected person out', () => {
    const risk = describeBulkEditRisk('isActive', false, 224);
    expect(risk?.title).toBe('Archive 224 staff members?');
    expect(risk?.confirmLabel).toBe('Archive 224');
  });

  it('does not confirm restoring — reactivating people is not destructive', () => {
    expect(describeBulkEditRisk('isActive', true, 224)).toBeNull();
  });

  it('confirms admin access in both directions', () => {
    expect(describeBulkEditRisk('hasAdminAccess', true, 3)?.confirmLabel).toBe('Grant access to 3');
    expect(describeBulkEditRisk('hasAdminAccess', false, 3)?.confirmLabel).toBe(
      'Revoke access from 3',
    );
  });

  it('confirms the summative flag in both directions', () => {
    expect(describeBulkEditRisk('summativeYear', true, 5)).not.toBeNull();
    expect(describeBulkEditRisk('summativeYear', false, 5)).not.toBeNull();
  });

  it('leaves routine corrections one click', () => {
    for (const field of [
      'year',
      'role',
      'addBuilding',
      'removeBuilding',
      'addModule',
      'removeModule',
    ] as const) {
      expect(describeBulkEditRisk(field, true, 10)).toBeNull();
      expect(describeBulkEditRisk(field, false, 10)).toBeNull();
    }
  });

  it('speaks in singular for one person', () => {
    expect(describeBulkEditRisk('isActive', false, 1)?.title).toBe('Archive 1 staff member?');
  });
});
