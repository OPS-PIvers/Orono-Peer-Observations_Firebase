import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Observation, ObservationWindow } from '@ops/shared';

// Satisfy Firebase Admin/Functions initializers that run at module scope.
process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

// Mutable holder for the fake Firestore used by primaryCalendarId(). Hoisted so
// the vi.mock factory below can close over it.
const state = vi.hoisted(() => ({
  primaryCalendarId: undefined as string | undefined,
}));

// Keep the real Timestamp (toDate uses `instanceof Timestamp`); only swap
// getFirestore so primaryCalendarId reads from our fake token doc.
vi.mock('firebase-admin/firestore', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    getFirestore: () => ({
      collection: () => ({
        doc: () => ({
          async get() {
            return {
              exists: true,
              data: () =>
                state.primaryCalendarId !== undefined
                  ? { primaryCalendarId: state.primaryCalendarId }
                  : {},
            };
          },
        }),
      }),
    }),
  };
});

// Avoid a real Admin SDK init at module scope.
vi.mock('firebase-admin/app', () => ({
  getApps: () => [{}],
  initializeApp: vi.fn(),
}));

const { buildObservationEventContent, toDate, overlapsBusy, createObservationEvent } = await import(
  './googleCalendar.js'
);
const { Timestamp } = await import('firebase-admin/firestore');

beforeEach(() => {
  state.primaryCalendarId = undefined;
});

// ---------------------------------------------------------------------------
// buildObservationEventContent
// ---------------------------------------------------------------------------

describe('buildObservationEventContent', () => {
  const obs = { observationId: 'obs-1', observationName: 'Q3 Round' };

  it('uses the window custom title when present', () => {
    const { summary } = buildObservationEventContent(obs, {
      calendarEventTitle: 'Custom Title',
      calendarEventDescription: '',
    });
    expect(summary).toBe('Custom Title');
  });

  it('falls back to the observation name when no custom title', () => {
    const { summary } = buildObservationEventContent(obs, {
      calendarEventTitle: '',
      calendarEventDescription: '',
    });
    expect(summary).toBe('Q3 Round');
  });

  it('falls back to "Peer Observation" when both title and name are empty', () => {
    const { summary } = buildObservationEventContent(
      { observationId: 'obs-1', observationName: '' },
      { calendarEventTitle: '', calendarEventDescription: '' },
    );
    expect(summary).toBe('Peer Observation');
  });

  it('appends the app deep-link to a custom description', () => {
    const { description } = buildObservationEventContent(obs, {
      calendarEventTitle: 'T',
      calendarEventDescription: 'See you there',
    });
    expect(description).toContain('See you there');
    expect(description).toContain('/observations/obs-1');
    expect(description.indexOf('See you there')).toBeLessThan(description.indexOf('/observations'));
  });

  it('uses just the deep-link when no custom description', () => {
    const { description } = buildObservationEventContent(obs, {
      calendarEventTitle: 'T',
      calendarEventDescription: '',
    });
    expect(description).toMatch(/\/observations\/obs-1$/);
  });
});

// ---------------------------------------------------------------------------
// toDate
// ---------------------------------------------------------------------------

describe('toDate', () => {
  it('passes through a JS Date', () => {
    const d = new Date('2026-05-01T10:00:00Z');
    expect(toDate(d)).toBe(d);
  });

  it('converts a Firestore Timestamp', () => {
    const d = new Date('2026-05-01T10:00:00Z');
    const ts = Timestamp.fromDate(d);
    expect(toDate(ts)?.getTime()).toBe(d.getTime());
  });

  it('parses an ISO string', () => {
    expect(toDate('2026-05-01T10:00:00Z')?.toISOString()).toBe('2026-05-01T10:00:00.000Z');
  });

  it('returns null for an unparseable string', () => {
    expect(toDate('not a date')).toBeNull();
  });

  it('returns null for null/number', () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(123)).toBeNull();
  });

  it('handles a toDate()-bearing duck type', () => {
    const d = new Date('2026-05-01T10:00:00Z');
    expect(toDate({ toDate: () => d })).toBe(d);
  });
});

// ---------------------------------------------------------------------------
// overlapsBusy
// ---------------------------------------------------------------------------

