import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OBSERVATION_STATUS } from '@ops/shared';
import type * as Drive from '../lib/drive.js';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

const SESSION = 'https://www.googleapis.com/upload/drive/v3/files?upload_id=s1';

const h = vi.hoisted(() => ({
  observation: null as Record<string, unknown> | null,
  obsUpdates: [] as unknown[][],
  drive: {
    ensureObservationFolder: vi.fn(),
    shareObservationFolderWithObservers: vi.fn(),
    uploadFileToFolder: vi.fn(),
    startResumableUpload: vi.fn(),
    putResumableChunk: vi.fn(),
    getFileParents: vi.fn(),
    withdrawObservedFolderAccess: vi.fn(),
  },
  checkRateLimit: vi.fn(),
}));

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: () => Promise.resolve({ email: 'obs@x.org' }) }),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: () => ({
      get: () =>
        Promise.resolve({ exists: h.observation !== null, data: () => h.observation ?? undefined }),
      update: (...args: unknown[]) => {
        h.obsUpdates.push(args);
        return Promise.resolve();
      },
    }),
  }),
  FieldValue: { serverTimestamp: () => '__ts__', arrayUnion: (v: unknown) => ['__union__', v] },
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- stands in for FieldPath
  FieldPath: class {
    constructor(...parts: string[]) {
      return parts.join('.');
    }
  },
}));
vi.mock('firebase-functions/params', () => ({
  defineString: () => ({ value: () => 'parent-folder' }),
  defineSecret: () => ({ value: () => '' }),
}));
vi.mock('../lib/drive.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Drive>()),
  DRIVE_SECRETS: [],
  ensureObservationFolder: h.drive.ensureObservationFolder,
  shareObservationFolderWithObservers: h.drive.shareObservationFolderWithObservers,
  uploadFileToFolder: h.drive.uploadFileToFolder,
  startResumableUpload: h.drive.startResumableUpload,
  putResumableChunk: h.drive.putResumableChunk,
  getFileParents: h.drive.getFileParents,
  withdrawObservedFolderAccess: h.drive.withdrawObservedFolderAccess,
}));
vi.mock('../lib/rateLimit.js', () => ({
  RATE_LIMIT_KEYS: { audioUpload: 'audioUpload' },
  loadRateLimits: () => Promise.resolve({ audioUploadsPerHour: 20 }),
  checkRateLimit: h.checkRateLimit,
}));
vi.mock('../lib/callable.js', () => ({
  isDemoEditSession: () => false,
  isDemoStaff: () => Promise.resolve(false),
}));

const { uploadAudio } = await import('./uploadAudio.js');

interface Result {
  status: number;
  body: unknown;
}

function call(headers: Record<string, string>, body: Buffer): Promise<Result> {
  const lower = Object.fromEntries(
    Object.entries({ authorization: 'Bearer t', 'x-observation-id': 'obs1', ...headers }).map(
      ([k, v]) => [k.toLowerCase(), v],
    ),
  );
  return new Promise((resolve) => {
    const result: Result = { status: 200, body: undefined };
    const res = {
      headersSent: false,
      status(code: number) {
        result.status = code;
        return res;
      },
      set: () => res,
      setHeader: () => res,
      getHeader: () => undefined,
      on: () => res,
      send(b: unknown) {
        result.body = b;
        resolve(result);
        return res;
      },
      json(b: unknown) {
        result.body = b;
        resolve(result);
        return res;
      },
      end() {
        resolve(result);
        return res;
      },
    };
    const req = {
      method: 'POST',
      headers: lower,
      header: (name: string) => lower[name.toLowerCase()],
      rawBody: body,
    };
    void (uploadAudio as unknown as (q: unknown, s: unknown) => unknown)(req, res);
  });
}

beforeEach(() => {
  h.observation = {
    observerEmail: 'obs@x.org',
    observedEmail: 't@x.org',
    observedName: 'Jane Doe',
    status: OBSERVATION_STATUS.draft,
    driveFolderId: null,
  };
  h.obsUpdates = [];
  for (const fn of Object.values(h.drive)) fn.mockReset();
  h.drive.ensureObservationFolder.mockResolvedValue('folder1');
  h.drive.startResumableUpload.mockResolvedValue(SESSION);
  h.checkRateLimit.mockReset().mockResolvedValue({ allowed: true, resetAtMs: 0 });
});

