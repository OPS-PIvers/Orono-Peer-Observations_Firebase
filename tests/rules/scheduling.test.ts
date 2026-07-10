import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { claims, setupTestEnv } from './harness.js';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await setupTestEnv();
});
afterAll(async () => {
  await testEnv.cleanup();
});
beforeEach(async () => {
  await testEnv.clearFirestore();
});

async function seed(path: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

describe('buildingSchedules rules', () => {
  beforeEach(async () => {
    await seed('buildingSchedules/high-school', {
      buildingId: 'high-school',
      timeZone: 'America/Chicago',
      dayTypes: [],
      isActive: true,
    });
  });

  it('domain teacher can read a schedule', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher()).firestore();
    await assertSucceeds(getDoc(doc(db, 'buildingSchedules/high-school')));
  });

  it('outsider cannot read', async () => {
    const db = testEnv.authenticatedContext('o', claims.outsider).firestore();
    await assertFails(getDoc(doc(db, 'buildingSchedules/high-school')));
  });

  it('admin can write a schedule', async () => {
    const db = testEnv.authenticatedContext('a', claims.admin()).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'buildingSchedules/middle-school'), {
        buildingId: 'middle-school',
        timeZone: 'America/Chicago',
        dayTypes: [],
        isActive: true,
      }),
    );
  });

  it('peer evaluator (non-admin) cannot write a schedule', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval()).firestore();
    await assertFails(
      setDoc(doc(db, 'buildingSchedules/high-school'), { isActive: false }, { merge: true }),
    );
  });

  it('teacher cannot write a schedule', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher()).firestore();
    await assertFails(
      setDoc(doc(db, 'buildingSchedules/high-school'), { isActive: false }, { merge: true }),
    );
  });
});

describe('signupFields rules', () => {
  beforeEach(async () => {
    await seed('signupFields/f-1', {
      fieldId: 'f-1',
      label: 'Prep period',
      type: 'period-picker',
      options: [],
      appliesTo: 'both',
      required: false,
      order: 0,
      isActive: true,
    });
  });

  it('domain teacher can read fields', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher()).firestore();
    await assertSucceeds(getDoc(doc(db, 'signupFields/f-1')));
  });

  it('admin can create a field', async () => {
    const db = testEnv.authenticatedContext('a', claims.admin()).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'signupFields/f-2'), {
        fieldId: 'f-2',
        label: 'Before or after school',
        type: 'before-after',
        options: [],
        appliesTo: 'both',
        required: false,
        order: 1,
        isActive: true,
      }),
    );
  });

  it('teacher cannot write a field', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher()).firestore();
    await assertFails(setDoc(doc(db, 'signupFields/f-1'), { isActive: false }, { merge: true }));
  });
});

describe('userCalendarTokens rules (server-only)', () => {
  beforeEach(async () => {
    await seed('userCalendarTokens/pe@orono.k12.mn.us', {
      email: 'pe@orono.k12.mn.us',
      refreshToken: 'secret',
      status: 'connected',
    });
  });

  it('the owner cannot read their own token doc', async () => {
    const db = testEnv
      .authenticatedContext('pe', claims.peerEval('pe@orono.k12.mn.us'))
      .firestore();
    await assertFails(getDoc(doc(db, 'userCalendarTokens/pe@orono.k12.mn.us')));
  });

  it('an admin cannot read token docs', async () => {
    const db = testEnv.authenticatedContext('a', claims.admin()).firestore();
    await assertFails(getDoc(doc(db, 'userCalendarTokens/pe@orono.k12.mn.us')));
  });

  it('no client can write a token doc', async () => {
    const db = testEnv
      .authenticatedContext('pe', claims.peerEval('pe@orono.k12.mn.us'))
      .firestore();
    await assertFails(
      setDoc(doc(db, 'userCalendarTokens/pe@orono.k12.mn.us'), { refreshToken: 'x' }),
    );
  });
});

const PE_EMAIL = 'pe@orono.k12.mn.us';
const INVITED_EMAIL = 'teacher@orono.k12.mn.us';
const OTHER_EMAIL = 'other@orono.k12.mn.us';

