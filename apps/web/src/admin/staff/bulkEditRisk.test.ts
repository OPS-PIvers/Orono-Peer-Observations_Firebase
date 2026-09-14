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

  it('confirms every status change, naming the status and the summative flag it implies', () => {
    const high = describeBulkEditRisk('cycleStatus', true, 5, 'high');
    expect(high?.title).toBe('Set the status of 5 staff members to High Cycle?');
    expect(high?.confirmLabel).toBe('Set 5 to High Cycle');
    expect(high?.detail).toContain('summative');
    const planning = describeBulkEditRisk('cycleStatus', false, 5, 'planning');
    expect(planning?.detail).toContain('formative');
    expect(planning?.detail).toContain('Their year is not changed.');
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
