import { describe, expect, it, vi } from 'vitest';
import type { Branding } from '@ops/shared';

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

const { validateBrandingDraft } = await import('./BrandingPage');

describe('validateBrandingDraft', () => {
  it('passes an empty draft (all fields optional when partial)', () => {
    expect(validateBrandingDraft({})).toHaveLength(0);
  });

  it('passes a fully valid draft', () => {
    const draft: Partial<Branding> = {
      appName: 'Orono Peer Observations',
      primaryColor: '#2d3f89',
      logoUrl: null,
      iconUrl: null,
    };
    expect(validateBrandingDraft(draft)).toHaveLength(0);
  });

  it('rejects a malformed hex color', () => {
    const errors = validateBrandingDraft({ primaryColor: 'blue' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('primaryColor');
  });

  it('rejects a 3-digit hex color (must be 6-digit)', () => {
    const errors = validateBrandingDraft({ primaryColor: '#abc' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('passes a valid 6-digit hex color', () => {
    const errors = validateBrandingDraft({ primaryColor: '#aabbcc' });
    expect(errors).toHaveLength(0);
  });

  it('rejects an empty appName', () => {
    // An empty string fails the min(1) constraint.
    const errors = validateBrandingDraft({ appName: '' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects appName exceeding max length (80)', () => {
    const errors = validateBrandingDraft({ appName: 'a'.repeat(81) });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('passes appName at maximum allowed length', () => {
    const errors = validateBrandingDraft({ appName: 'a'.repeat(80) });
    expect(errors).toHaveLength(0);
  });

  it('passes null logoUrl and iconUrl', () => {
    const errors = validateBrandingDraft({ logoUrl: null, iconUrl: null });
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-URL logoUrl', () => {
    const errors = validateBrandingDraft({ logoUrl: 'not-a-url' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('logoUrl');
  });

  it('passes a valid https logoUrl', () => {
    const errors = validateBrandingDraft({
      logoUrl: 'https://storage.googleapis.com/orono/logo.png',
    });
    expect(errors).toHaveLength(0);
  });

  it('includes field path in error messages', () => {
    const errors = validateBrandingDraft({ primaryColor: 'not-hex' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('primaryColor');
  });
});
