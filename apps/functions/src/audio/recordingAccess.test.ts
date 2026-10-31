import { describe, expect, it } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';
import type { RecordingObservation } from './recordingAccess.js';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';
const { canReadRecording, requireObserverOnDraft, requireRecording, requireRecordingReader } =
  await import('./recordingAccess.js');

const OBSERVER = 'pe@orono.k12.mn.us';
const OBSERVED = 'teacher@orono.k12.mn.us';

const obs = (over: Partial<RecordingObservation> = {}): RecordingObservation => ({
  observerEmail: OBSERVER,
  observedEmail: OBSERVED,
  status: 'Draft',
  audioDriveFileIds: ['file_A-1'],
  ...over,
});

/** A Firestore stub whose only /staff doc read returns `staff`. */
function dbWithStaff(staff: Record<string, unknown> | null): Firestore {
  return {
    doc: () => ({ get: () => Promise.resolve({ exists: staff !== null, data: () => staff }) }),
  } as unknown as Firestore;
}

function request(role: string | undefined): CallableRequest {
  return { auth: { token: { role } } } as unknown as CallableRequest;
}

describe('requireRecording', () => {
  it('accepts a recording on the observation', () => {
    expect(() => requireRecording(obs(), 'file_A-1')).not.toThrow();
  });

  it('rejects an id that is not on the observation or is not a Drive id', () => {
    expect(() => requireRecording(obs(), 'other')).toThrow(/not part of this observation/);
    expect(() => requireRecording(obs({ audioDriveFileIds: ['a.b'] }), 'a.b')).toThrow(
      /not part of this observation/,
    );
    const legacy = obs();
    delete legacy.audioDriveFileIds;
    expect(() => requireRecording(legacy, 'file_A-1')).toThrow();
  });
});

describe('requireObserverOnDraft', () => {
  it('lets the observer edit a Draft', () => {
    expect(() => requireObserverOnDraft(obs(), OBSERVER)).not.toThrow();
  });

  it('refuses anyone else, and a Finalized observation', () => {
    expect(() => requireObserverOnDraft(obs(), OBSERVED)).toThrow(/Only the observer/);
    expect(() => requireObserverOnDraft(obs({ status: 'Finalized' }), OBSERVER)).toThrow(
      /only be changed on a Draft/,
    );
  });
});

describe('requireRecordingReader', () => {
  it('allows the observer', async () => {
    await expect(
      requireRecordingReader(dbWithStaff(null), request('teacher'), obs(), OBSERVER),
    ).resolves.toBeUndefined();
  });

  it('allows the observed staff member only once finalized', async () => {
    await expect(
      requireRecordingReader(dbWithStaff(null), request('teacher'), obs(), OBSERVED),
    ).rejects.toThrow(/Not authorized/);
    await expect(
      requireRecordingReader(
        dbWithStaff(null),
        request('teacher'),
        obs({ status: 'Finalized' }),
        OBSERVED,
      ),
    ).resolves.toBeUndefined();
  });

  it('allows oversight and co-observers, not other PEs, building admins or staff', async () => {
    const other = 'someone@orono.k12.mn.us';
    await expect(
      requireRecordingReader(dbWithStaff(null), request('full-access'), obs(), other),
    ).resolves.toBeUndefined();
    await expect(
      requireRecordingReader(
        dbWithStaff(null),
        request('administrator'),
        { ...obs(), coObserverEmails: [other] },
        other,
      ),
    ).resolves.toBeUndefined();
    await expect(
      requireRecordingReader(
        dbWithStaff({ role: 'peer-evaluator' }),
        request('peer-evaluator'),
        obs(),
        other,
      ),
    ).rejects.toThrow(/Not authorized/);
    await expect(
      requireRecordingReader(
        dbWithStaff({ role: 'administrator' }),
        request('administrator'),
        obs(),
        other,
      ),
    ).rejects.toThrow(/Not authorized/);
    await expect(
      requireRecordingReader(dbWithStaff({ role: 'teacher' }), request('teacher'), obs(), other),
    ).rejects.toThrow(/Not authorized/);
  });
});

describe('canReadRecording in a demo-edit session (View As + Edit)', () => {
  const demoAuth = {
    token: { email: OBSERVER, role: 'peer-evaluator', demoEditBy: 'viewer@x.org' },
  };

  it("can't play a real teacher's recording, even the observer's own", async () => {
    await expect(canReadRecording(dbWithStaff({}), obs(), OBSERVER, demoAuth)).resolves.toBe(false);
  });

  it("can play a demo person's recording", async () => {
    await expect(
      canReadRecording(dbWithStaff({ isDemo: true }), obs(), OBSERVER, demoAuth),
    ).resolves.toBe(true);
  });
});

describe('canReadRecording for archived staff', () => {
  const archived = dbWithStaff({ role: 'teacher', isActive: false });
  const auth = (email: string) => ({ token: { email, role: 'teacher' } });

  it('refuses an archived observer or co-observer', async () => {
    const co = 'co@orono.k12.mn.us';
    const shared = obs({ coObserverEmails: [co], status: 'Finalized' });
    await expect(canReadRecording(archived, shared, OBSERVER, auth(OBSERVER))).resolves.toBe(false);
    await expect(canReadRecording(archived, shared, co, auth(co))).resolves.toBe(false);
  });

  it('lets an archived teacher play their own finalized recording, not a Draft one', async () => {
    await expect(
      canReadRecording(archived, obs({ status: 'Finalized' }), OBSERVED, auth(OBSERVED)),
    ).resolves.toBe(true);
    await expect(canReadRecording(archived, obs(), OBSERVED, auth(OBSERVED))).resolves.toBe(false);
  });
});

describe('canReadRecording in a demo-edit session whose driver was archived', () => {
  it("can't play a demo person's finalized recording, even as the observed", async () => {
    const DRIVER = 'viewer@orono.k12.mn.us';
    // The driver's doc is archived; the demo person's (same stub) is demo staff.
    const db = dbWithStaff({ isDemo: true, isActive: false });
    const demoAuth = (email: string) => ({ token: { email, role: 'teacher', demoEditBy: DRIVER } });
    const finalized = obs({ status: 'Finalized' });
    await expect(canReadRecording(db, finalized, OBSERVED, demoAuth(OBSERVED))).resolves.toBe(
      false,
    );
    await expect(canReadRecording(db, finalized, OBSERVER, demoAuth(OBSERVER))).resolves.toBe(
      false,
    );
  });
});
