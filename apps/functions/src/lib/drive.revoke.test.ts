import { beforeEach, describe, expect, it, vi } from 'vitest';
import { revokeUserPermission } from './drive.js';

/**
 * Unit tests for revokeUserPermission — the finalize-rollback helper that
 * removes an observed staff member's Reader grant from the observation folder
 * when finalization fails after the share was created.
 *
 * Without this revocation the staff member would retain Reader access on a
 * folder that has reverted to Draft status, allowing them to browse
 * draft-state PDFs, audio, and evidence files they should not yet see.
 *
 * The function must be entirely best-effort: a failure at any point (list,
 * delete, 404, network error) must log a warning and never throw, so it
 * never breaks a rollback path.
 */

interface PermissionRecord {
  id?: string;
  emailAddress?: string;
}

const driveMocks = vi.hoisted(() => ({
  permissionsList: vi.fn<
    (args: {
      fileId: string;
      fields: string;
    }) => Promise<{ data: { permissions?: PermissionRecord[] } }>
  >(),
  permissionsDelete: vi.fn<(args: Record<string, unknown>) => Promise<{ data: object }>>(),
}));

const loggerMocks = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('firebase-functions', () => ({ logger: loggerMocks }));

vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: vi.fn() },
    drive: vi.fn(() => ({
      permissions: {
        list: driveMocks.permissionsList,
        delete: driveMocks.permissionsDelete,
      },
    })),
  },
}));

const FOLDER = 'obs-folder-456';
const OBSERVED = 'staff@orono.k12.mn.us';
const PERM_ID = 'perm-abc';

beforeEach(() => {
  driveMocks.permissionsList.mockReset();
  driveMocks.permissionsDelete.mockReset();
  loggerMocks.warn.mockReset();
  driveMocks.permissionsDelete.mockResolvedValue({ data: {} });
});

describe('revokeUserPermission', () => {
  it('deletes the permission when the user has one', async () => {
    driveMocks.permissionsList.mockResolvedValue({
      data: { permissions: [{ id: PERM_ID, emailAddress: OBSERVED }] },
    });

    await revokeUserPermission({ fileId: FOLDER, email: OBSERVED });

    expect(driveMocks.permissionsDelete).toHaveBeenCalledTimes(1);
    expect(driveMocks.permissionsDelete).toHaveBeenCalledWith({
      fileId: FOLDER,
      permissionId: PERM_ID,
    });
  });

  it('is a no-op when the user has no permission on the file', async () => {
    driveMocks.permissionsList.mockResolvedValue({
      data: { permissions: [{ id: 'perm-other', emailAddress: 'other@orono.k12.mn.us' }] },
    });

    await revokeUserPermission({ fileId: FOLDER, email: OBSERVED });

    expect(driveMocks.permissionsDelete).not.toHaveBeenCalled();
    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });

  it('is a no-op when the permissions list is empty', async () => {
    driveMocks.permissionsList.mockResolvedValue({ data: { permissions: [] } });

    await revokeUserPermission({ fileId: FOLDER, email: OBSERVED });

    expect(driveMocks.permissionsDelete).not.toHaveBeenCalled();
  });

  it('performs a case-insensitive email match', async () => {
    driveMocks.permissionsList.mockResolvedValue({
      data: {
        // Mixed-case address stored in Drive.
        permissions: [{ id: PERM_ID, emailAddress: 'STAFF@Orono.K12.MN.US' }],
      },
    });

    await revokeUserPermission({ fileId: FOLDER, email: OBSERVED });

    expect(driveMocks.permissionsDelete).toHaveBeenCalledTimes(1);
  });

  it('swallows a permissions.list failure (non-fatal, logs a warning)', async () => {
    driveMocks.permissionsList.mockRejectedValue(new Error('Drive API unavailable'));

    await expect(revokeUserPermission({ fileId: FOLDER, email: OBSERVED })).resolves.toBeUndefined();

    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
    expect(driveMocks.permissionsDelete).not.toHaveBeenCalled();
  });

  it('treats a 404 on permissions.delete as success (already revoked)', async () => {
    driveMocks.permissionsList.mockResolvedValue({
      data: { permissions: [{ id: PERM_ID, emailAddress: OBSERVED }] },
    });
    driveMocks.permissionsDelete.mockRejectedValue({ code: 404 });

    await expect(revokeUserPermission({ fileId: FOLDER, email: OBSERVED })).resolves.toBeUndefined();

    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });

  it('swallows a non-404 permissions.delete failure (logs a warning, never throws)', async () => {
    driveMocks.permissionsList.mockResolvedValue({
      data: { permissions: [{ id: PERM_ID, emailAddress: OBSERVED }] },
    });
    driveMocks.permissionsDelete.mockRejectedValue({ code: 500, message: 'Internal error' });

    await expect(revokeUserPermission({ fileId: FOLDER, email: OBSERVED })).resolves.toBeUndefined();

    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('permissions.delete failed'),
      expect.objectContaining({ fileId: FOLDER, email: OBSERVED, permissionId: PERM_ID }),
    );
  });

  it('requests id and emailAddress fields from permissions.list', async () => {
    driveMocks.permissionsList.mockResolvedValue({ data: { permissions: [] } });

    await revokeUserPermission({ fileId: FOLDER, email: OBSERVED });

    expect(driveMocks.permissionsList).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: FOLDER, fields: 'permissions(id,emailAddress)' }),
    );
  });
});
