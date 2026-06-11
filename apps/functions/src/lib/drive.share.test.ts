import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shareObservationFolderWithObserver } from './drive.js';

/**
 * Unit tests for the observer-access grant on observation Drive folders.
 *
 * The district parent folder is shared only with the service account and
 * admins; Peer Evaluators are not admins, so every observer-facing Drive
 * link (Finalized banner PDF/folder, StaffPersonPage "View PDF", evidence
 * chips) relies on this per-folder grant. The grant must be idempotent
 * (no duplicate permissions on re-upload/re-finalize) and non-fatal (a
 * Drive permissions failure must never fail the surrounding upload or
 * finalize — the next call site retries it).
 */

interface PermissionRecord {
  id?: string;
  emailAddress?: string;
  role?: string;
}

const driveMocks = vi.hoisted(() => ({
  permissionsList: vi.fn<
    (args: {
      fileId: string;
      fields: string;
    }) => Promise<{ data: { permissions?: PermissionRecord[] } }>
  >(),
  permissionsCreate: vi.fn<(args: Record<string, unknown>) => Promise<{ data: object }>>(),
  permissionsUpdate: vi.fn<(args: Record<string, unknown>) => Promise<{ data: object }>>(),
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
        create: driveMocks.permissionsCreate,
        update: driveMocks.permissionsUpdate,
      },
    })),
  },
}));

const FOLDER = 'obs-folder-123';
const OBSERVER = 'pe@orono.k12.mn.us';

beforeEach(() => {
  driveMocks.permissionsList.mockReset();
  driveMocks.permissionsCreate.mockReset();
  driveMocks.permissionsUpdate.mockReset();
  loggerMocks.warn.mockReset();
  driveMocks.permissionsCreate.mockResolvedValue({ data: {} });
  driveMocks.permissionsUpdate.mockResolvedValue({ data: {} });
});

describe('shareObservationFolderWithObserver', () => {
  it('grants the observer Reader with no notification email when not yet shared', async () => {
    driveMocks.permissionsList.mockResolvedValue({ data: { permissions: [] } });

    await shareObservationFolderWithObserver({ folderId: FOLDER, observerEmail: OBSERVER });

    expect(driveMocks.permissionsCreate).toHaveBeenCalledTimes(1);
    expect(driveMocks.permissionsCreate).toHaveBeenCalledWith({
      fileId: FOLDER,
      sendNotificationEmail: false,
      requestBody: { type: 'user', role: 'reader', emailAddress: OBSERVER },
    });
    expect(driveMocks.permissionsUpdate).not.toHaveBeenCalled();
  });

  it('is idempotent: re-grant is a no-op when the observer already has Reader', async () => {
    driveMocks.permissionsList.mockResolvedValue({
      data: {
        // Mixed case — the dedupe match must be case-insensitive.
        permissions: [{ id: 'perm-1', emailAddress: 'PE@Orono.K12.MN.US', role: 'reader' }],
      },
    });

    await shareObservationFolderWithObserver({ folderId: FOLDER, observerEmail: OBSERVER });

    expect(driveMocks.permissionsCreate).not.toHaveBeenCalled();
    expect(driveMocks.permissionsUpdate).not.toHaveBeenCalled();
  });

  it('updates an existing non-Reader grant in place instead of duplicating it', async () => {
    driveMocks.permissionsList.mockResolvedValue({
      data: { permissions: [{ id: 'perm-1', emailAddress: OBSERVER, role: 'commenter' }] },
    });

    await shareObservationFolderWithObserver({ folderId: FOLDER, observerEmail: OBSERVER });

    expect(driveMocks.permissionsUpdate).toHaveBeenCalledTimes(1);
    expect(driveMocks.permissionsUpdate).toHaveBeenCalledWith({
      fileId: FOLDER,
      permissionId: 'perm-1',
      requestBody: { role: 'reader' },
    });
    expect(driveMocks.permissionsCreate).not.toHaveBeenCalled();
  });

  it('swallows a permissions-list failure (logs a warning, never throws)', async () => {
    driveMocks.permissionsList.mockRejectedValue(new Error('Drive is down'));

    await expect(
      shareObservationFolderWithObserver({ folderId: FOLDER, observerEmail: OBSERVER }),
    ).resolves.toBeUndefined();

    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
    expect(driveMocks.permissionsCreate).not.toHaveBeenCalled();
  });

  it('swallows a grant failure (e.g. suspended observer account)', async () => {
    driveMocks.permissionsList.mockResolvedValue({ data: { permissions: [] } });
    driveMocks.permissionsCreate.mockRejectedValue(new Error('invalidSharingRequest'));

    await expect(
      shareObservationFolderWithObserver({ folderId: FOLDER, observerEmail: OBSERVER }),
    ).resolves.toBeUndefined();

    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
  });
});
