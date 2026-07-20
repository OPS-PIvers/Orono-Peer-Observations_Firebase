import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appSettings, type AppSettings } from '@ops/shared';
import type { UseFirestoreDocResult } from '@/hooks/useFirestoreDoc';

// Hoisted so the vi.mock factory below (which Vitest lifts to the top of
// the file) can reference it without hitting the TDZ.
const { useFirestoreDocMock } = vi.hoisted(() => ({
  useFirestoreDocMock: vi.fn<(docPath: string) => UseFirestoreDocResult<AppSettings>>(),
}));

vi.mock('@/hooks/useFirestoreDoc', () => ({
  useFirestoreDoc: useFirestoreDocMock,
}));

import { GlobalBanner } from './GlobalBanner';

/** Builds a schema-complete `/appSettings/global` doc with the given banner text. */
function settingsDoc(globalBannerText: string): AppSettings & { id: string } {
  return {
    ...appSettings.parse({
      securityAdminEmail: 'admin@orono.k12.mn.us',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      globalBannerText,
    }),
    id: 'global',
  };
}

function mockSnapshot(data: (AppSettings & { id: string }) | null, loading = false) {
  useFirestoreDocMock.mockReturnValue({ data, loading, error: null });
}

beforeEach(() => {
  useFirestoreDocMock.mockReset();
});

describe('GlobalBanner', () => {
  it('subscribes to the appSettings/global doc', () => {
    mockSnapshot(settingsDoc(''));
    render(<GlobalBanner />);

    expect(useFirestoreDocMock).toHaveBeenCalledWith('appSettings/global');
  });

  it('renders the banner text inside a polite live region when set', () => {
    mockSnapshot(settingsDoc('Observations close Friday — finalize drafts by 3pm.'));
    render(<GlobalBanner />);

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Observations close Friday — finalize drafts by 3pm.');
  });

  it('offers no dismiss affordance', () => {
    mockSnapshot(settingsDoc('Scheduled maintenance tonight.'));
    render(<GlobalBanner />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders an empty live region when the text is empty', () => {
    mockSnapshot(settingsDoc(''));
    render(<GlobalBanner />);

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('treats whitespace-only text as no banner', () => {
    // Bypass the schema (it trims on parse) to simulate a raw Firestore doc
    // holding whitespace.
    mockSnapshot({ ...settingsDoc(''), globalBannerText: '   ' });
    render(<GlobalBanner />);

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('renders nothing visible while the doc is loading or missing', () => {
    mockSnapshot(null, true);
    render(<GlobalBanner />);

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('handles docs that predate the globalBannerText field', () => {
    // Firestore reads bypass Zod defaults — a legacy doc can lack the field
    // entirely despite the non-optional type.
    const legacy = settingsDoc('') as Partial<AppSettings> & { id: string };
    delete legacy.globalBannerText;
    mockSnapshot(legacy as AppSettings & { id: string });
    render(<GlobalBanner />);

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('hides the banner on the next snapshot after an admin clears the field', () => {
    mockSnapshot(settingsDoc('Cutover this weekend.'));
    const { rerender } = render(<GlobalBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('Cutover this weekend.');

    mockSnapshot(settingsDoc(''));
    rerender(<GlobalBanner />);

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
