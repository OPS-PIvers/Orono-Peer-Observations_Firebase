import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appSettings, OPS_BRAND, type AppSettings } from '@ops/shared';
import type { UseFirestoreDocResult } from '@/hooks/useFirestoreDoc';

// Hoisted so the vi.mock factory below (which Vitest lifts to the top of
// the file) can reference it without hitting the TDZ.
const { useFirestoreDocMock } = vi.hoisted(() => ({
  useFirestoreDocMock: vi.fn<(docPath: string) => UseFirestoreDocResult<AppSettings>>(),
}));

vi.mock('@/hooks/useFirestoreDoc', () => ({
  useFirestoreDoc: useFirestoreDocMock,
}));

import { BRAND_CSS_VARS, BrandingProvider, derivePrimaryShades } from './BrandingProvider';

/** Builds a schema-complete `/appSettings/global` doc with the given primary color. */
function settingsDoc(primaryColor: string): AppSettings & { id: string } {
  return {
    ...appSettings.parse({
      securityAdminEmail: 'admin@orono.k12.mn.us',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      branding: { appName: 'Orono Peer Observations', primaryColor, logoUrl: null, iconUrl: null },
    }),
    id: 'global',
  };
}

function mockSnapshot(data: (AppSettings & { id: string }) | null, loading = false) {
  useFirestoreDocMock.mockReturnValue({ data, loading, error: null });
}

/** Reads the inline --ops-brand-* custom properties currently set on <html>. */
function brandVars(): Record<string, string> {
  const style = document.documentElement.style;
  return Object.fromEntries(BRAND_CSS_VARS.map((name) => [name, style.getPropertyValue(name)]));
}

function expectNoBrandVars() {
  for (const value of Object.values(brandVars())) {
    expect(value).toBe('');
  }
}

beforeEach(() => {
  useFirestoreDocMock.mockReset();
  document.documentElement.removeAttribute('style');
});

describe('derivePrimaryShades', () => {
  it('derives dark, light, and lighter companions from the base hex', () => {
    expect(derivePrimaryShades('#7a1718')).toEqual({
      base: '#7a1718',
      dark: '#510f10',
      light: '#8a3334',
      lighter: '#f2e8e8',
    });
  });

  it('lowercases the base color so comparisons and CSS stay canonical', () => {
    expect(derivePrimaryShades('#7A1718').base).toBe('#7a1718');
  });

  it('keeps the stock OPS blue family within rounding of the DESIGN.md tokens', () => {
    const shades = derivePrimaryShades('#2d3f89');
    // DESIGN.md: dark #1d2a5d, light #4356a0, lighter #eaecf5.
    expect(shades.dark).toBe('#1e2a5a');
    expect(shades.light).toBe('#465697');
    expect(shades.lighter).toBe('#eaecf3');
  });
});

describe('BrandingProvider', () => {
  it('renders its children', () => {
    mockSnapshot(settingsDoc(OPS_BRAND.defaultPrimaryColor));
    render(
      <BrandingProvider>
        <p>shell content</p>
      </BrandingProvider>,
    );

    expect(screen.getByText('shell content')).toBeInTheDocument();
  });

  it('writes the brand variables to <html> when a custom primary color is saved', () => {
    mockSnapshot(settingsDoc('#7a1718'));
    render(<BrandingProvider>{null}</BrandingProvider>);

    const shades = derivePrimaryShades('#7a1718');
    expect(brandVars()).toEqual({
      '--ops-brand-primary': shades.base,
      '--ops-brand-primary-dark': shades.dark,
      '--ops-brand-primary-light': shades.light,
      '--ops-brand-primary-lighter': shades.lighter,
    });
  });

  it('sets no overrides when the stored color is the OPS default', () => {
    mockSnapshot(settingsDoc(OPS_BRAND.defaultPrimaryColor));
    render(<BrandingProvider>{null}</BrandingProvider>);

    expectNoBrandVars();
  });

  it('treats an uppercase variant of the default as the default', () => {
    mockSnapshot(settingsDoc('#2D3F89'));
    render(<BrandingProvider>{null}</BrandingProvider>);

    expectNoBrandVars();
  });

  it('clears the overrides on the next snapshot after an admin restores the default', () => {
    mockSnapshot(settingsDoc('#7a1718'));
    const { rerender } = render(<BrandingProvider>{null}</BrandingProvider>);
    expect(brandVars()['--ops-brand-primary']).toBe('#7a1718');

    mockSnapshot(settingsDoc(OPS_BRAND.defaultPrimaryColor));
    rerender(<BrandingProvider>{null}</BrandingProvider>);

    expectNoBrandVars();
  });

  it('falls back to the default theme when a doc holds a non-hex color', () => {
    // Bypass the schema (it rejects on parse) to simulate a raw Firestore doc
    // written before save-time validation existed.
    const doc = settingsDoc(OPS_BRAND.defaultPrimaryColor);
    mockSnapshot({ ...doc, branding: { ...doc.branding, primaryColor: 'tomato' } });
    render(<BrandingProvider>{null}</BrandingProvider>);

    expectNoBrandVars();
  });

  it('sets no overrides while the settings doc is loading or missing', () => {
    mockSnapshot(null, true);
    render(<BrandingProvider>{null}</BrandingProvider>);

    expectNoBrandVars();
  });

  it('removes the overrides on unmount', () => {
    mockSnapshot(settingsDoc('#7a1718'));
    const { unmount } = render(<BrandingProvider>{null}</BrandingProvider>);
    expect(brandVars()['--ops-brand-primary']).toBe('#7a1718');

    unmount();

    expectNoBrandVars();
  });
});
