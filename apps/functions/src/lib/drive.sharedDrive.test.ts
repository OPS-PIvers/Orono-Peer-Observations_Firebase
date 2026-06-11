import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteDriveFile,
  deleteDriveFolder,
  downloadFile,
  ensureObservationFolder,
  getDriveLinks,
  trashDriveFile,
  uploadFileToFolder,
} from './drive.js';

/**
 * Verifies that every Drive API call in drive.ts passes supportsAllDrives:true
 * (and includeItemsFromAllDrives where applicable on list calls) so the parent
 * folder may live on a Google Workspace Shared Drive rather than the service
 * account's My Drive.
 *
 * Without these flags, Drive API calls silently succeed only for items owned by
 * the SA's personal drive; a Shared Drive item returns 404 or 403, which causes
 * uploads, downloads, and folder management to fail once the parent is migrated.
 */

interface FakeFile {
  id?: string;
  name?: string;
  parents?: string[];
}

const driveMocks = vi.hoisted(() => ({
  filesGet: vi.fn<(args: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<{ data: FakeFile }>>(),
  filesCreate: vi.fn<(args: Record<string, unknown>) => Promise<{ data: FakeFile }>>(),
  filesDelete: vi.fn<(args: Record<string, unknown>) => Promise<{ data: object }>>(),
  filesUpdate: vi.fn<(args: Record<string, unknown>) => Promise<{ data: FakeFile }>>(),
  filesList: vi.fn<(args: Record<string, unknown>) => Promise<{ data: { files?: FakeFile[]; nextPageToken?: string } }>>(),
  permissionsList: vi.fn<(args: Record<string, unknown>) => Promise<{ data: { permissions?: object[] } }>>(),
  permissionsCreate: vi.fn<(args: Record<string, unknown>) => Promise<{ data: object }>>(),
}));

vi.mock('firebase-functions', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: vi.fn() },
    drive: vi.fn(() => ({
      files: {
        get: driveMocks.filesGet,
        create: driveMocks.filesCreate,
        delete: driveMocks.filesDelete,
        update: driveMocks.filesUpdate,
        list: driveMocks.filesList,
      },
      permissions: {
        list: driveMocks.permissionsList,
        create: driveMocks.permissionsCreate,
        update: vi.fn().mockResolvedValue({ data: {} }),
      },
    })),
  },
}));

const FOLDER_ID = 'shared-drive-folder-abc';
const FILE_ID = 'shared-drive-file-xyz';
const PARENT_ID = 'district-obs-parent';

beforeEach(() => {
  vi.resetAllMocks();
  driveMocks.filesGet.mockResolvedValue({ data: { id: FOLDER_ID, parents: [PARENT_ID] } });
  driveMocks.filesCreate.mockResolvedValue({ data: { id: FILE_ID, name: 'upload.pdf' } });
  driveMocks.filesDelete.mockResolvedValue({ data: {} });
  driveMocks.filesUpdate.mockResolvedValue({ data: {} });
  driveMocks.filesList.mockResolvedValue({ data: { files: [] } });
  driveMocks.permissionsList.mockResolvedValue({ data: { permissions: [] } });
  driveMocks.permissionsCreate.mockResolvedValue({ data: {} });
});

describe('ensureObservationFolder', () => {
  it('passes supportsAllDrives to files.get when checking an existing folder', async () => {
    await ensureObservationFolder({
      observationId: 'obs-1',
      observedName: 'Jane Doe',
      parentFolderId: PARENT_ID,
      existingFolderId: FOLDER_ID,
    });
    expect(driveMocks.filesGet).toHaveBeenCalledWith(
      expect.objectContaining({ supportsAllDrives: true }),
    );
  });

  it('passes supportsAllDrives to files.create when creating a new folder', async () => {
    await ensureObservationFolder({
      observationId: 'obs-2',
      observedName: 'Jane Doe',
      parentFolderId: PARENT_ID,
      existingFolderId: null,
    });
    expect(driveMocks.filesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ supportsAllDrives: true }),
    );
  });
});

describe('uploadFileToFolder', () => {
  it('passes supportsAllDrives to files.create', async () => {
    await uploadFileToFolder({
      folderId: FOLDER_ID,
      filename: 'obs.pdf',
      mimeType: 'application/pdf',
      body: Buffer.from('data'),
    });
    expect(driveMocks.filesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ supportsAllDrives: true }),
    );
  });
});

describe('downloadFile', () => {
  it('passes supportsAllDrives to files.get', async () => {
    driveMocks.filesGet.mockResolvedValue({ data: Buffer.from('pdf') as unknown as FakeFile });
    await downloadFile(FILE_ID).catch(() => {
      /* buffer coercion may throw in test; we only care the call was made */
    });
    expect(driveMocks.filesGet).toHaveBeenCalledWith(
      expect.objectContaining({ supportsAllDrives: true }),
      expect.anything(),
    );
  });
});

describe('deleteDriveFile', () => {
  it('passes supportsAllDrives to files.delete', async () => {
    await deleteDriveFile(FILE_ID);
    expect(driveMocks.filesDelete).toHaveBeenCalledWith(
      expect.objectContaining({ supportsAllDrives: true }),
    );
  });
});

describe('trashDriveFile', () => {
  it('passes supportsAllDrives to files.update', async () => {
    await trashDriveFile(FILE_ID);
    expect(driveMocks.filesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ supportsAllDrives: true }),
    );
  });
});

describe('getDriveLinks', () => {
  it('passes supportsAllDrives to files.get', async () => {
    driveMocks.filesGet.mockResolvedValue({
      data: { id: FILE_ID } as FakeFile,
    });
    await getDriveLinks(FILE_ID);
    expect(driveMocks.filesGet).toHaveBeenCalledWith(
      expect.objectContaining({ supportsAllDrives: true }),
    );
  });
});

describe('deleteDriveFolder', () => {
  it('passes supportsAllDrives to files.get (parent verification)', async () => {
    await deleteDriveFolder(FOLDER_ID, PARENT_ID);
    expect(driveMocks.filesGet).toHaveBeenCalledWith(
      expect.objectContaining({ supportsAllDrives: true }),
    );
  });

  it('passes supportsAllDrives + includeItemsFromAllDrives to files.list', async () => {
    await deleteDriveFolder(FOLDER_ID, PARENT_ID);
    expect(driveMocks.filesList).toHaveBeenCalledWith(
      expect.objectContaining({
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      }),
    );
  });

  it('passes supportsAllDrives to the folder files.delete', async () => {
    await deleteDriveFolder(FOLDER_ID, PARENT_ID);
    expect(driveMocks.filesDelete).toHaveBeenCalledWith(
      expect.objectContaining({ supportsAllDrives: true }),
    );
  });

  it('passes supportsAllDrives to child files.delete', async () => {
    driveMocks.filesList.mockResolvedValueOnce({
      data: { files: [{ id: 'child-file-1' }] },
    });
    await deleteDriveFolder(FOLDER_ID, PARENT_ID);
    // Both the child delete and the folder delete should have supportsAllDrives.
    for (const call of driveMocks.filesDelete.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ supportsAllDrives: true }));
    }
  });
});
