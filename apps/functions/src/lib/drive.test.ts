import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ForeignDriveObjectError,
  ResumableUploadGoneError,
  assertFilesInObservationFolder,
  assertObservationFolder,
  deleteObservationFolder,
  ensureObservationFolder,
  filesInObservationFolder,
  isResumableSessionUrl,
  parseResumableResponse,
  withdrawObservedFolderAccess,
} from './drive.js';

// A fake Drive client behind the real getDriveClient, so the folder guards are
// tested together with the getFileParents/deleteDriveFolder calls they make.
const h = vi.hoisted(() => ({
  files: { get: vi.fn(), list: vi.fn(), delete: vi.fn(), create: vi.fn() },
  permissions: { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
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
    drive: () => ({ files: h.files, permissions: h.permissions }),
  },
}));

const PARENT = 'parent-folder';
const FOLDER = 'application/vnd.google-apps.folder';

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
    await expect(parseResumableResponse(new Response('quota', { status: 403 }))).rejects.toThrow(
      /403/,
    );
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

  it('reuses an existing folder that is a direct child of the parent', async () => {
    h.files.get.mockResolvedValue({ data: { id: 'f1', mimeType: FOLDER, parents: [PARENT] } });
    expect(
      await ensureObservationFolder({
        observationId: 'obs1',
        observedName: 'T',
        parentFolderId: PARENT,
        existingFolderId: 'f1',
      }),
    ).toBe('f1');
    expect(h.files.create).not.toHaveBeenCalled();
  });

  it.each([
    ['a folder elsewhere', { mimeType: FOLDER, parents: ['somewhere-else'] }],
    ['a file in the parent', { mimeType: 'application/pdf', parents: [PARENT] }],
    ['an item with no parents', { mimeType: FOLDER }],
  ])('never adopts %s: makes a fresh folder under the parent instead', async (_label, data) => {
    h.files.get.mockResolvedValue({ data: { id: 'foreign', ...data } });
    h.files.create.mockResolvedValue({ data: { id: 'fresh' } });
    expect(
      await ensureObservationFolder({
        observationId: 'obs1',
        observedName: 'T',
        parentFolderId: PARENT,
        existingFolderId: 'foreign',
      }),
    ).toBe('fresh');
    expect(h.files.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ parents: [PARENT] }) as unknown,
      }),
    );
    expect(h.logger.error).toHaveBeenCalled();
  });

  it.each([
    ['numeric code', { code: 404 }],
    ['string code', { code: '404' }],
    ['HTTP status only', { status: 404 }],
  ])('recreates the folder only when Drive says it is gone (%s)', async (_label, shape) => {
    h.files.get.mockRejectedValue(Object.assign(new Error('File not found'), shape));
    h.files.create.mockResolvedValue({ data: { id: 'fresh' } });
    expect(
      await ensureObservationFolder({
        observationId: 'obs1',
        observedName: 'T',
        parentFolderId: PARENT,
        existingFolderId: 'gone',
      }),
    ).toBe('fresh');
  });

  it('recreates a trashed folder', async () => {
    h.files.get.mockResolvedValue({ data: { id: 'old', trashed: true } });
    h.files.create.mockResolvedValue({ data: { id: 'fresh' } });
    expect(
      await ensureObservationFolder({
        observationId: 'obs1',
        observedName: 'T',
        parentFolderId: PARENT,
        existingFolderId: 'old',
      }),
    ).toBe('fresh');
  });

  it('rethrows a transient Drive error instead of making a second folder', async () => {
    h.files.get.mockRejectedValue(Object.assign(new Error('Rate limit'), { code: 429 }));
    await expect(
      ensureObservationFolder({
        observationId: 'obs1',
        observedName: 'T',
        parentFolderId: PARENT,
        existingFolderId: 'busy',
      }),
    ).rejects.toThrow('Rate limit');
    expect(h.files.create).not.toHaveBeenCalled();
  });
});

/** files.get answers by id: `{ id: { mimeType, parents } }`. */
function driveTree(tree: Record<string, { mimeType?: string; parents?: string[] }>) {
  h.files.get.mockImplementation(({ fileId }: { fileId: string }) => {
    const item = tree[fileId];
    if (!item) return Promise.reject(Object.assign(new Error('not found'), { code: 404 }));
    return Promise.resolve({ data: item });
  });
}

const TREE = {
  obsFolder: { mimeType: FOLDER, parents: [PARENT] },
  otherFolder: { mimeType: FOLDER, parents: ['elsewhere'] },
  audio1: { mimeType: 'audio/webm', parents: ['obsFolder'] },
  pdf1: { mimeType: 'application/pdf', parents: ['obsFolder'] },
  foreignFile: { mimeType: 'audio/webm', parents: ['otherFolder'] },
  siblingFile: { mimeType: 'application/pdf', parents: ['siblingObsFolder'] },
};

describe('assertObservationFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driveTree(TREE);
  });

  it('accepts a folder directly under the parent', async () => {
    await expect(
      assertObservationFolder({ folderId: 'obsFolder', parentFolderId: PARENT }),
    ).resolves.toBeUndefined();
  });

  it('refuses the parent itself, an unset parent, other folders and files', async () => {
    for (const [folderId, parentFolderId] of [
      [PARENT, PARENT],
      ['obsFolder', ''],
      ['otherFolder', PARENT],
      ['audio1', PARENT],
    ] as const) {
      await expect(assertObservationFolder({ folderId, parentFolderId })).rejects.toBeInstanceOf(
        ForeignDriveObjectError,
      );
    }
  });
});

