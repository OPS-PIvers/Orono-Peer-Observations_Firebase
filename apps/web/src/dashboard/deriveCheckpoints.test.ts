import { describe, expect, it } from 'vitest';
import { DEFAULT_STEPS, dashboardStep, type Observation } from '@ops/shared';
import {
  checkpointToIcsEvent,
  deriveCheckpoints,
  type CheckpointWithStatus,
} from './deriveCheckpoints';
import type { DeriveContext } from './dashboardEvents';

const NOW = new Date('2026-03-01T00:00:00Z');
const PAST = new Date('2026-02-01T00:00:00Z');
const FUTURE = new Date('2026-04-01T00:00:00Z');

function obs(partial: Partial<Observation>): Observation {
  return {
    observationId: 'obs-1',
    status: 'Draft',
    createdAt: PAST,
    lastModifiedAt: PAST,
    finalizedAt: null,
    acknowledgedAt: null,
    ...partial,
  } as unknown as Observation;
}

function ctx(partial: Partial<DeriveContext>): DeriveContext {
  return {
    finalizedStandard: [],
    standardDraft: null,
    workProductDraft: null,
    instructionalRoundDraft: null,
    finalizedWorkProduct: null,
    finalizedInstructionalRound: null,
    workProductQuestionsCount: 0,
    instructionalRoundQuestionsCount: 0,
    appSettings: null,
    openBooking: null,
    hasBookedSlot: false,
    hasWorkProduct: true,
    hasInstructionalRound: true,
    ...partial,
  };
}