describe('overlapsBusy', () => {
  const busy = [{ startMs: 100, endMs: 200 }];

  it('detects an overlapping interval', () => {
    expect(overlapsBusy(150, 250, busy)).toBe(true);
  });

  it('treats adjacent (touching) intervals as non-overlapping', () => {
    expect(overlapsBusy(200, 300, busy)).toBe(false);
    expect(overlapsBusy(0, 100, busy)).toBe(false);
  });

  it('returns false against an empty busy list', () => {
    expect(overlapsBusy(150, 250, [])).toBe(false);
  });

  it('detects a fully-contained requested interval', () => {
    expect(overlapsBusy(120, 180, busy)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createObservationEvent
// ---------------------------------------------------------------------------

function fakeCal(insertImpl?: () => Promise<{ data: { id?: string } }>) {
  const insert = vi.fn(insertImpl ?? (async () => ({ data: { id: 'evt-1' } })));
  return { cal: { events: { insert } } as never, insert };
}

const baseObs = {
  observationId: 'obs-1',
  observationName: 'Round',
  observerEmail: 'observer@orono.k12.mn.us',
  observedEmail: 'observed@orono.k12.mn.us',
  scheduledStartAt: '2026-05-01T14:00:00Z',
  scheduledEndAt: '2026-05-01T14:30:00Z',
} as unknown as Observation;

const baseWindow = {
  calendarEventTitle: 'Visit',
  calendarEventDescription: '',
  gcalSendUpdates: 'none',
} as unknown as ObservationWindow;

describe('createObservationEvent', () => {
  it('inserts on both calendars and returns both event ids', async () => {
    const observer = fakeCal(async () => ({ data: { id: 'evt-observer' } }));
    const observed = fakeCal(async () => ({ data: { id: 'evt-observed' } }));
    const result = await createObservationEvent({
      observation: baseObs,
      window: baseWindow,
      observerCal: observer.cal,
      observedCal: observed.cal,
    });
    expect(result).toEqual({ observer: 'evt-observer', observed: 'evt-observed' });
    expect(observer.insert).toHaveBeenCalledOnce();
    expect(observed.insert).toHaveBeenCalledOnce();
  });

  it('inserts only on the observer calendar when observed is not connected', async () => {
    const observer = fakeCal(async () => ({ data: { id: 'evt-observer' } }));
    const result = await createObservationEvent({
      observation: baseObs,
      window: baseWindow,
      observerCal: observer.cal,
      observedCal: null,
    });
    expect(result).toEqual({ observer: 'evt-observer' });
  });

  it('returns {} and inserts nothing when scheduled times are missing', async () => {
    const observer = fakeCal();
    const result = await createObservationEvent({
      observation: { ...baseObs, scheduledStartAt: null } as unknown as Observation,
      window: baseWindow,
      observerCal: observer.cal,
      observedCal: null,
    });
    expect(result).toEqual({});
    expect(observer.insert).not.toHaveBeenCalled();
  });

  it('is best-effort: a failing insert on one calendar does not block the other', async () => {
    const observer = fakeCal(async () => {
      throw new Error('403 rate limited');
    });
    const observed = fakeCal(async () => ({ data: { id: 'evt-observed' } }));
    const result = await createObservationEvent({
      observation: baseObs,
      window: baseWindow,
      observerCal: observer.cal,
      observedCal: observed.cal,
    });
    expect(result).toEqual({ observed: 'evt-observed' });
  });

  it('passes sendUpdates="all" through when the window opts in', async () => {
    const observer = fakeCal();
    await createObservationEvent({
      observation: baseObs,
      window: { ...baseWindow, gcalSendUpdates: 'all' } as unknown as ObservationWindow,
      observerCal: observer.cal,
      observedCal: null,
    });
    expect(observer.insert).toHaveBeenCalledWith(
      expect.objectContaining({ sendUpdates: 'all' }),
    );
  });

  it('defaults sendUpdates to "none" for any non-"all" value', async () => {
    const observer = fakeCal();
    await createObservationEvent({
      observation: baseObs,
      window: baseWindow,
      observerCal: observer.cal,
      observedCal: null,
    });
    expect(observer.insert).toHaveBeenCalledWith(
      expect.objectContaining({ sendUpdates: 'none' }),
    );
  });

  it('targets the stored primary calendar id when configured', async () => {
    state.primaryCalendarId = 'team-cal@group.calendar.google.com';
    const observer = fakeCal();
    await createObservationEvent({
      observation: baseObs,
      window: baseWindow,
      observerCal: observer.cal,
      observedCal: null,
    });
    expect(observer.insert).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: 'team-cal@group.calendar.google.com' }),
    );
  });
});
