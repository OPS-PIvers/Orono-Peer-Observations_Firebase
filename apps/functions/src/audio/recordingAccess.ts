import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  OBSERVATION_STATUS,
  observationAccessFor,
  type AudioRecordingMeta,
} from '@ops/shared';
import { callerObservationAccess } from '../lib/observationAccess.js';
import { getDriveClient } from '../lib/drive.js';

/** The observation fields the recording callables read. A raw Admin SDK read
 *  skips the schema defaults, so the collections may be missing on legacy docs. */
export interface RecordingObservation {
  observerEmail: string;
  observedEmail: string;
  coObserverEmails?: string[];
  status: string;
  audioDriveFileIds?: string[];
  audioRecordings?: Record<string, AudioRecordingMeta>;
}

/** Drive file ids are `[A-Za-z0-9_-]`; checked before an id is used in a
 *  Firestore field path so a crafted id can't address another field. */
const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]+$/;

export function callerEmail(request: CallableRequest): string {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const email = request.auth.token.email?.toLowerCase();
  if (!email) throw new HttpsError('unauthenticated', 'Token has no email');
  return email;
}

export async function loadObservation(
  db: Firestore,
  observationId: string,
): Promise<{ ref: DocumentReference; obs: RecordingObservation }> {
  const ref = db.doc(`${COLLECTIONS.observations}/${observationId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Observation not found');
  return { ref, obs: snap.data() as RecordingObservation };
}

/** Throws unless `audioFileId` is one of the observation's recordings. */
export function requireRecording(obs: RecordingObservation, audioFileId: string): void {
  if (!DRIVE_FILE_ID_RE.test(audioFileId) || !(obs.audioDriveFileIds ?? []).includes(audioFileId)) {
    throw new HttpsError('not-found', 'Recording is not part of this observation');
  }
}

/** Edits (rename, delete) are the observers' (owner or co-observer), and
 *  only on a Draft. */
export function requireObserverOnDraft(obs: RecordingObservation, email: string): void {
  const access = observationAccessFor(obs, email, false);
  if (access !== 'owner' && access !== 'coObserver') {
    throw new HttpsError('permission-denied', 'Only the observers can change recordings');
  }
  if (obs.status !== OBSERVATION_STATUS.draft) {
    throw new HttpsError('failed-precondition', 'Recordings can only be changed on a Draft');
  }
}

/** Same audience as getAudio playback: the observers (owner or
 *  co-observer), oversight, or the observed staff member once the
 *  observation is finalized. Other PEs and building Administrators can't. */
export async function requireRecordingReader(
  db: Firestore,
  request: CallableRequest,
  obs: RecordingObservation,
  email: string,
): Promise<void> {
  if (await canReadRecording(db, obs, email, request.auth)) return;
  throw new HttpsError('permission-denied', 'Not authorized to access this recording');
}

export async function canReadRecording(
  db: Firestore,
  obs: RecordingObservation,
  email: string,
  /** The caller's auth, so a demo-edit session only reaches demo staff's
   *  recordings (callerObservationAccess). */
  auth: { token: Record<string, unknown> } | null | undefined,
): Promise<boolean> {
  const tokenRole = typeof auth?.token['role'] === 'string' ? auth.token['role'] : undefined;
  const access = await callerObservationAccess(db, obs, { email, tokenRole, auth });
  if (access === 'owner' || access === 'coObserver' || access === 'oversight') return true;
  return access === 'observed' && obs.status === OBSERVATION_STATUS.finalized;
}

/** Metadata for a recording that predates `audioRecordings`: the Drive
 *  file's createdTime stands in for when it was recorded. */
export async function recordingMetaFromDrive(audioFileId: string): Promise<AudioRecordingMeta> {
  const drive = await getDriveClient();
  const meta = await drive.files.get({
    fileId: audioFileId,
    fields: 'createdTime',
    supportsAllDrives: true,
  });
  const created = meta.data.createdTime ? new Date(meta.data.createdTime) : new Date();
  return { recordedAt: created, durationSec: null, label: '' };
}