describe('deriveCheckpoints (seed behavior)', () => {
  it('hides everything for a staff member with no observation and no window', () => {
    expect(deriveCheckpoints(DEFAULT_STEPS, ctx({}), NOW)).toEqual([]);
  });

  it('does not show signup when an observation exists but no window ever did', () => {
    // Regression, found against production: /observationWindows was empty and
    // the signup step's doneWhen was `observationCreated`, so a manually
    // created observation marked "Sign up for an observation window" complete.
    // The card then rendered permanently, with no date and no button —
    // dateFrom `windowEndDate` and buttonTarget `booking` both resolve through
    // `openBooking`, which is null with no window.
    const cards = deriveCheckpoints(
      DEFAULT_STEPS,
      ctx({ finalizedStandard: [obs({ status: 'Finalized', finalizedAt: PAST })] }),
      NOW,
    );
    expect(cards.find((c) => c.id === 'signup')).toBeUndefined();
  });

  it('marks signup done once the slot is booked', () => {
    const signup = deriveCheckpoints(DEFAULT_STEPS, ctx({ hasBookedSlot: true }), NOW).find(
      (c) => c.id === 'signup',
    );
    expect(signup?.status).toBe('done');
  });

  it('links a draft whose observationId field is missing via its doc id', () => {
    // 3 of 236 production observation docs were written without the
    // `observationId` field the schema marks required; those cards linked to
    // /observations/undefined. hydrateFirestoreDoc always attaches `id`.
    const draft = obs({ lastModifiedAt: PAST });
    delete (draft as unknown as { observationId?: string }).observationId;
    (draft as unknown as { id: string }).id = 'doc-abc';
    const review = deriveCheckpoints(DEFAULT_STEPS, ctx({ standardDraft: draft }), NOW).find(
      (c) => c.id === 'reviewDraft',
    );
    expect(review?.ctaUrl).toBe('/observations/doc-abc');
  });

  it('does not offer Acknowledge when neither id is present', () => {
    const finalized = obs({ status: 'Finalized', finalizedAt: PAST });
    delete (finalized as unknown as { observationId?: string }).observationId;
    const ack = deriveCheckpoints(DEFAULT_STEPS, ctx({ finalizedStandard: [finalized] }), NOW).find(
      (c) => c.id === 'acknowledge',
    );
    expect(ack?.ackObservationId).toBeUndefined();
  });

  it('shows signup as soon when a window is open', () => {
    const cards = deriveCheckpoints(
      DEFAULT_STEPS,
      ctx({ openBooking: { windowId: 'w', token: 't', endDate: null } }),
      NOW,
    );
    const signup = cards.find((c) => c.id === 'signup');
    expect(signup?.status).toBe('soon');
    expect(signup?.ctaUrl).toBe('/book/w?token=t');
  });

  it('shows the window close date on the signup card, with urgency near the deadline', () => {
    const farOut = deriveCheckpoints(
      DEFAULT_STEPS,
      ctx({
        openBooking: { windowId: 'w', token: 't', endDate: new Date('2026-04-01T12:00:00Z') },
      }),
      NOW,
    ).find((c) => c.id === 'signup');
    expect(farOut?.dateLabel).toBe('Closes Apr 1');
    expect(farOut?.urgent).toBe(false);

    const closingSoon = deriveCheckpoints(
      DEFAULT_STEPS,
      ctx({
        openBooking: { windowId: 'w', token: 't', endDate: new Date('2026-03-02T12:00:00Z') },
      }),
      NOW,
    ).find((c) => c.id === 'signup');
    expect(closingSoon?.urgent).toBe(true);
    expect(closingSoon?.dueRelative).toMatch(/day/i);
  });

  it('marks the pre-obs meeting done once its date is in the past', () => {
    const cards = deriveCheckpoints(
      DEFAULT_STEPS,
      ctx({ standardDraft: obs({ preObsDate: PAST, observationDate: FUTURE }) }),
      NOW,
    );
    expect(cards.find((c) => c.id === 'preObs')?.status).toBe('done');
    expect(cards.find((c) => c.id === 'observation')?.status).toBe('soon');
  });

  it('reviewDraft vanishes once finalized (no active draft)', () => {
    const finalized = obs({ status: 'Finalized', finalizedAt: PAST });
    const cards = deriveCheckpoints(DEFAULT_STEPS, ctx({ finalizedStandard: [finalized] }), NOW);
    expect(cards.find((c) => c.id === 'reviewDraft')).toBeUndefined();
  });

  it('reviewDraft re-shows for a fresh draft even when a prior cycle is finalized', () => {
    // Overlapping cycles: an old finalized standard obs + a new active draft.
    // anyDraft must surface the draft so the card reappears.
    const oldFinalized = obs({ observationId: 'old', status: 'Finalized', finalizedAt: PAST });
    const newDraft = obs({ observationId: 'new', lastModifiedAt: PAST });
    const cards = deriveCheckpoints(
      DEFAULT_STEPS,
      ctx({ finalizedStandard: [oldFinalized], standardDraft: newDraft }),
      NOW,
    );
    const review = cards.find((c) => c.id === 'reviewDraft');
    expect(review).toBeDefined();
    expect(review?.status).toBe('soon');
  });

  it('the built-in signup and instructionalRound steps carry a non-ICS-eligible dateSource', () => {
    // Regression test for the reported defect: both steps use a "meeting" /
    // "observation" chipStyle but their dates are a booking deadline and a
    // record-creation timestamp, respectively — neither is a real event.
    const cards = deriveCheckpoints(
      DEFAULT_STEPS,
      ctx({
        openBooking: { windowId: 'w', token: 't', endDate: FUTURE },
        instructionalRoundDraft: obs({ createdAt: PAST }),
      }),
      NOW,
    );
    const signup = cards.find((c) => c.id === 'signup');
    const instructionalRound = cards.find((c) => c.id === 'instructionalRound');
    if (!signup || !instructionalRound) throw new Error('expected both cards to be present');
    expect(signup.dateSource).toBe('windowEndDate');
    expect(checkpointToIcsEvent(signup, 'x@orono.k12.mn.us')).toBeNull();
    expect(instructionalRound.dateSource).toBe('createdAt');
    expect(checkpointToIcsEvent(instructionalRound, 'x@orono.k12.mn.us')).toBeNull();
  });

  it("threads a real booked slot's scheduledStartAt/scheduledEndAt onto the observation checkpoint (Finding 2)", () => {
    const slotStart = new Date('2026-03-05T09:15:00');
    const slotEnd = new Date('2026-03-05T09:45:00');
    const cards = deriveCheckpoints(
      DEFAULT_STEPS,
      ctx({
        standardDraft: obs({
          observationDate: slotStart,
          scheduledStartAt: slotStart,
          scheduledEndAt: slotEnd,
        }),
      }),
      NOW,
    );
    const observation = cards.find((c) => c.id === 'observation');
    expect(observation).toBeDefined();
    expect(observation?.scheduledStartAt).toEqual(slotStart);
    expect(observation?.scheduledEndAt).toEqual(slotEnd);
    const event = observation && checkpointToIcsEvent(observation, 'jane.doe@orono.k12.mn.us');
    expect(event?.allDay).toBe(false);
    expect(event?.end).toEqual(slotEnd);
  });

  it("does NOT treat a freshly-created observation's record-creation timestamp as a booked slot (Finding 1 regression)", () => {
    // CreateObservationDialog writes observationDate: new Date() the instant
    // a peer evaluator starts a manual observation, before any real meeting
    // time is chosen — no scheduledStartAt/scheduledEndAt exist yet.
    const createdInstant = new Date('2026-03-05T14:15:33');
    const cards = deriveCheckpoints(
      DEFAULT_STEPS,
      ctx({ standardDraft: obs({ observationDate: createdInstant }) }),
      NOW,
    );
    const observation = cards.find((c) => c.id === 'observation');
    expect(observation).toBeDefined();
    expect(observation?.scheduledStartAt).toBeNull();
    const event = observation && checkpointToIcsEvent(observation, 'jane.doe@orono.k12.mn.us');
    expect(event).not.toBeNull();
    expect(event?.allDay).toBe(true);
    expect(event?.start).toEqual(createdInstant);
    expect(event?.end).toEqual(createdInstant);
  });

  it('drives the work-product progress bar from answers', () => {
    const wp = obs({
      observationId: 'wp',
      workProductAnswers: [
        { answer: 'a' },
        { answer: '' },
        { answer: 'b' },
      ] as unknown as Observation['workProductAnswers'],
    });
    const cards = deriveCheckpoints(
      DEFAULT_STEPS,
      ctx({ workProductDraft: wp, workProductQuestionsCount: 4 }),
      NOW,
    );
    const card = cards.find((c) => c.id === 'workProduct');
    expect(card?.status).toBe('inprogress');
    expect(card?.percent).toBe(50);
    expect(card?.percentLabel).toBe('2 of 4 answered');
  });
});

