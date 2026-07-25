/**
 * CreateObservationWindowDialog — seed-from-existing-window regression tests.
 *
 * These cover the "Duplicate" flow (`seedFrom` set to a real
 * ObservationWindow) versus the plain "create new" flow (`seedFrom` null),
 * with a focus on fields that are nullable-with-meaning in the schema
 * (currently just `perDayCap`, where `null` means "intentionally
 * uncapped" rather than "value absent"). A naive `seedFrom?.field ?? default`
 * pattern collapses those two cases and silently re-caps a deliberately
 * uncapped source window.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SCHEDULING_SETTINGS,
  observationWindow,
  OBSERVATION_TYPES,
  type AppSettings,
  type ObservationWindow,
} from '@ops/shared';
import type { UseFirestoreDocResult } from '@/hooks/useFirestoreDoc';
import type { UseFirestoreCollectionResult } from '@/hooks/useFirestoreCollection';

// Hoisted so the vi.mock factories below (lifted to the top of the file by
// Vitest) can reference them without hitting the TDZ.
const { useFirestoreDocMock, mockCallable } = vi.hoisted(() => ({
  useFirestoreDocMock: vi.fn<(docPath: string) => UseFirestoreDocResult<AppSettings>>(),
  mockCallable: vi.fn(() =>
    Promise.resolve({ data: { windowId: 'w1', slotCount: 0, inviteeCount: 0 } }),
  ),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockCallable,
}));

vi.mock('@/lib/firebase', () => ({
  auth: {},
  db: {},
  storage: {},
  functions: {},
  functionsHttpUrl: vi.fn(),
}));

vi.mock('@/hooks/useFirestoreDoc', () => ({
  useFirestoreDoc: useFirestoreDocMock,
}));

vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: (): UseFirestoreCollectionResult<unknown> => ({
    data: [],
    loading: false,
    error: null,
  }),
}));

import { CreateObservationWindowDialog } from './CreateObservationWindowDialog';

/** Schema-complete ObservationWindow, day-preference mode, with an explicit
 *  `overrides` bag so each test can vary just the field(s) under test. */
function makeWindow(overrides: Partial<ObservationWindow> = {}): ObservationWindow {
  return observationWindow.parse({
    windowId: 'src-window',
    observerEmail: 'pe@orono.k12.mn.us',
    bookingMode: 'day-preference',
    startDate: '2026-09-01',
    endDate: '2026-09-05',
    defaultObservationType: OBSERVATION_TYPES.standard,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

function settingsDoc(scheduling: AppSettings['scheduling']): AppSettings & { id: string } {
  return {
    securityAdminEmail: 'admin@orono.k12.mn.us',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    globalBannerText: '',
    scheduling,
  } as AppSettings & { id: string };
}

beforeEach(() => {
  useFirestoreDocMock.mockReset();
  mockCallable.mockClear();
});

describe('CreateObservationWindowDialog — per-day cap seeding', () => {
  it('keeps a duplicated window uncapped when the source window was uncapped', () => {
    // Org default caps at 3/day, but the source window was deliberately
    // left uncapped (perDayCap: null is a meaningful value, not "unset").
    useFirestoreDocMock.mockReturnValue({
      data: settingsDoc({ ...DEFAULT_SCHEDULING_SETTINGS, defaultPerDayCap: 3 }),
      loading: false,
      error: null,
    });
    const source = makeWindow({ perDayCap: null });

    render(
      <CreateObservationWindowDialog
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        seedFrom={source}
      />,
    );

    const capInput = screen.getByLabelText<HTMLInputElement>(/per-day cap/i);
    // Blank input == uncapped, matching the source — must NOT show "3".
    expect(capInput.value).toBe('');
  });

  it('seeds the explicit per-day cap value from the source window when set', () => {
    useFirestoreDocMock.mockReturnValue({
      data: settingsDoc({ ...DEFAULT_SCHEDULING_SETTINGS, defaultPerDayCap: 3 }),
      loading: false,
      error: null,
    });
    const source = makeWindow({ perDayCap: 5 });

    render(
      <CreateObservationWindowDialog
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        seedFrom={source}
      />,
    );

    const capInput = screen.getByLabelText<HTMLInputElement>(/per-day cap/i);
    expect(capInput.value).toBe('5');
  });

  it('falls back to the org default when creating a fresh window (no seedFrom)', () => {
    useFirestoreDocMock.mockReturnValue({
      data: settingsDoc({
        ...DEFAULT_SCHEDULING_SETTINGS,
        defaultBookingMode: 'day-preference',
        defaultPerDayCap: 3,
      }),
      loading: false,
      error: null,
    });

    render(<CreateObservationWindowDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);

    const capInput = screen.getByLabelText<HTMLInputElement>(/per-day cap/i);
    expect(capInput.value).toBe('3');
  });
});
