import { Readable } from 'node:stream';
import { logger } from 'firebase-functions';
import { google, type drive_v3 } from 'googleapis';

/**
 * Drive API helpers backed by the Cloud Functions runtime service account
 * (`peer-eval-svc@…`). The SA owns observation folders directly — observed
 * staff get `reader` permission on finalize via `permissions.create`.
 *
 * Domain-Wide Delegation is OFF the table for this project, so we never
 * impersonate users.
 */

let driveClient: drive_v3.Drive | null = null;

export function getDriveClient(): drive_v3.Drive {
  if (driveClient) return driveClient;
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

/**
 * Get or create the Drive folder for this observation. Returns the folder
 * ID. If `existingFolderId` is supplied and still exists, reuses it.
 */
export async function ensureObservationFolder(args: {
  observationId: string;
  observedName: string;
  parentFolderId: string;
  existingFolderId: string | null;
}): Promise<string> {
  const drive = getDriveClient();
  if (args.existingFolderId) {
    try {
      await drive.files.get({ fileId: args.existingFolderId, fields: 'id' });
      return args.existingFolderId;
    } catch {
      // Folder was deleted out from under us; fall through and recreate.
    }
  }
  const created = await drive.files.create({
    requestBody: {
      name: `${args.observedName} — ${args.observationId}`,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [args.parentFolderId],
    },
    fields: 'id',
  });
  if (!created.data.id) throw new Error('Drive folder creation returned no id');
  return created.data.id;
}

export async function uploadFileToFolder(args: {
  folderId: string;
  filename: string;
  mimeType: string;
  body: Buffer;
}): Promise<{ fileId: string; fileName: string }> {
  const drive = getDriveClient();
  const result = await drive.files.create({
    requestBody: {
      name: args.filename,
      parents: [args.folderId],
      mimeType: args.mimeType,
    },
    media: {
      mimeType: args.mimeType,
      body: Readable.from(args.body),
    },
    fields: 'id, name',
  });
  if (!result.data.id || !result.data.name) {
    throw new Error('Drive upload returned no id/name');
  }
  return { fileId: result.data.id, fileName: result.data.name };
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const result = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );
  return Buffer.from(result.data as ArrayBuffer);
}

/**
 * Grant a role (`reader` or `writer`) on a Drive folder/file to a specific
 * user, idempotently (looks up existing permissions first to avoid
 * duplicate grants on re-finalize).
 */
export async function shareWithUser(args: {
  fileId: string;
  email: string;
  role: 'reader' | 'writer';
  /** Optional message for the email Google sends to the recipient. */
  emailMessage?: string;
  /** When false, suppresses the auto-notification email. */
  sendNotificationEmail?: boolean;
}): Promise<void> {
  const drive = getDriveClient();
  const existing = await drive.permissions.list({
    fileId: args.fileId,
    fields: 'permissions(id,emailAddress,role)',
  });
  const lower = args.email.toLowerCase();
  const match = existing.data.permissions?.find(
    (p) => p.emailAddress?.toLowerCase() === lower,
  );
  if (match && match.role === args.role) return;
  if (match?.id) {
    await drive.permissions.update({
      fileId: args.fileId,
      permissionId: match.id,
      requestBody: { role: args.role },
    });
    return;
  }
  if (args.emailMessage !== undefined) {
    await drive.permissions.create({
      fileId: args.fileId,
      sendNotificationEmail: args.sendNotificationEmail ?? false,
      emailMessage: args.emailMessage,
      requestBody: { type: 'user', role: args.role, emailAddress: args.email },
    });
  } else {
    await drive.permissions.create({
      fileId: args.fileId,
      sendNotificationEmail: args.sendNotificationEmail ?? false,
      requestBody: { type: 'user', role: args.role, emailAddress: args.email },
    });
  }
}

