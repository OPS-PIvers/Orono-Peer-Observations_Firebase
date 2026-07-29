import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { COLLECTIONS, OBSERVATION_STATUS } from '@ops/shared';

type Fn = ((...args: unknown[]) => unknown) | undefined;

interface HState {
  db: unknown;
  parentFolderId: string;
  drive: {
    ensureObservationFolder: Fn;
    getDriveLinks: Fn;
    shareObservationFolderWithObserver: Fn;
    shareWithUser: Fn;
    uploadFileToFolder: Fn;
    deleteDriveFile: Fn;
  };
  renderObservationPdf: Fn;
  loadRateLimits: Fn;
  checkRateLimit: Fn;
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
      shareObservationFolderWithObserver: undefined,
      shareWithUser: undefined,
      uploadFileToFolder: undefined,
      deleteDriveFile: undefined,
    },
    renderObservationPdf: undefined,
    loadRateLimits: undefined,
    checkRateLimit: undefined,
  }),
);

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => h.db,
  FieldValue: { serverTimestamp: () => '__server_ts__' },
}));

vi.mock('firebase-functions/params', () => ({
  defineString: () => ({ value: () => h.parentFolderId }),
}));

vi.mock('../lib/drive.js', () => ({
  ensureObservationFolder: (...a: unknown[]) => h.drive.ensureObservationFolder?.(...a),
  getDriveLinks: (...a: unknown[]) => h.drive.getDriveLinks?.(...a),
  shareObservationFolderWithObserver: (...a: unknown[]) =>
    h.drive.shareObservationFolderWithObserver?.(...a),
  shareWithUser: (...a: unknown[]) => h.drive.shareWithUser?.(...a),
  uploadFileToFolder: (...a: unknown[]) => h.drive.uploadFileToFolder?.(...a),
  deleteDriveFile: (...a: unknown[]) => h.drive.deleteDriveFile?.(...a),
}));

vi.mock('../lib/pdfRenderer.js', () => ({
  renderObservationPdf: (...a: unknown[]) => h.renderObservationPdf?.(...a),
}));

// The fixed-window limiter itself is unit-tested in rateLimit.test.ts — here
// we only need to control what it decides for this callable's integration.
vi.mock('../lib/rateLimit.js', () => ({
  RATE_LIMIT_KEYS: { pdfRegeneration: 'pdfRegeneration' },
  loadRateLimits: (...a: unknown[]) => h.loadRateLimits?.(...a),
  checkRateLimit: (...a: unknown[]) => h.checkRateLimit?.(...a),
}));

const { regenerateObservationPdf } = await import('./regenerateObservationPdf.js');

const run = (req: Partial<CallableRequest>) =>
  (regenerateObservationPdf as unknown as { run: (r: unknown) => Promise<unknown> }).run(req);

// ---------------------------------------------------------------------------
// Configurable in-memory Firestore fake
// ---------------------------------------------------------------------------

interface DbConfig {
  observation: Record<string, unknown> | null;
  role?: Record<string, unknown> & { id: string };
  rubric?: Record<string, unknown>;
  mapping?: Record<string, unknown> | null;
}

interface Recorder {
  obsUpdates: Record<string, unknown>[];
  auditAdds: Record<string, unknown>[];
}