describe('assertFilesInObservationFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driveTree(TREE);
  });

  it('accepts files in the observation folder', async () => {
    await expect(
      assertFilesInObservationFolder({
        fileIds: ['audio1', 'pdf1'],
        folderId: 'obsFolder',
        parentFolderId: PARENT,
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['a file in a folder outside the tree', ['foreignFile'], 'obsFolder'],
    ["another observation's file", ['siblingFile'], 'obsFolder'],
    ['the folder itself', ['obsFolder'], 'obsFolder'],
    ['a file named by a foreign folder', ['foreignFile'], 'otherFolder'],
    ['a file on an observation with no folder', ['audio1'], null],
  ])('refuses %s', async (_label, fileIds, folderId) => {
    await expect(
      assertFilesInObservationFolder({ fileIds, folderId, parentFolderId: PARENT }),
    ).rejects.toBeInstanceOf(ForeignDriveObjectError);
  });
});

describe('filesInObservationFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driveTree(TREE);
  });

  it('keeps only files in the folder, dropping foreign and missing ids', async () => {
    expect(
      await filesInObservationFolder({
        fileIds: ['audio1', 'foreignFile', 'gone', 'pdf1'],
        folderId: 'obsFolder',
        parentFolderId: PARENT,
      }),
    ).toEqual(['audio1', 'pdf1']);
  });

  it('keeps nothing when the folder itself is refused', async () => {
    expect(
      await filesInObservationFolder({
        fileIds: ['foreignFile'],
        folderId: 'otherFolder',
        parentFolderId: PARENT,
      }),
    ).toEqual([]);
    expect(
      await filesInObservationFolder({
        fileIds: ['audio1'],
        folderId: null,
        parentFolderId: PARENT,
      }),
    ).toEqual([]);
  });

  it('propagates other Drive errors', async () => {
    h.files.get.mockRejectedValue(Object.assign(new Error('forbidden'), { code: 403 }));
    await expect(
      filesInObservationFolder({
        fileIds: ['audio1'],
        folderId: 'obsFolder',
        parentFolderId: PARENT,
      }),
    ).rejects.toThrow('forbidden');
  });
});

describe('withdrawObservedFolderAccess', () => {
  const TEACHER = 'teacher@orono.k12.mn.us';

  beforeEach(() => {
    vi.clearAllMocks();
    driveTree(TREE);
    h.permissions.list.mockImplementation(({ fileId }: { fileId: string }) =>
      Promise.resolve({
        data: {
          permissions:
            fileId === 'obsFolder'
              ? [
                  { id: 'perm-teacher', emailAddress: 'Teacher@orono.k12.mn.us', role: 'reader' },
                  { id: 'perm-owner', emailAddress: 'observations@orono.k12.mn.us', role: 'owner' },
                ]
              : // Files list the Reader they inherit from the folder.
                [{ id: 'perm-teacher', emailAddress: 'Teacher@orono.k12.mn.us', role: 'reader' }],
        },
      }),
    );
    h.permissions.create.mockResolvedValue({});
    h.permissions.delete.mockResolvedValue({});
  });

  it('gives the PDF a direct grant even though it lists the inherited one, then removes the folder Reader', async () => {
    await withdrawObservedFolderAccess({
      folderId: 'obsFolder',
      parentFolderId: PARENT,
      observedEmail: TEACHER,
      pdfDriveFileId: 'pdf1',
    });
    expect(h.permissions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'pdf1',
        requestBody: { type: 'user', role: 'reader', emailAddress: TEACHER },
      }),
    );
    expect(h.permissions.delete).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'obsFolder', permissionId: 'perm-teacher' }),
    );
    const createOrder = h.permissions.create.mock.invocationCallOrder[0] ?? 0;
    const deleteOrder = h.permissions.delete.mock.invocationCallOrder[0] ?? 0;
    expect(createOrder).toBeLessThan(deleteOrder);
  });

  it('does not share a PDF that sits outside the observation folder', async () => {
    await withdrawObservedFolderAccess({
      folderId: 'obsFolder',
      parentFolderId: PARENT,
      observedEmail: TEACHER,
      pdfDriveFileId: 'foreignFile',
    });
    expect(h.permissions.create).not.toHaveBeenCalled();
    expect(h.permissions.delete).toHaveBeenCalledOnce();
  });

  it('makes no grant and no revoke when the teacher has no folder Reader', async () => {
    h.permissions.list.mockResolvedValue({ data: { permissions: [] } });
    await withdrawObservedFolderAccess({
      folderId: 'obsFolder',
      parentFolderId: PARENT,
      observedEmail: TEACHER,
      pdfDriveFileId: 'pdf1',
    });
    expect(h.permissions.create).not.toHaveBeenCalled();
    expect(h.permissions.delete).not.toHaveBeenCalled();
  });

  it('still revokes the folder Reader when the PDF grant fails', async () => {
    h.permissions.create.mockRejectedValue(Object.assign(new Error('no account'), { code: 400 }));
    await withdrawObservedFolderAccess({
      folderId: 'obsFolder',
      parentFolderId: PARENT,
      observedEmail: TEACHER,
      pdfDriveFileId: 'pdf1',
    });
    expect(h.permissions.delete).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'obsFolder', permissionId: 'perm-teacher' }),
    );
  });

  it('throws when Drive refuses the revoke, so an upload can stop', async () => {
    h.permissions.delete.mockRejectedValue(Object.assign(new Error('backend'), { code: 500 }));
    await expect(
      withdrawObservedFolderAccess({
        folderId: 'obsFolder',
        parentFolderId: PARENT,
        observedEmail: TEACHER,
        pdfDriveFileId: null,
      }),
    ).rejects.toThrow('backend');
  });
});
