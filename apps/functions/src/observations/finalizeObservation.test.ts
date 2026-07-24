import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { COLLECTIONS, OBSERVATION_STATUS, OBSERVATION_TYPES } from '@ops/shared';

type Fn = ((...args: unknown[]) => unknown) | undefined;

interface HState {
  db: unknown;
  parentFolderId: string;
  drive: {
    ensureObservationFolder: Fn;
    getDriveLinks: Fn;
    replaceFileContent: Fn;
    shareWithUser: Fn;
    uploadFileToFolder: Fn;
  };
  renderObservationPdf: Fn;
  sendTemplatedEmail: Fn;
}

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

// ---------------------------------------------------------------------------
// Hoisted test state read by the module mocks below.
// ---------------------------------------------------------------------------
const h = vi.hoisted(
  (): HState => ({
    db: undefined,
    parentFolderId: 'parent-folder-id',
    drive: {
      ensureObservationFolder: undefined,
      getDriveLinks: undefined,
      replaceFileContent: undefined,
      shareWithUser: undefined,
      uploadFileToFolder: undefined,
    },
    renderObservationPdf: undefined,
    sendTemplatedEmail: undefined,
  }),
);

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => h.db,
  FieldValue: {
    serverTimestamp: () => '__server_ts__',
    delete: () => '__delete__',
  },
}));

vi.mock('firebase-functions/params', () => ({
  defineString: () => ({ value: () => h.parentFolderId }),
}));

vi.mock('../lib/drive.js', () => ({
  ensureObservationFolder: (...a: unknown[]) => h.drive.ensureObservationFolder?.(...a),
  getDriveLinks: (...a: unknown[]) => h.drive.getDriveLinks?.(...a),
  replaceFileContent: (...a: unknown[]) => h.drive.replaceFileContent?.(...a),
  shareWithUser: (...a: unknown[]) => h.drive.shareWithUser?.(...a),
  uploadFileToFolder: (...a: unknown[]) => h.drive.uploadFileToFolder?.(...a),
}));

vi.mock('../lib/pdfRenderer.js', () => ({
  renderObservationPdf: (...a: unknown[]) => h.renderObservationPdf?.(...a),
}));

vi.mock('../lib/emailUtils.js', () => ({
  formatDate: () => 'formatted-date',
  sendTemplatedEmail: (...a: unknown[]) => h.sendTemplatedEmail?.(...a),
}));

const { finalizeObservation } = await import('./finalizeObservation.js');

const run = (req: Partial<CallableRequest>) =>
  (finalizeObservation as unknown as { run: (r: unknown) => Promise<unknown> }).run(req);

// ---------------------------------------------------------------------------
// Configurable in-memory Firestore fake
// ---------------------------------------------------------------------------

interface DbConfig {
  /** Current observation doc data (null → not found). */
  observation: Record<string, unknown> | null;
  /** Docs keyed by full path for db.doc(path).get(). */
  docs?: Record<string, Record<string, unknown> | undefined>;
  /** Rows for db.collection('roles') queries. */
  roles?: (Record<string, unknown> & { id?: string })[];
  /** Rows for db.collection('workProductQuestions') queries. */
  questions?: Record<string, unknown>[];
}

interface Recorder {
  obsUpdates: Record<string, unknown>[];
  auditAdds: Record<string, unknown>[];
  txUpdates: Record<string, unknown>[];
}

