import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
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
    const db = testEnv.authenticatedContext('a', claims.fullAccess()).firestore();
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
    const db = testEnv.authenticatedContext('a', claims.fullAccess()).firestore();
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

  // Windows are created only by the createObservationWindow callable (Admin
  // SDK), which writes the shape the scheduling jobs depend on.
  it('PE cannot create a window from the client, even one they observe', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(
      setDoc(doc(db, 'observationWindows/w2'), {
        windowId: 'w2',
        observerEmail: PE_EMAIL,
        bookingMode: 'direct',
        invitedEmails: [],
        status: 'open',
      }),
    );
  });

  it('PE cannot plant a malformed window doc', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(
      setDoc(doc(db, 'observationWindows/!poison'), {
        observerEmail: PE_EMAIL,
        status: 'open',
        endDate: '2099-12-31',
        invitees: 1,
      }),
    );
  });

  it('building Administrator and Full Access cannot create a window from the client', async () => {
    const ADMIN_EMAIL = 'admin@orono.k12.mn.us';
    const FULL_EMAIL = 'full@orono.k12.mn.us';
    const base = { bookingMode: 'direct', invitedEmails: [], status: 'open' };
    const adminDb = testEnv.authenticatedContext('adm', claims.admin(ADMIN_EMAIL)).firestore();
    await assertFails(
      setDoc(doc(adminDb, 'observationWindows/adm-std'), {
        ...base,
        windowId: 'adm-std',
        observerEmail: ADMIN_EMAIL,
        defaultObservationType: 'Standard',
      }),
    );
    const fullDb = testEnv.authenticatedContext('full', claims.fullAccess(FULL_EMAIL)).firestore();
    await assertFails(
      setDoc(doc(fullDb, 'observationWindows/full-1'), {
        ...base,
        windowId: 'full-1',
        observerEmail: FULL_EMAIL,
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

  it('Full Access (oversight) can still change any window field directly', async () => {
    const db = testEnv.authenticatedContext('fa', claims.fullAccess()).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'observationWindows/w1'), { status: 'cancelled' }, { merge: true }),
    );
  });

  it("building Administrators and Admin Console users CANNOT change someone else's window", async () => {
    const admin = testEnv.authenticatedContext('a', claims.admin()).firestore();
    await assertFails(
      setDoc(doc(admin, 'observationWindows/w1'), { status: 'cancelled' }, { merge: true }),
    );
    const consolePe = testEnv
      .authenticatedContext('cpe', {
        ...claims.peerEval('consolepe@orono.k12.mn.us'),
        isAdmin: true,
      })
      .firestore();
    await assertFails(
      setDoc(doc(consolePe, 'observationWindows/w1'), { status: 'cancelled' }, { merge: true }),
    );
    await assertFails(deleteDoc(doc(consolePe, 'observationWindows/w1')));
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

describe('windowInviteViews rules', () => {
  beforeEach(async () => {
    await seed(`windowInviteViews/w1_${INVITED_EMAIL}`, {
      windowId: 'w1',
      email: INVITED_EMAIL,
      status: 'open',
      entries: [{ buildingId: 'high-school', inviteToken: 'tok', bookedSlotId: null }],
    });
    await seed(`windowInviteViews/w1_${OTHER_EMAIL}`, {
      windowId: 'w1',
      email: OTHER_EMAIL,
      status: 'open',
      entries: [{ buildingId: 'high-school', inviteToken: 'tok-other', bookedSlotId: 's1' }],
    });
  });

  it('an invitee can read their own view', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher(INVITED_EMAIL)).firestore();
    await assertSucceeds(getDoc(doc(db, `windowInviteViews/w1_${INVITED_EMAIL}`)));
  });

  it('an invitee cannot read a co-invitee’s view', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher(INVITED_EMAIL)).firestore();
    await assertFails(getDoc(doc(db, `windowInviteViews/w1_${OTHER_EMAIL}`)));
  });

  it('the dashboard query for your own email succeeds; an unfiltered list fails', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher(INVITED_EMAIL)).firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(db, 'windowInviteViews'),
          where('email', '==', INVITED_EMAIL),
          where('status', 'in', ['open', 'partially-booked', 'fully-booked', 'expired']),
        ),
      ),
    );
    await assertFails(getDocs(collection(db, 'windowInviteViews')));
    await assertFails(
      getDocs(query(collection(db, 'windowInviteViews'), where('email', '==', OTHER_EMAIL))),
    );
  });

  it('an invitee can get their own view id before it exists (not-found, not denied)', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher(INVITED_EMAIL)).firestore();
    await assertSucceeds(getDoc(doc(db, `windowInviteViews/w2_${INVITED_EMAIL}`)));
  });

  it('nobody can probe someone else’s missing view id', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher(INVITED_EMAIL)).firestore();
    await assertFails(getDoc(doc(db, `windowInviteViews/w2_${OTHER_EMAIL}`)));
    // A suffix match alone is not enough: the id must end in "_" + the caller's email.
    await assertFails(getDoc(doc(db, `windowInviteViews/w2x${INVITED_EMAIL}`)));
  });

  it('a stored view whose email is not the caller’s is denied even under a matching id', async () => {
    await seed(`windowInviteViews/w3_${INVITED_EMAIL}`, {
      windowId: 'w3',
      email: OTHER_EMAIL,
      status: 'open',
      entries: [],
    });
    const db = testEnv.authenticatedContext('t', claims.teacher(INVITED_EMAIL)).firestore();
    await assertFails(getDoc(doc(db, `windowInviteViews/w3_${INVITED_EMAIL}`)));
  });

  it('special access can read any view (evaluator checklist)', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertSucceeds(getDoc(doc(db, `windowInviteViews/w1_${OTHER_EMAIL}`)));
  });

  it('nobody writes a view from the client', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher(INVITED_EMAIL)).firestore();
    await assertFails(
      setDoc(doc(db, `windowInviteViews/w1_${INVITED_EMAIL}`), { email: INVITED_EMAIL }),
    );
    const pe = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(setDoc(doc(pe, `windowInviteViews/w2_${PE_EMAIL}`), { email: PE_EMAIL }));
  });
});
