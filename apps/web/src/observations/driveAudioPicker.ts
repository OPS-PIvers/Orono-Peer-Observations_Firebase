/**
 * Google Drive Picker for importing audio recorded outside the app (iPad and
 * iPhone Voice Memos saved to Drive) into an observation.
 *
 * Flow: a Google Identity Services token client asks for the `drive.file`
 * scope (the app only ever sees the files the user picks), the Picker lets
 * the user choose audio files, and the browser downloads each one with that
 * token. The caller then posts the bytes to `uploadAudio`, the same path an
 * in-app recording takes, so the import lands in the observation's Drive
 * folder and goes through transcription and tagging like any other clip.
 *
 * Needs, in the Google Cloud project behind the Firebase app:
 *  - the Google Picker API enabled, and allowed on the Firebase browser API
 *    key if that key has API restrictions;
 *  - every origin we serve from listed as an Authorized JavaScript origin on
 *    the `VITE_GOOGLE_OAUTH_CLIENT_ID` web client.
 * The Picker's app id is the project number, which Firebase exposes as the
 * messaging sender id.
 */

/** Read-only access to the files the user picks, nothing else in their Drive. */
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const HOSTED_DOMAIN = 'orono.k12.mn.us';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GAPI_SRC = 'https://apis.google.com/js/api.js';

/**
 * Largest file we try to import. Cloud Functions reject request bodies over
 * 32 MiB, so leave headroom. A Voice Memo at the default (compressed) quality
 * is about half a megabyte per minute, so this is roughly an hour of audio.
 */
export const MAX_DRIVE_AUDIO_BYTES = 31 * 1024 * 1024;

/** Audio types the Picker shows. Drive labels Voice Memos `audio/x-m4a`. */
const PICKER_MIME_TYPES = [
  'audio/x-m4a',
  'audio/m4a',
  'audio/mp4',
  'audio/mp4a-latm',
  'audio/aac',
  'audio/x-aac',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/webm',
  'audio/ogg',
  'audio/opus',
  'audio/flac',
  'audio/x-flac',
  'video/mp4',
];

/**
 * Map a Drive MIME type to one the transcription model accepts, or null when
 * the format isn't supported. Drive's `audio/x-m4a` (Voice Memos) and a few
 * other aliases aren't on Gemini's list, so they're stored as their standard
 * names. `video/mp4` covers screen and camera recordings whose audio track
 * is what we want.
 */
export function normalizeAudioMimeType(mimeType: string): string | null {
  const type = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  switch (type) {
    case 'audio/x-m4a':
    case 'audio/m4a':
    case 'audio/mp4':
    case 'audio/mp4a-latm':
    case 'video/mp4':
      return 'audio/mp4';
    case 'audio/aac':
    case 'audio/x-aac':
      return 'audio/aac';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'audio/mpeg';
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return 'audio/wav';
    case 'audio/webm':
      return 'audio/webm';
    case 'audio/ogg':
    case 'audio/opus':
      return 'audio/ogg';
    case 'audio/flac':
    case 'audio/x-flac':
      return 'audio/flac';
    default:
      return null;
  }
}

/** Recording label from a Drive file name: `New Recording 12.m4a` → `New Recording 12`. */
export function labelFromFileName(name: string, maxLength: number): string {
  const stem = name.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim();
  return stem.slice(0, maxLength).trim();
}

/** True when this build has what the Picker needs (absent in emulator/CI builds). */
export function isDriveImportConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID &&
    import.meta.env.VITE_FIREBASE_API_KEY &&
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  );
}

export interface PickedDriveFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
}

// --- Minimal typings for the two Google scripts (no @types packages) -------

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}
interface PickerDoc {
  id: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number | string;
}
interface PickerResponse {
  action: string;
  docs?: PickerDoc[];
}
interface PickerView {
  setMimeTypes: (types: string) => PickerView;
  setIncludeFolders: (include: boolean) => PickerView;
  setSelectFolderEnabled: (enabled: boolean) => PickerView;
  setEnableDrives: (enabled: boolean) => PickerView;
}
interface PickerBuilder {
  addView: (view: PickerView) => PickerBuilder;
  setOAuthToken: (token: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setAppId: (appId: string) => PickerBuilder;
  setOrigin: (origin: string) => PickerBuilder;
  setTitle: (title: string) => PickerBuilder;
  setCallback: (cb: (data: PickerResponse) => void) => PickerBuilder;
  enableFeature: (feature: string) => PickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
}
interface GoogleNamespace {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        hint?: string;
        hosted_domain?: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type: string; message?: string }) => void;
      }) => TokenClient;
    };
  };
  picker: {
    DocsView: new (viewId?: string) => PickerView;
    PickerBuilder: new () => PickerBuilder;
    ViewId: { DOCS: string };
    Feature: { MULTISELECT_ENABLED: string; SUPPORT_DRIVES: string };
    Action: { PICKED: string; CANCEL: string };
  };
}
interface GapiNamespace {
  load: (lib: string, opts: { callback: () => void; onerror: () => void }) => void;
}
type GoogleWindow = Window & { google?: GoogleNamespace; gapi?: GapiNamespace };