describe('uploadAudio in pieces', () => {
  it('opens a Drive upload on the first piece and returns the session', async () => {
    h.drive.putResumableChunk.mockResolvedValue({ done: false, received: 8 });
    const res = await call(
      { 'x-upload-total-bytes': '20', 'x-upload-offset': '0', 'x-audio-mime-type': 'audio/webm' },
      Buffer.alloc(8),
    );
    expect(res).toEqual({
      status: 200,
      body: { status: 'incomplete', uploadSession: SESSION, received: 8 },
    });
    expect(h.drive.startResumableUpload).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'folder1', totalBytes: 20, mimeType: 'audio/webm' }),
    );
    expect(h.checkRateLimit).toHaveBeenCalledTimes(1);
    // The folder is recorded up front so later pieces can check against it.
    expect(h.obsUpdates).toEqual([['driveFolderId', 'folder1']]);
  });

  it('links the file to the observation when the last piece lands in its folder', async () => {
    h.observation = { ...h.observation, driveFolderId: 'folder1' };
    h.drive.putResumableChunk.mockResolvedValue({ done: true, fileId: 'f1', fileName: 'a.webm' });
    h.drive.getFileParents.mockResolvedValue(['folder1']);
    const res = await call(
      { 'x-upload-total-bytes': '20', 'x-upload-offset': '16', 'x-upload-session': SESSION },
      Buffer.alloc(4),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ audioFileId: 'f1' });
    expect(h.drive.startResumableUpload).not.toHaveBeenCalled();
    expect(h.checkRateLimit).not.toHaveBeenCalled();
    expect(h.obsUpdates[0]?.slice(0, 2)).toEqual(['audioDriveFileIds', ['__union__', 'f1']]);
  });

  it('refuses to link a finished file from another folder', async () => {
    h.observation = { ...h.observation, driveFolderId: 'folder1' };
    h.drive.putResumableChunk.mockResolvedValue({ done: true, fileId: 'f1', fileName: 'a.webm' });
    h.drive.getFileParents.mockResolvedValue(['someone-elses-folder']);
    const res = await call(
      { 'x-upload-total-bytes': '20', 'x-upload-offset': '16', 'x-upload-session': SESSION },
      Buffer.alloc(4),
    );
    expect(res.status).toBe(403);
    expect(h.obsUpdates).toEqual([]);
  });

  it('refuses a session URL that is not Drive', async () => {
    const res = await call(
      {
        'x-upload-total-bytes': '20',
        'x-upload-offset': '0',
        'x-upload-session': 'http://169.254.169.254/',
      },
      Buffer.alloc(0),
    );
    expect(res.status).toBe(400);
    expect(h.drive.putResumableChunk).not.toHaveBeenCalled();
  });

  it('refuses files over the size cap', async () => {
    const res = await call(
      { 'x-upload-total-bytes': String(500 * 1024 * 1024), 'x-upload-offset': '0' },
      Buffer.alloc(8),
    );
    expect(res.status).toBe(413);
  });

  it('still accepts a whole file in one request from older clients', async () => {
    h.drive.uploadFileToFolder.mockResolvedValue({ fileId: 'f2', fileName: 'b.webm' });
    const res = await call({}, Buffer.alloc(10));
    expect(res.body).toMatchObject({ audioFileId: 'f2' });
    expect(h.drive.uploadFileToFolder).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'folder1' }),
    );
  });
});

describe('uploadAudio on a reopened observation', () => {
  beforeEach(() => {
    h.observation = { ...h.observation, driveFolderId: 'folder1', pdfDriveFileId: 'pdf1' };
    h.drive.uploadFileToFolder.mockResolvedValue({ fileId: 'f3', fileName: 'c.webm' });
  });

  it("takes back the teacher's folder grant before uploading", async () => {
    h.drive.withdrawObservedFolderAccess.mockResolvedValue(undefined);
    const res = await call({}, Buffer.alloc(10));
    expect(res.body).toMatchObject({ audioFileId: 'f3' });
    expect(h.drive.withdrawObservedFolderAccess).toHaveBeenCalledWith({
      folderId: 'folder1',
      parentFolderId: 'parent-folder',
      observedEmail: 't@x.org',
      pdfDriveFileId: 'pdf1',
    });
    const withdrawOrder = h.drive.withdrawObservedFolderAccess.mock.invocationCallOrder[0] ?? 0;
    const uploadOrder = h.drive.uploadFileToFolder.mock.invocationCallOrder[0] ?? 0;
    expect(withdrawOrder).toBeLessThan(uploadOrder);
  });

  it('uploads nothing when the grant cannot be taken back', async () => {
    h.drive.withdrawObservedFolderAccess.mockRejectedValue(new Error('drive down'));
    const res = await call({}, Buffer.alloc(10));
    expect(res.status).toBe(500);
    expect(h.drive.uploadFileToFolder).not.toHaveBeenCalled();
  });

  it('leaves a never-finalized Draft alone', async () => {
    h.observation = { ...h.observation, pdfDriveFileId: null };
    await call({}, Buffer.alloc(10));
    expect(h.drive.withdrawObservedFolderAccess).not.toHaveBeenCalled();
  });
});