describe('deriveCheckpoints (generic slots)', () => {
  it('a done + hideWhenDone step still gates the next previousStepDone step', () => {
    // A hidden-but-done step's done state propagates to the next chained step.
    // (Without this, a hide-when-done step would silently break chains.)
    const a = dashboardStep.parse({
      id: 'a',
      order: 0,
      showWhen: 'always',
      doneWhen: 'finalized',
      hideWhenDone: true,
    });
    const b = dashboardStep.parse({
      id: 'b',
      order: 1,
      showWhen: 'previousStepDone',
      doneWhen: 'never',
    });
    const finCtx = ctx({ finalizedStandard: [obs({ status: 'Finalized', finalizedAt: PAST })] });
    expect(deriveCheckpoints([a, b], finCtx, NOW).map((c) => c.id)).toEqual(['b']);
  });

  it('previousStepDone gates a step until the prior one is done', () => {
    const a = dashboardStep.parse({ id: 'a', order: 0, showWhen: 'always', doneWhen: 'finalized' });
    const b = dashboardStep.parse({
      id: 'b',
      order: 1,
      showWhen: 'previousStepDone',
      doneWhen: 'never',
    });
    expect(
      deriveCheckpoints([a, b], ctx({ standardDraft: obs({}) }), NOW).map((c) => c.id),
    ).toEqual(['a']);
    const fin = ctx({ finalizedStandard: [obs({ status: 'Finalized', finalizedAt: PAST })] });
    expect(deriveCheckpoints([a, b], fin, NOW).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('respects enabled + order', () => {
    const a = dashboardStep.parse({ id: 'a', order: 2, showWhen: 'always' });
    const b = dashboardStep.parse({ id: 'b', order: 1, showWhen: 'always' });
    const c = dashboardStep.parse({ id: 'c', order: 0, showWhen: 'always', enabled: false });
    expect(deriveCheckpoints([a, b, c], ctx({}), NOW).map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('falls back to "Awaiting date" when shown with no concrete date', () => {
    // pre-obs is shown (observation created) but has no pre-obs date yet
    const cards = deriveCheckpoints(DEFAULT_STEPS, ctx({ standardDraft: obs({}) }), NOW);
    const preObs = cards.find((c) => c.id === 'preObs');
    expect(preObs?.dateLabel).toBe('Awaiting date');
    expect(preObs?.rawDate).toBeNull();
  });

  it('exposes rawDate alongside dateLabel once a concrete date is set', () => {
    // Local (no 'Z') — checkpoint dates come from an HTML date input parsed
    // as local midnight (see apps/web/src/utils/dateHelpers.ts), so tests
    // must construct them the same way rather than anchoring to UTC.
    const preObsDate = new Date('2026-03-10T00:00:00');
    const cards = deriveCheckpoints(
      DEFAULT_STEPS,
      ctx({ standardDraft: obs({ preObsDate }) }),
      NOW,
    );
    const preObs = cards.find((c) => c.id === 'preObs');
    expect(preObs?.rawDate).toEqual(preObsDate);
  });

  it('fixedUrl button uses buttonUrl; none renders inert', () => {
    const link = dashboardStep.parse({
      id: 'l',
      showWhen: 'always',
      buttonTarget: 'fixedUrl',
      buttonUrl: '/x',
    });
    const inert = dashboardStep.parse({ id: 'i', showWhen: 'always', buttonTarget: 'none' });
    const cards = deriveCheckpoints([link, inert], ctx({}), NOW);
    expect(cards.find((c) => c.id === 'l')?.ctaUrl).toBe('/x');
    expect(cards.find((c) => c.id === 'i')?.ctaUrl).toBe('');
  });
});

describe('checkpointToIcsEvent (STAFF-04 — "Add to calendar")', () => {
  const STAFF_EMAIL = 'jane.doe@orono.k12.mn.us';

  function checkpoint(partial: Partial<CheckpointWithStatus>): CheckpointWithStatus {
    return {
      id: 'preObs',
      key: 'preObs',
      type: 'meeting',
      typeLabel: 'Meeting',
      title: 'Pre-Observation Conversation',
      desc: 'Meet with your peer evaluator.',
      monthLabel: 'Mar',
      dateLabel: 'Mar 10',
      rawDate: new Date('2026-03-10T00:00:00'),
      dateSource: 'preObsDate',
      scheduledStartAt: null,
      scheduledEndAt: null,
      dueRelative: '',
      cta: 'View',
      ctaUrl: '',
      status: 'soon',
      urgent: false,
      completedLabel: null,
      percent: null,
      percentLabel: '',
      ...partial,
    };
  }

  it('builds an all-day .ics event input for a date-only checkpoint', () => {
    const event = checkpointToIcsEvent(checkpoint({}), STAFF_EMAIL);
    expect(event).not.toBeNull();
    expect(event?.uid).toBe(
      'jane.doe@orono.k12.mn.us-preObs-20260310@peerobservations.orono.k12.mn.us',
    );
    expect(event?.summary).toBe('Pre-Observation Conversation');
    expect(event?.description).toBe('Meet with your peer evaluator.');
    expect(event?.allDay).toBe(true);
  });

  it('builds an event for the observation-date source too', () => {
    const event = checkpointToIcsEvent(
      checkpoint({
        id: 'observation',
        key: 'observation',
        type: 'observation',
        dateSource: 'observationDate',
      }),
      STAFF_EMAIL,
    );
    expect(event).not.toBeNull();
  });

  it('returns null when the checkpoint has no concrete date yet', () => {
    expect(checkpointToIcsEvent(checkpoint({ rawDate: null }), STAFF_EMAIL)).toBeNull();
  });

  it('omits description when the checkpoint has none', () => {
    const event = checkpointToIcsEvent(checkpoint({ desc: '' }), STAFF_EMAIL);
    expect(event?.description).toBeUndefined();
  });

  describe('eligibility is keyed on dateSource, not chipStyle', () => {
    it('returns null for deadline dates (windowEndDate) even with a "meeting" chip style', () => {
      // Mirrors the built-in "signup" step: chipStyle 'meeting' but the date
      // is the booking-window CLOSE deadline, not a meeting time.
      const signupLike = checkpoint({
        id: 'signup',
        key: 'signup',
        type: 'meeting',
        dateSource: 'windowEndDate',
      });
      expect(checkpointToIcsEvent(signupLike, STAFF_EMAIL)).toBeNull();
    });

    it('returns null for record-metadata dates (createdAt) even with an "observation" chip style', () => {
      // Mirrors the built-in "instructionalRound" step: chipStyle
      // 'observation' but the date is a Firestore createdAt timestamp.
      const instructionalRoundLike = checkpoint({
        id: 'instructionalRound',
        key: 'instructionalRound',
        type: 'observation',
        dateSource: 'createdAt',
      });
      expect(checkpointToIcsEvent(instructionalRoundLike, STAFF_EMAIL)).toBeNull();
    });

    it('returns null for lastModifiedAt and finalizedAt sources', () => {
      expect(
        checkpointToIcsEvent(checkpoint({ dateSource: 'lastModifiedAt' }), STAFF_EMAIL),
      ).toBeNull();
      expect(
        checkpointToIcsEvent(checkpoint({ dateSource: 'finalizedAt' }), STAFF_EMAIL),
      ).toBeNull();
    });

    it('is eligible for postObsDate regardless of chip style', () => {
      const event = checkpointToIcsEvent(
        checkpoint({ type: 'review', dateSource: 'postObsDate' }),
        STAFF_EMAIL,
      );
      expect(event).not.toBeNull();
    });
  });

  describe('timed vs. all-day', () => {
    it('emits an all-day event when rawDate is local midnight (date-only input)', () => {
      const event = checkpointToIcsEvent(
        checkpoint({ rawDate: new Date('2026-03-10T00:00:00') }),
        STAFF_EMAIL,
      );
      expect(event?.allDay).toBe(true);
      expect(event?.start).toEqual(new Date('2026-03-10T00:00:00'));
      expect(event?.end).toEqual(new Date('2026-03-10T00:00:00'));
    });

    // Regression test for Finding 1 (PR #67, 2nd fix cycle): a freshly
    // created observation writes `observationDate: new Date()` client-side
    // the instant a peer evaluator clicks "New observation" — BEFORE any
    // real meeting time is chosen (see CreateObservationDialog). That Date
    // carries a real time-of-day (record-creation instant, e.g. 14:15:33)
    // but has no relationship to any actual meeting. Against the buggy
    // hasTimeOfDay()-only heuristic this produced a fabricated TIMED event
    // at the exact creation instant; the fix must key "timed" solely on
    // `scheduledStartAt` (a genuine booked slot), which is absent here, so
    // this must remain an ALL-DAY event on rawDate's calendar day.
    it('emits an all-day event for a freshly-created observation with no booked slot, even though rawDate carries a time-of-day', () => {
      const createdInstant = new Date('2026-03-10T14:15:33');
      const event = checkpointToIcsEvent(
        checkpoint({
          dateSource: 'observationDate',
          rawDate: createdInstant,
          scheduledStartAt: null,
          scheduledEndAt: null,
        }),
        STAFF_EMAIL,
      );
      expect(event).not.toBeNull();
      expect(event?.allDay).toBe(true);
      expect(event?.start).toEqual(createdInstant);
      expect(event?.end).toEqual(createdInstant);
    });

    it('emits a timed event ending at the real scheduledEndAt when a slot is booked', () => {
      // Mirrors bookObservationSlot: observationDate === scheduledStartAt,
      // and scheduledEndAt reflects the slot's real (possibly non-45-min)
      // length — here a 30-minute slot, which must NOT be widened to 45.
      const slotStart = new Date('2026-03-10T09:15:00');
      const slotEnd = new Date('2026-03-10T09:45:00');
      const event = checkpointToIcsEvent(
        checkpoint({
          dateSource: 'observationDate',
          rawDate: slotStart,
          scheduledStartAt: slotStart,
          scheduledEndAt: slotEnd,
        }),
        STAFF_EMAIL,
      );
      expect(event).not.toBeNull();
      expect(event?.allDay).toBe(false);
      expect(event?.start).toEqual(slotStart);
      expect(event?.end).toEqual(slotEnd);
      expect(event?.end).not.toEqual(new Date(slotStart.getTime() + 45 * 60_000));
    });

    it('falls back to the default duration when a booked slot is missing scheduledEndAt', () => {
      const slotStart = new Date('2026-03-10T09:15:00');
      const event = checkpointToIcsEvent(
        checkpoint({
          dateSource: 'observationDate',
          rawDate: slotStart,
          scheduledStartAt: slotStart,
          scheduledEndAt: null,
        }),
        STAFF_EMAIL,
      );
      expect(event?.allDay).toBe(false);
      expect(event?.end).toEqual(new Date(slotStart.getTime() + 45 * 60_000));
    });
  });

  describe('UID uniqueness', () => {
    it('produces different UIDs for two different staff on the same checkpoint and date', () => {
      const a = checkpointToIcsEvent(checkpoint({}), 'staff-a@orono.k12.mn.us');
      const b = checkpointToIcsEvent(checkpoint({}), 'staff-b@orono.k12.mn.us');
      expect(a?.uid).not.toBe(b?.uid);
    });
  });

  describe('blank title', () => {
    it('returns null when the checkpoint has no title (untitled admin step)', () => {
      expect(checkpointToIcsEvent(checkpoint({ title: '' }), STAFF_EMAIL)).toBeNull();
      expect(checkpointToIcsEvent(checkpoint({ title: '   ' }), STAFF_EMAIL)).toBeNull();
    });
  });
});