function win(): GoogleWindow {
  return window;
}

// --- Script loading ---------------------------------------------------------

const scriptLoads = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const existing = scriptLoads.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptLoads.delete(src);
      el.remove();
      reject(new Error('Could not reach Google Drive. Check your connection and try again.'));
    };
    document.head.appendChild(el);
  });
  scriptLoads.set(src, promise);
  return promise;
}

let pickerLoad: Promise<void> | null = null;

function loadPickerLibrary(): Promise<void> {
  pickerLoad ??= loadScript(GAPI_SRC).then(
    () =>
      new Promise<void>((resolve, reject) => {
        const gapi = win().gapi;
        if (!gapi) {
          reject(new Error('Google Drive did not load.'));
          return;
        }
        gapi.load('picker', {
          callback: () => resolve(),
          onerror: () => reject(new Error('Google Drive picker did not load.')),
        });
      }),
  );
  pickerLoad.catch(() => {
    pickerLoad = null;
  });
  return pickerLoad;
}

/** Fetch both Google scripts ahead of the click, so the sign-in popup opens
 *  while the click still counts as a user gesture. Safe to call repeatedly. */
export function preloadDrivePicker(): void {
  if (!isDriveImportConfigured()) return;
  void loadScript(GIS_SRC).catch(() => undefined);
  void loadPickerLibrary().catch(() => undefined);
}

// --- Access token -----------------------------------------------------------

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getDriveAccessToken(email: string | null): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  await loadScript(GIS_SRC);
  const google = win().google;
  if (!google) throw new Error('Google sign-in did not load.');
  return new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID ?? '',
      scope: DRIVE_FILE_SCOPE,
      hosted_domain: HOSTED_DOMAIN,
      ...(email ? { hint: email } : {}),
      callback: (response) => {
        if (!response.access_token) {
          reject(
            new Error(response.error_description ?? response.error ?? 'Drive access was denied.'),
          );
          return;
        }
        const ttlSec = Number(response.expires_in ?? 3600);
        cachedToken = { value: response.access_token, expiresAt: Date.now() + ttlSec * 1000 };
        resolve(response.access_token);
      },
      error_callback: (error) => {
        reject(
          new Error(
            error.type === 'popup_closed'
              ? 'The Google sign-in window was closed.'
              : error.type === 'popup_failed_to_open'
                ? 'The Google sign-in window was blocked. Allow pop-ups for this site and try again.'
                : (error.message ?? 'Could not connect to Google Drive.'),
          ),
        );
      },
    });
    client.requestAccessToken({ prompt: '' });
  });
}

// --- Picker -----------------------------------------------------------------

/**
 * Sign in to Drive if needed and open the Picker. Resolves with the chosen
 * files, or an empty list when the user cancels.
 */
export async function pickDriveAudio(email: string | null): Promise<{
  files: PickedDriveFile[];
  accessToken: string;
}> {
  const [accessToken] = await Promise.all([getDriveAccessToken(email), loadPickerLibrary()]);
  const google = win().google;
  if (!google?.picker) throw new Error('Google Drive picker did not load.');
  const { picker } = google;
  const mimeTypes = PICKER_MIME_TYPES.join(',');

  return new Promise((resolve) => {
    const allFiles = new picker.DocsView(picker.ViewId.DOCS)
      .setMimeTypes(mimeTypes)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);
    const sharedDrives = new picker.DocsView(picker.ViewId.DOCS)
      .setMimeTypes(mimeTypes)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setEnableDrives(true);
    new picker.PickerBuilder()
      .addView(allFiles)
      .addView(sharedDrives)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(accessToken)
      .setDeveloperKey(import.meta.env.VITE_FIREBASE_API_KEY)
      .setAppId(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID)
      .setOrigin(window.location.origin)
      .setTitle('Choose recordings to add')
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) {
          const files = (data.docs ?? []).map((doc) => ({
            id: doc.id,
            name: doc.name ?? 'Recording',
            mimeType: doc.mimeType ?? '',
            sizeBytes: doc.sizeBytes == null ? null : Number(doc.sizeBytes),
          }));
          resolve({ files, accessToken });
        } else if (data.action === picker.Action.CANCEL) {
          resolve({ files: [], accessToken });
        }
      })
      .build()
      .setVisible(true);
  });
}

/** Download a picked file's bytes with the Picker's access token. */
export async function downloadDriveFile(fileId: string, accessToken: string): Promise<Blob> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 401) cachedToken = null;
  if (!response.ok) throw new Error(`Could not download from Drive (${String(response.status)}).`);
  return response.blob();
}

/** Duration of an audio blob in whole seconds, or null if the browser can't
 *  read it (display-only metadata; the import goes ahead without it). */
export function measureAudioDuration(blob: Blob, timeoutMs = 10_000): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const finish = (value: number | null) => {
      clearTimeout(timer);
      audio.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () =>
      finish(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
    audio.onerror = () => finish(null);
    audio.src = url;
  });
}
