import { describe, expect, it } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import type { Staff } from '@ops/shared';

// Set fake env to satisfy the Firebase Admin/Functions initializers that run
// at module scope in uploadModuleFile.ts before the import fires.
process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';
const { assertValidModuleFileRequest, staffHasAdminAccess, ALLOWED_MODULE_FILE_MIME_TYPES } =
  await import('./uploadModuleFile.js');

const validRequest = () => ({
  moduleId: 'onboarding',
  itemId: 'itm-1',
  fileName: 'handbook.pdf',
  mimeType: 'application/pdf',
  base64Data: 'aGVsbG8=', // "hello"
});

/** Capture the HttpsError thrown by a validator so its `code` can be asserted. */
function catchHttps(fn: () => void): HttpsError | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof HttpsError ? err : null;
  }
}

// staff.role stores the lower-kebab-case slug (e.g. 'administrator'), not the
// display name — matching how isAdminRole is keyed.
const staff = (over: Partial<Staff> = {}): Staff =>
  ({
    role: 'teacher',
    hasAdminAccess: false,
    ...over,
  }) as Staff;

describe('assertValidModuleFileRequest', () => {
  it('accepts a well-formed request', () => {
    expect(() => assertValidModuleFileRequest(validRequest())).not.toThrow();
  });

  it.each(['moduleId', 'itemId', 'fileName', 'mimeType', 'base64Data'] as const)(
    'rejects a request missing %s',
    (field) => {
      const req = validRequest();
      req[field] = '';
      const err = catchHttps(() => assertValidModuleFileRequest(req));
      expect(err?.code).toBe('invalid-argument');
    },
  );

  it('rejects an unsupported MIME type (e.g. an executable)', () => {
    const req = { ...validRequest(), mimeType: 'application/x-msdownload' };
    const err = catchHttps(() => assertValidModuleFileRequest(req));
    expect(err?.code).toBe('invalid-argument');
    expect(err?.message).toContain('Unsupported file type');
  });

  it('rejects a file over the 20 MB limit', () => {
    // base64 length L decodes to ~L*3/4 bytes; pick L just past 20 MB.
    const overLimitLength = Math.ceil((20 * 1024 * 1024 + 1) * 4) / 3 + 8;
    const req = { ...validRequest(), base64Data: 'a'.repeat(Math.ceil(overLimitLength)) };
    const err = catchHttps(() => assertValidModuleFileRequest(req));
    expect(err?.code).toBe('invalid-argument');
    expect(err?.message).toContain('20 MB');
  });

  it('allows a file at the boundary (≤ 20 MB)', () => {
    // 20 MB worth of bytes ≈ (20MB * 4/3) base64 chars; stay just under.
    const atLimitLength = Math.floor((20 * 1024 * 1024 * 4) / 3) - 8;
    const req = { ...validRequest(), base64Data: 'a'.repeat(atLimitLength) };
    expect(() => assertValidModuleFileRequest(req)).not.toThrow();
  });
});

describe('staffHasAdminAccess', () => {
  it('denies a non-admin teacher', () => {
    expect(staffHasAdminAccess(staff({ role: 'teacher', hasAdminAccess: false }))).toBe(false);
  });

  it('denies a missing staff doc', () => {
    expect(staffHasAdminAccess(null)).toBe(false);
  });

  it('allows the administrator role', () => {
    expect(staffHasAdminAccess(staff({ role: 'administrator' }))).toBe(true);
  });

  it('allows the full-access role', () => {
    expect(staffHasAdminAccess(staff({ role: 'full-access' }))).toBe(true);
  });

  it('allows the hasAdminAccess flag regardless of role', () => {
    expect(staffHasAdminAccess(staff({ role: 'teacher', hasAdminAccess: true }))).toBe(true);
  });
});

describe('ALLOWED_MODULE_FILE_MIME_TYPES', () => {
  it('includes the common handbook/PDF type', () => {
    expect(ALLOWED_MODULE_FILE_MIME_TYPES.has('application/pdf')).toBe(true);
  });

  it('excludes executables', () => {
    expect(ALLOWED_MODULE_FILE_MIME_TYPES.has('application/x-msdownload')).toBe(false);
  });
});
