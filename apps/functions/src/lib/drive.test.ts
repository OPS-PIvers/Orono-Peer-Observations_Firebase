import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ResumableUploadGoneError,
  deleteObservationFolder,
  ensureObservationFolder,
  isResumableSessionUrl,
  parseResumableResponse,
} from './drive.js';

// A fake Drive client behind the real getDriveClient, so the folder guards are
// tested together with the getFileParents/deleteDriveFolder calls they make.
const h = vi.hoisted(() => ({
  files: { get: vi.fn(), list: vi.fn(), delete: vi.fn(), create: vi.fn() },
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('firebase-functions', () => ({ logger: h.logger }));
vi.mock('firebase-functions/params', () => ({
  defineString: () => ({ value: () => 'client-id' }),
  defineSecret: () => ({ value: () => 'refresh-token' }),
}));
vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials = vi.fn();
        getAccessToken(): Promise<{ token: string }> {
          return Promise.resolve({ token: 't' });
        }
      },
    },
    drive: () => ({ files: h.files }),
  },
}));

const PARENT = 'parent-folder';

const SESSION =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&upload_id=ABC123';

describe('isResumableSessionUrl', () => {
  it('accepts a Drive resumable session URL', () => {
    expect(isResumableSessionUrl(SESSION)).toBe(true);
  });

  it('refuses other hosts, paths, schemes and URLs without an upload id', () => {
    for (const url of [
      SESSION.replace('www.googleapis.com', 'evil.example.com'),
      SESSION.replace('https://www.googleapis.com', 'https://www.googleapis.com.evil.example'),
      SESSION.replace('https:', 'http:'),
      SESSION.replace('/upload/drive/v3/files', '/drive/v3/files'),
      SESSION.replace('&upload_id=ABC123', ''),
      'http://169.254.169.254/computeMetadata/v1/',
      'not a url',
    ]) {
      expect(isResumableSessionUrl(url)).toBe(false);
    }
  });
});

describe('parseResumableResponse', () => {
  it('reads how much Drive has from a 308', async () => {
    const res = new Response(null, { status: 308, headers: { Range: 'bytes=0-8388607' } });
    expect(await parseResumableResponse(res)).toEqual({ done: false, received: 8388608 });
  });

  it('treats a 308 without Range as nothing received', async () => {
    expect(await parseResumableResponse(new Response(null, { status: 308 }))).toEqual({
      done: false,
      received: 0,
    });
  });

  it('returns the file when the last piece lands', async () => {
    const res = new Response(JSON.stringify({ id: 'f1', name: 'audio.webm' }), { status: 200 });
    expect(await parseResumableResponse(res)).toEqual({
      done: true,
      fileId: 'f1',
      fileName: 'audio.webm',
    });
  });

  it('reports an expired session so the upload can start over', async () => {
    await expect(parseResumableResponse(new Response('', { status: 404 }))).rejects.toBeInstanceOf(
      ResumableUploadGoneError,
    );
  });

  it('throws on other errors', async () => {
    await expect(
      parseResumableResponse(new Response('quota', { status: 403 })),
    ).rejects.toThrow(/403/);
  });
});

describe('deleteObservationFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.files.list.mockResolvedValue({ data: { files: [{ id: 'child1' }] } });
    h.files.delete.mockResolvedValue({});
  });

  it('refuses the parent folder itself', async () => {
    expect(await deleteObservationFolder({ folderId: PARENT, parentFolderId: PARENT })).toBe(
      'refused',
    );
    expect(h.files.delete).not.toHaveBeenCalled();
    expect(h.logger.error).toHaveBeenCalled();
  });

  it('refuses a folder that is not a direct child of the parent', async () => {
    h.files.get.mockResolvedValue({ data: { parents: ['somewhere-else'] } });
    expect(await deleteObservationFolder({ folderId: 'f1', parentFolderId: PARENT })).toBe(
      'refused',
    );
    expect(h.files.list).not.toHaveBeenCalled();
    expect(h.files.delete).not.toHaveBeenCalled();
  });

  it('deletes a direct child of the parent, children first', async () => {
    h.files.get.mockResolvedValue({ data: { parents: [PARENT] } });
    expect(await deleteObservationFolder({ folderId: 'f1', parentFolderId: PARENT })).toBe(
      'deleted',
    );
    expect(h.files.delete.mock.calls.map(([arg]) => (arg as { fileId: string }).fileId)).toEqual([
      'child1',
      'f1',
    ]);
  });

  it('refuses when the parent folder is not configured', async () => {
    expect(await deleteObservationFolder({ folderId: 'f1', parentFolderId: '' })).toBe('refused');
    expect(h.files.get).not.toHaveBeenCalled();
    expect(h.files.delete).not.toHaveBeenCalled();
  });

  it('treats a folder that is already gone as deleted', async () => {
    h.files.get.mockRejectedValue(Object.assign(new Error('not found'), { code: 404 }));
    expect(await deleteObservationFolder({ folderId: 'f1', parentFolderId: PARENT })).toBe(
      'deleted',
    );
    expect(h.files.delete).not.toHaveBeenCalled();
  });

  it('propagates other Drive errors without deleting', async () => {
    h.files.get.mockRejectedValue(Object.assign(new Error('forbidden'), { code: 403 }));
    await expect(
      deleteObservationFolder({ folderId: 'f1', parentFolderId: PARENT }),
    ).rejects.toThrow('forbidden');
    expect(h.files.delete).not.toHaveBeenCalled();
  });
});

describe('ensureObservationFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws rather than reuse the parent folder as an observation folder', async () => {
    await expect(
      ensureObservationFolder({
        observationId: 'obs1',
        observedName: 'T',
        parentFolderId: PARENT,
        existingFolderId: PARENT,
      }),
    ).rejects.toThrow('Observation folder id is the Drive parent folder');
    expect(h.files.get).not.toHaveBeenCalled();
    expect(h.files.create).not.toHaveBeenCalled();
  });

  it('still reuses an existing folder outside the parent (legacy folders)', async () => {
    h.files.get.mockResolvedValue({ data: { id: 'legacy' } });
    expect(
      await ensureObservationFolder({
        observationId: 'obs1',
        observedName: 'T',
        parentFolderId: PARENT,
        existingFolderId: 'legacy',
      }),
    ).toBe('legacy');
    expect(h.files.create).not.toHaveBeenCalled();
  });
});