describe('observationWindows rules', () => {
  beforeEach(async () => {
    await seed('observationWindows/w1', {
      windowId: 'w1',
      observerEmail: PE_EMAIL,
      bookingMode: 'direct',
      invitedEmails: [INVITED_EMAIL],
      status: 'open',
    });
    await seed('observationWindows/w1/slots/high-school-2026-05-20-p1', {
      slotId: 'high-school-2026-05-20-p1',
      windowId: 'w1',
      buildingId: 'high-school',
      status: 'available',
    });
    await seed('observationWindows/w1/preferences/teacher@orono.k12.mn.us', {
      email: INVITED_EMAIL,
      buildingId: 'high-school',
      preferredDateYMD: '2026-05-20',
    });
  });

  it('observer (special access) can read their window', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertSucceeds(getDoc(doc(db, 'observationWindows/w1')));
  });

  it('invited staff can read the window', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher(INVITED_EMAIL)).firestore();
    await assertSucceeds(getDoc(doc(db, 'observationWindows/w1')));
  });

  it('non-invited staff cannot read the window', async () => {
    const db = testEnv.authenticatedContext('o', claims.teacher(OTHER_EMAIL)).firestore();
    await assertFails(getDoc(doc(db, 'observationWindows/w1')));
  });

  it('PE can create a window they observe', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'observationWindows/w2'), {
        windowId: 'w2',
        observerEmail: PE_EMAIL,
        bookingMode: 'direct',
        invitedEmails: [],
        status: 'open',
      }),
    );
  });

  it('PE cannot create a window for a different observer', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(
      setDoc(doc(db, 'observationWindows/w3'), {
        windowId: 'w3',
        observerEmail: OTHER_EMAIL,
        bookingMode: 'direct',
        invitedEmails: [],
        status: 'open',
      }),
    );
  });

  it('a different PE cannot update someone else’s window', async () => {
    const db = testEnv
      .authenticatedContext('pe2', claims.peerEval('pe2@orono.k12.mn.us'))
      .firestore();
    await assertFails(
      setDoc(doc(db, 'observationWindows/w1'), { status: 'cancelled' }, { merge: true }),
    );
  });

  it('observer can update allowlisted cosmetic fields on their window', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertSucceeds(
      setDoc(
        doc(db, 'observationWindows/w1'),
        {
          calendarEventTitle: 'Peer observation',
          calendarEventDescription: 'See you then',
          defaultObservationName: 'Spring round',
          updatedAt: new Date(),
        },
        { merge: true },
      ),
    );
  });

  it('observer CANNOT change window status directly (must go through the cancel Function)', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(
      setDoc(doc(db, 'observationWindows/w1'), { status: 'cancelled' }, { merge: true }),
    );
  });

  it('observer CANNOT rewrite invitedEmails / peBusyIntervals / dayCounts', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(
      setDoc(doc(db, 'observationWindows/w1'), { invitedEmails: [OTHER_EMAIL] }, { merge: true }),
    );
    await assertFails(
      setDoc(
        doc(db, 'observationWindows/w1'),
        { peBusyIntervals: [{ startUTC: new Date(), endUTC: new Date(), slotId: 's1' }] },
        { merge: true },
      ),
    );
    await assertFails(
      setDoc(
        doc(db, 'observationWindows/w1'),
        { dayCounts: { '2026-05-20': 99 } },
        { merge: true },
      ),
    );
  });

  it('admin can still change any window field directly', async () => {
    const db = testEnv.authenticatedContext('a', claims.admin()).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'observationWindows/w1'), { status: 'cancelled' }, { merge: true }),
    );
  });

  it('invited staff can read a slot', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher(INVITED_EMAIL)).firestore();
    await assertSucceeds(getDoc(doc(db, 'observationWindows/w1/slots/high-school-2026-05-20-p1')));
  });

  it('non-invited staff cannot read a slot', async () => {
    const db = testEnv.authenticatedContext('o', claims.teacher(OTHER_EMAIL)).firestore();
    await assertFails(getDoc(doc(db, 'observationWindows/w1/slots/high-school-2026-05-20-p1')));
  });

  it('staff cannot write a slot directly', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher(INVITED_EMAIL)).firestore();
    await assertFails(
      setDoc(
        doc(db, 'observationWindows/w1/slots/high-school-2026-05-20-p1'),
        { status: 'booked' },
        { merge: true },
      ),
    );
  });

  it('owner can read their own preference', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher(INVITED_EMAIL)).firestore();
    await assertSucceeds(
      getDoc(doc(db, 'observationWindows/w1/preferences/teacher@orono.k12.mn.us')),
    );
  });

  it('observer can read an invitee preference', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertSucceeds(
      getDoc(doc(db, 'observationWindows/w1/preferences/teacher@orono.k12.mn.us')),
    );
  });

  it('unrelated staff cannot read a preference', async () => {
    const db = testEnv.authenticatedContext('o', claims.teacher(OTHER_EMAIL)).firestore();
    await assertFails(getDoc(doc(db, 'observationWindows/w1/preferences/teacher@orono.k12.mn.us')));
  });

  it('staff cannot write a preference directly', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher(INVITED_EMAIL)).firestore();
    await assertFails(
      setDoc(
        doc(db, 'observationWindows/w1/preferences/teacher@orono.k12.mn.us'),
        { preferredDateYMD: '2026-05-21' },
        { merge: true },
      ),
    );
  });
});
