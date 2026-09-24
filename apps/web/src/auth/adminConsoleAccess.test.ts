import { describe, expect, it } from 'vitest';
import { canOpenAdminConsole } from './adminConsoleAccess';

describe('canOpenAdminConsole', () => {
  it('opens for Full Access', () => {
    expect(canOpenAdminConsole('full-access', true, false)).toBe(true);
  });

  it('opens for a non-special role with the hasAdminAccess claim', () => {
    expect(canOpenAdminConsole('teacher', true, false)).toBe(true);
  });

  it('stays closed for a building Administrator by default', () => {
    expect(canOpenAdminConsole('administrator', true, false)).toBe(false);
  });

  it('opens for an Administrator who also has hasAdminAccess', () => {
    expect(canOpenAdminConsole('administrator', true, true)).toBe(true);
  });

  it('stays closed without the isAdmin claim', () => {
    expect(canOpenAdminConsole('peer-evaluator', false, false)).toBe(false);
    expect(canOpenAdminConsole(null, false, true)).toBe(false);
  });
});