function buildDb(config: DbConfig): { db: unknown; rec: Recorder } {
  const rec: Recorder = { obsUpdates: [], auditAdds: [] };
  const obsPath = `${COLLECTIONS.observations}/obs-1`;
  const obsState = { data: config.observation };

  const obsRef = {
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

  function doc(path: string) {
    if (path === obsPath) return obsRef;
    if (config.rubric && path.startsWith(`${COLLECTIONS.rubrics}/`)) {
      return {
        get: () =>
          Promise.resolve({
            exists: true,
            id: path.split('/')[1],
            data: () => config.rubric,
          }),
      };
    }
    if (path.startsWith(`${COLLECTIONS.roleYearMappings}/`)) {
      return {
        get: () =>
          Promise.resolve({
            exists: config.mapping !== undefined && config.mapping !== null,
            data: () => config.mapping ?? undefined,
          }),
      };
    }
    return { get: () => Promise.resolve({ exists: false, data: () => undefined }) };
  }

  function collection(name: string) {
    return {
      doc: (id: string) => ({
        get: () => {
          if (name === COLLECTIONS.roles && config.role?.id === id) {
            return Promise.resolve({ exists: true, id, data: () => config.role });
          }
          return Promise.resolve({ exists: false, data: () => undefined });
        },
      }),
      where: () => ({ limit: () => ({ get: () => Promise.resolve({ empty: true, docs: [] }) }) }),
      add: (data: Record<string, unknown>) => {
        if (name === COLLECTIONS.auditLog) rec.auditAdds.push(data);
        return Promise.resolve({ id: 'audit-1' });
      },
    };
  }

  return { db: { collection, doc }, rec };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OBSERVER = 'observer@orono.k12.mn.us';
const OBSERVED = 'observed@orono.k12.mn.us';

function finalizedObservation(over: Record<string, unknown> = {}) {
  return {
    status: OBSERVATION_STATUS.finalized,
    observerEmail: OBSERVER,
    observedEmail: OBSERVED,
    observedName: 'Observed Person',
    observedRole: 'teacher',
    observedYear: 1,
    pdfDriveFileId: 'pdf-old',
    driveFolderId: 'folder-1',
    ...over,
  };
}

function observerRequest(over: Record<string, unknown> = {}): Partial<CallableRequest> {
  return {
    auth: { uid: 'uid-1', token: { email: OBSERVER } },
    data: { observationId: 'obs-1' },
    ...over,
  } as unknown as Partial<CallableRequest>;
}

function happyConfig(obsOver: Record<string, unknown> = {}): DbConfig {
  return {
    observation: finalizedObservation(obsOver),
    role: { id: 'teacher', roleId: 'teacher', displayName: 'Teacher', rubricId: 'rubric-1' },
    rubric: { rubricId: 'rubric-1', displayName: 'Teaching Rubric', domains: [] },
    mapping: null,
  };
}

function installHappyDrive() {
  h.drive.ensureObservationFolder = vi.fn().mockResolvedValue('folder-1');
  h.drive.uploadFileToFolder = vi.fn().mockResolvedValue({ fileId: 'pdf-new' });
  h.drive.shareWithUser = vi.fn().mockResolvedValue(undefined);
  h.drive.shareObservationFolderWithObserver = vi.fn().mockResolvedValue(undefined);
  h.drive.getDriveLinks = vi.fn().mockResolvedValue({ webViewLink: 'https://drive/view/pdf-new' });
  h.drive.deleteDriveFile = vi.fn().mockResolvedValue(undefined);
  h.renderObservationPdf = vi.fn().mockResolvedValue(Buffer.from('pdf'));
}

/** Allowed by default so happy-path tests don't need to set this up. */
function installAllowingRateLimit() {
  h.loadRateLimits = vi.fn().mockResolvedValue({ pdfRegenerationsPerHour: 10 });
  h.checkRateLimit = vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 9, resetAtMs: Date.now() + 1000 });
}

beforeEach(() => {
  h.parentFolderId = 'parent-folder-id';
  installHappyDrive();
  installAllowingRateLimit();
});

describe('regenerateObservationPdf — rate limiting', () => {
  it('proceeds to render when the limiter allows the request', async () => {
    const { db, rec } = buildDb(happyConfig());
    h.db = db;
    const result = await run(observerRequest());

    expect(result).toEqual({
      pdfDriveFileId: 'pdf-new',
      driveFolderId: 'folder-1',
      pdfWebViewLink: 'https://drive/view/pdf-new',
    });
    expect(h.checkRateLimit).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        userEmail: OBSERVER,
        key: 'pdfRegeneration',
        max: 10,
        windowMs: 60 * 60 * 1000,
      }),
    );
    expect(rec.auditAdds.some((a) => a['action'] === 'pdf_regenerated')).toBe(true);
  });

  it('denies with resource-exhausted and audits the trip once the hourly limit is reached', async () => {
    h.checkRateLimit = vi
      .fn()
      .mockResolvedValue({ allowed: false, remaining: 0, resetAtMs: Date.now() + 1000 });
    const { db, rec } = buildDb(happyConfig());
    h.db = db;

    await expect(run(observerRequest())).rejects.toMatchObject({ code: 'resource-exhausted' });

    // No rendering/Drive work should have happened once denied.
    expect(h.renderObservationPdf).not.toHaveBeenCalled();
    expect(h.drive.uploadFileToFolder).not.toHaveBeenCalled();
    expect(rec.obsUpdates).toHaveLength(0);

    // The trip is audited with the rate_limit_tripped action.
    const tripAudit = rec.auditAdds.find((a) => a['action'] === 'rate_limit_tripped');
    expect(tripAudit).toBeDefined();
    expect(tripAudit?.['userEmail']).toBe(OBSERVER);
    expect(tripAudit?.['target']).toBe(`${COLLECTIONS.observations}/obs-1`);
  });

  it('fails open (still regenerates) when the limiter itself throws', async () => {
    h.loadRateLimits = vi.fn().mockRejectedValue(new Error('firestore unavailable'));
    const { db } = buildDb(happyConfig());
    h.db = db;

    await expect(run(observerRequest())).resolves.toMatchObject({ pdfDriveFileId: 'pdf-new' });
    expect(h.renderObservationPdf).toHaveBeenCalled();
  });

  it('does not consult the limiter before the existing observer-or-admin guard', async () => {
    const { db } = buildDb(happyConfig());
    h.db = db;
    const stranger = {
      auth: { uid: 'u', token: { email: 'stranger@orono.k12.mn.us' } },
      data: { observationId: 'obs-1' },
    } as unknown as Partial<CallableRequest>;

    await expect(run(stranger)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(h.checkRateLimit).not.toHaveBeenCalled();
  });
});