function buildDb(config: DbConfig): { db: unknown; rec: Recorder } {
  const rec: Recorder = { obsUpdates: [], auditAdds: [], txUpdates: [] };
  const obsPath = `${COLLECTIONS.observations}/obs-1`;
  const obsState = { data: config.observation };

  const obsRef = {
    _path: obsPath,
    get: () =>
      Promise.resolve({
        exists: obsState.data !== null,
        id: 'obs-1',
        data: () => obsState.data ?? undefined,
      }),
    update: (patch: Record<string, unknown>) => {
      rec.obsUpdates.push(patch);
      return Promise.resolve();
    },
  };

  function collection(name: string) {
    const filters: [string, unknown][] = [];
    const q = {
      where(field: string, _op: string, val: unknown) {
        filters.push([field, val]);
        return q;
      },
      limit() {
        return q;
      },
      get: () => {
        let rows: (Record<string, unknown> & { id?: string })[] =
          name === COLLECTIONS.roles
            ? (config.roles ?? [])
            : name === COLLECTIONS.workProductQuestions
              ? (config.questions ?? [])
              : [];
        for (const [f, v] of filters) rows = rows.filter((r) => r[f] === v);
        const docs = rows.map((r) => ({ id: r.id ?? 'doc', data: () => r }));
        return Promise.resolve({ empty: docs.length === 0, docs });
      },
      add: (data: Record<string, unknown>) => {
        if (name === COLLECTIONS.auditLog) rec.auditAdds.push(data);
        return Promise.resolve({ id: 'audit-1' });
      },
    };
    return q;
  }

  function doc(path: string) {
    if (path === obsPath) return obsRef;
    return {
      get: () => {
        const data = config.docs?.[path];
        return Promise.resolve({ exists: data !== undefined, data: () => data });
      },
    };
  }

  function runTransaction(fn: (tx: unknown) => Promise<unknown>) {
    const tx = {
      get: (ref: { get: () => Promise<unknown> }) => ref.get(),
      update: (_ref: unknown, patch: Record<string, unknown>) => {
        rec.txUpdates.push(patch);
      },
    };
    return fn(tx);
  }

  return { db: { collection, doc, runTransaction }, rec };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OBSERVER = 'observer@orono.k12.mn.us';
const OBSERVED = 'observed@orono.k12.mn.us';

function draftObservation(over: Record<string, unknown> = {}) {
  return {
    status: OBSERVATION_STATUS.draft,
    type: OBSERVATION_TYPES.standard,
    observerEmail: OBSERVER,
    observedEmail: OBSERVED,
    observedName: 'Observed Person',
    observedRole: 'teacher',
    observedYear: 1,
    observationName: 'Spring Visit',
    observationDate: new Date('2026-04-01'),
    ...over,
  };
}

function observerRequest(over: Record<string, unknown> = {}): Partial<CallableRequest> {
  return {
    auth: { uid: 'uid-1', token: { email: OVERRIDE_EMAIL ?? OBSERVER } },
    data: { observationId: 'obs-1' },
    ...over,
  } as unknown as Partial<CallableRequest>;
}

let OVERRIDE_EMAIL: string | null = null;

/** Happy-path db: observer/observed match, one role, rubric present, no mapping. */
function happyConfig(obsOver: Record<string, unknown> = {}): DbConfig {
  return {
    observation: draftObservation(obsOver),
    roles: [{ id: 'r1', roleId: 'teacher', displayName: 'Teacher', rubricId: 'rubric-1' }],
    docs: {
      [`${COLLECTIONS.rubrics}/rubric-1`]: {
        rubricId: 'rubric-1',
        displayName: 'Teaching Rubric',
        domains: [{ id: 'd1', components: [{ id: 'c1' }] }],
      },
      [`${COLLECTIONS.appSettings}/app`]: {},
    },
  };
}

function installHappyDrive() {
  h.drive.ensureObservationFolder = vi.fn().mockResolvedValue('folder-1');
  h.drive.uploadFileToFolder = vi.fn().mockResolvedValue({ fileId: 'pdf-1' });
  h.drive.replaceFileContent = vi.fn().mockResolvedValue(null);
  h.drive.shareWithUser = vi.fn().mockResolvedValue(undefined);
  h.drive.getDriveLinks = vi.fn().mockResolvedValue({ webViewLink: 'https://drive/view/pdf-1' });
  h.renderObservationPdf = vi.fn().mockResolvedValue(Buffer.from('pdf'));
  h.sendTemplatedEmail = vi.fn().mockResolvedValue(true);
}

beforeEach(() => {
  OVERRIDE_EMAIL = null;
  h.parentFolderId = 'parent-folder-id';
  installHappyDrive();
});

// ---------------------------------------------------------------------------
// Guard branches (before the finalize claim)
// ---------------------------------------------------------------------------

describe('finalizeObservation — input & auth guards', () => {
  it('rejects an unauthenticated call', async () => {
    const { db } = buildDb(happyConfig());
    h.db = db;
    await expect(run({ data: { observationId: 'obs-1' } })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('rejects a token with no email', async () => {
    const { db } = buildDb(happyConfig());
    h.db = db;
    await expect(
      run({ auth: { uid: 'u', token: {} }, data: { observationId: 'obs-1' } } as never),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a missing observationId', async () => {
    const { db } = buildDb(happyConfig());
    h.db = db;
    await expect(
      run({ auth: { uid: 'u', token: { email: OBSERVER } }, data: {} } as never),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('returns not-found when the observation does not exist', async () => {
    const { db } = buildDb({ ...happyConfig(), observation: null });
    h.db = db;
    await expect(run(observerRequest())).rejects.toMatchObject({ code: 'not-found' });
  });

  it('denies a non-observer, non-admin caller', async () => {
    OVERRIDE_EMAIL = 'stranger@orono.k12.mn.us';
    const { db } = buildDb(happyConfig());
    h.db = db;
    await expect(run(observerRequest())).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

// ---------------------------------------------------------------------------
// Finalize-claim transaction branches
// ---------------------------------------------------------------------------

describe('finalizeObservation — claim transaction', () => {
  it('rejects an observation that is already finalized', async () => {
    const { db, rec } = buildDb(happyConfig({ status: OBSERVATION_STATUS.finalized }));
    h.db = db;
    await expect(run(observerRequest())).rejects.toMatchObject({ code: 'failed-precondition' });
    // no claim write should happen once the observation is already finalized
    expect(rec.txUpdates).toHaveLength(0);
  });

  it('rejects when another finalize claim is still fresh', async () => {
    const recentClaim = { toMillis: () => Date.now() - 1000 };
    const { db, rec } = buildDb(happyConfig({ finalizeStartedAt: recentClaim }));
    h.db = db;
    await expect(run(observerRequest())).rejects.toMatchObject({ code: 'failed-precondition' });
    // no claim write should happen while another claim is still fresh
    expect(rec.txUpdates).toHaveLength(0);
  });

  it('allows a retry when the prior claim is older than the TTL', async () => {
    const staleClaim = { toMillis: () => Date.now() - 11 * 60 * 1000 };
    const { db, rec } = buildDb(happyConfig({ finalizeStartedAt: staleClaim }));
    h.db = db;
    await expect(run(observerRequest())).resolves.toMatchObject({ pdfDriveFileId: 'pdf-1' });
    // the retry re-claims the observation via the transaction
    expect(rec.txUpdates).toContainEqual({ finalizeStartedAt: '__server_ts__' });
  });
});

// ---------------------------------------------------------------------------
// Happy path & downstream failures
// ---------------------------------------------------------------------------

describe('finalizeObservation — finalize flow', () => {
  it('finalizes: renders, uploads, shares, flips status, audits, emails', async () => {
    const { db, rec } = buildDb(happyConfig());
    h.db = db;
    const result = await run(observerRequest());

    expect(result).toEqual({
      pdfDriveFileId: 'pdf-1',
      driveFolderId: 'folder-1',
      pdfWebViewLink: 'https://drive/view/pdf-1',
    });
    // the finalize claim transaction stamped a fresh finalizeStartedAt
    expect(rec.txUpdates).toContainEqual({ finalizeStartedAt: '__server_ts__' });
    // shared the folder (not the file) with the observed staff as reader
    expect(h.drive.shareWithUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: OBSERVED, role: 'reader', sendNotificationEmail: false }),
    );
    // final status flip
    const finalUpdate = rec.obsUpdates.find((u) => u['status'] === OBSERVATION_STATUS.finalized);
    expect(finalUpdate).toBeDefined();
    expect(finalUpdate?.['pdfDriveFileId']).toBe('pdf-1');
    // audit entry
    expect(rec.auditAdds[0]?.['action']).toBe('observation.finalize');
    // email sent
    expect(h.sendTemplatedEmail).toHaveBeenCalledOnce();
  });

  it('replaces the existing PDF in place on re-finalize (stable fileId)', async () => {
    h.drive.replaceFileContent = vi.fn().mockResolvedValue('pdf-existing');
    const { db } = buildDb(happyConfig({ pdfDriveFileId: 'pdf-existing' }));
    h.db = db;
    const result = await run(observerRequest());
    expect(h.drive.replaceFileContent).toHaveBeenCalled();
    expect(h.drive.uploadFileToFolder).not.toHaveBeenCalled();
    expect(result).toMatchObject({ pdfDriveFileId: 'pdf-existing' });
  });

  it('permits an admin who is not the observer to finalize', async () => {
    OVERRIDE_EMAIL = 'admin@orono.k12.mn.us';
    const { db } = buildDb(happyConfig());
    h.db = db;
    const req = {
      auth: { uid: 'a', token: { email: 'admin@orono.k12.mn.us', role: 'administrator' } },
      data: { observationId: 'obs-1' },
    } as never;
    await expect(run(req)).resolves.toMatchObject({ pdfDriveFileId: 'pdf-1' });
  });

  it('maps a PDF render failure to an internal error and clears the claim', async () => {
    h.renderObservationPdf = vi.fn().mockRejectedValue(new Error('renderer down'));
    const { db, rec } = buildDb(happyConfig());
    h.db = db;
    await expect(run(observerRequest())).rejects.toMatchObject({ code: 'internal' });
    // claim cleared so the user can retry
    expect(rec.obsUpdates.some((u) => u['finalizeStartedAt'] === '__delete__')).toBe(true);
  });

  it('fails with failed-precondition when no matching role exists', async () => {
    const cfg = happyConfig();
    cfg.roles = [];
    const { db, rec } = buildDb(cfg);
    h.db = db;
    await expect(run(observerRequest())).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(rec.obsUpdates.some((u) => u['finalizeStartedAt'] === '__delete__')).toBe(true);
  });

  it('fails with failed-precondition when the parent Drive folder is unconfigured', async () => {
    h.parentFolderId = '';
    const { db } = buildDb(happyConfig());
    h.db = db;
    await expect(run(observerRequest())).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('still finalizes when the finalized email throws (non-fatal)', async () => {
    h.sendTemplatedEmail = vi.fn().mockRejectedValue(new Error('mail down'));
    const { db } = buildDb(happyConfig());
    h.db = db;
    await expect(run(observerRequest())).resolves.toMatchObject({ pdfDriveFileId: 'pdf-1' });
  });
});