/**
 * Grant the observation's observer Reader access on its Drive folder so the
 * observer-facing links the app renders (Finalized banner "Open PDF" /
 * "Open Drive folder", StaffPersonPage "View PDF", evidence chips) actually
 * open. The district parent folder is shared only with the service account
 * and admins — Peer Evaluators are not admins, so without this per-folder
 * grant every observer link lands on Drive's request-access page.
 *
 * Idempotent ({@link shareWithUser} dedupes existing grants) and deliberately
 * best-effort: a failed grant is logged, never thrown, so a Drive permissions
 * hiccup (or a suspended observer account when an admin finalizes on their
 * behalf) can't fail an evidence/audio upload or brick finalization. Every
 * call site (evidence upload, audio upload, finalize) re-attempts the grant,
 * so a missed grant heals on the next Drive interaction.
 */
export async function shareObservationFolderWithObserver(args: {
  folderId: string;
  observerEmail: string;
}): Promise<void> {
  try {
    await shareWithUser({
      fileId: args.folderId,
      email: args.observerEmail,
      role: 'reader',
      sendNotificationEmail: false,
    });
  } catch (err) {
    logger.warn('shareObservationFolderWithObserver: share failed (non-fatal)', {
      folderId: args.folderId,
      observerEmail: args.observerEmail,
      err,
    });
  }
}

export interface DriveLink {
  webViewLink: string;
  webContentLink: string | null;
}

/**
 * Guard for {@link deleteDriveFolder}: cleanup may only remove a folder
 * that actually lives inside the expected observations parent folder.
 * Refuses the parent folder itself and any folder whose parents don't
 * include it — `driveFolderId` is server-managed, but if a spoofed value
 * ever reached cleanup (e.g. pointing at the district-wide parent, or at
 * another observation's tree) a permanent recursive delete would be
 * catastrophic. Exported for unit tests.
 */
export function canDeleteObservationFolder(args: {
  folderId: string;
  parents: readonly string[];
  expectedParentFolderId: string;
}): boolean {
  return (
    args.folderId !== args.expectedParentFolderId &&
    args.parents.includes(args.expectedParentFolderId)
  );
}

/**
 * Permanently delete a Drive folder and all of its children.
 * Used when a Draft observation is deleted — the SA owns the folder so
 * deletion is unconditional. Pages through children so folders with
 * more than one page of files are cleared completely. Logs (but does
 * not propagate) per-child failures so the parent delete still runs;
 * a missing folder (404) is treated as success.
 *
 * Defense in depth: before deleting anything, verifies the folder is a
 * direct child of `expectedParentFolderId` (the district observations
 * parent). A folder living anywhere else is refused and logged, never
 * deleted.
 */
export async function deleteDriveFolder(
  folderId: string,
  expectedParentFolderId: string,
): Promise<void> {
  const drive = getDriveClient();

  let parents: string[];
  try {
    const meta = await drive.files.get({ fileId: folderId, fields: 'id, parents' });
    parents = meta.data.parents ?? [];
  } catch (err) {
    const status = (err as { code?: number })?.code;
    if (status === 404) return; // already gone — nothing to clean up
    throw err;
  }
  if (!canDeleteObservationFolder({ folderId, parents, expectedParentFolderId })) {
    logger.error(
      'deleteDriveFolder: folder is not under the observations parent; refusing to delete',
      { folderId, parents, expectedParentFolderId },
    );
    return;
  }

  // List immediate children so we can delete them before the folder,
  // ensuring no orphaned files remain accessible from other contexts.
  let pageToken: string | undefined;
  do {
    const page = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id)',
      pageSize: 1000,
      ...(pageToken ? { pageToken } : {}),
    });
    await Promise.all(
      (page.data.files ?? []).map((f) =>
        f.id
          ? drive.files.delete({ fileId: f.id }).catch((err: unknown) => {
              logger.warn('deleteDriveFolder: failed to delete child', {
                folderId,
                fileId: f.id,
                err,
              });
            })
          : Promise.resolve(),
      ),
    );
    pageToken = page.data.nextPageToken ?? undefined;
  } while (pageToken);

  await drive.files.delete({ fileId: folderId }).catch((err: unknown) => {
    const status = (err as { code?: number })?.code;
    if (status !== 404) throw err;
  });
}

export async function getDriveLinks(fileId: string): Promise<DriveLink> {
  const drive = getDriveClient();
  const meta = await drive.files.get({
    fileId,
    fields: 'webViewLink, webContentLink',
  });
  return {
    webViewLink: meta.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`,
    webContentLink: meta.data.webContentLink ?? null,
  };
}
