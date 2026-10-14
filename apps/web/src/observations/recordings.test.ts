import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_UPLOAD_CHUNK_BYTES, type AudioRecordingMeta } from '@ops/shared';

vi.mock('@/lib/firebase', () => ({
  auth: { currentUser: { uid: 'u1' } },
  functionsHttpUrl: () => 'https://fn/uploadAudio',
}));
vi.mock('firebase/auth', () => ({ getIdToken: () => Promise.resolve('id-token') }));

import {
  audioExtension,
  formatRecordingDuration,
  recordingDownloadName,
  recordingTitle,
  uploadObservationAudio,
} from './recordings';

const meta = (overrides: Partial<AudioRecordingMeta> = {}): AudioRecordingMeta => ({
  recordedAt: new Date(2026, 8, 30, 9, 14),
  durationSec: 245,
  label: '',
  ...overrides,
});

describe('recordingTitle', () => {
  it('uses the label when set, else the list position', () => {
    expect(recordingTitle(meta({ label: 'Warm-up' }), 0)).toBe('Warm-up');
    expect(recordingTitle(meta({ label: '   ' }), 1)).toBe('Recording 2');
    expect(recordingTitle(undefined, 2)).toBe('Recording 3');
  });
});

describe('formatRecordingDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatRecordingDuration(245)).toBe('4:05');
    expect(formatRecordingDuration(3729)).toBe('1:02:09');
    expect(formatRecordingDuration(0)).toBe('0:00');
  });

  it('is null when unknown', () => {
    expect(formatRecordingDuration(null)).toBeNull();
    expect(formatRecordingDuration(undefined)).toBeNull();
  });
});

describe('recordingDownloadName', () => {
  it('builds <teacher>-<date>-<title>.<ext> with file-safe characters', () => {
    expect(
      recordingDownloadName({
        observedName: "Jane O'Doe",
        meta: meta(),
        title: 'Period 3: intro',
        mimeType: 'audio/webm;codecs=opus',
      }),
    ).toBe('Jane-O-Doe-2026-09-30-Period-3-intro.webm');
  });

  it('omits an unknown date and maps Safari mp4 to .m4a', () => {
    expect(
      recordingDownloadName({
        observedName: 'Jane Doe',
        meta: undefined,
        title: 'Recording 1',
        mimeType: 'audio/mp4',
      }),
    ).toBe('Jane-Doe-Recording-1.m4a');
  });
});

describe('audioExtension', () => {
  it('matches uploadAudio', () => {
    expect(audioExtension('audio/ogg')).toBe('ogg');
    expect(audioExtension('audio/mpeg')).toBe('mp3');
    expect(audioExtension('')).toBe('webm');
  });
});

describe('uploadObservationAudio', () => {
  const MB = 1024 * 1024;
  const SESSION = 'https://www.googleapis.com/upload/drive/v3/files?upload_id=s1';
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  /** Each request's upload headers and body size, in order. */
  function sent() {
    return fetchMock.mock.calls.map(([, init]) => {
      const headers = init?.headers as Record<string, string>;
      return {
        offset: headers['X-Upload-Offset'],
        session: headers['X-Upload-Session'],
        bytes: (init?.body as Blob).size,
      };
    });
  }
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const incomplete = (received: number) =>
    json({ status: 'incomplete', uploadSession: SESSION, received });

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends a 20 MB recording in pieces and reports progress', async () => {
    const blob = new Blob([new Uint8Array(20 * MB)], { type: 'audio/webm' });
    fetchMock
      .mockResolvedValueOnce(incomplete(8 * MB))
      .mockResolvedValueOnce(incomplete(16 * MB))
      .mockResolvedValueOnce(json({ audioFileId: 'f1' }));
    const progress: number[] = [];

    const result = await uploadObservationAudio({
      observationId: 'obs1',
      blob,
      mimeType: 'audio/webm',
      onProgress: (p) => progress.push(p),
    });

    expect(result).toEqual({ audioFileId: 'f1' });
    expect(AUDIO_UPLOAD_CHUNK_BYTES).toBe(8 * MB);
    expect(sent()).toEqual([
      { offset: '0', session: undefined, bytes: 8 * MB },
      { offset: String(8 * MB), session: SESSION, bytes: 8 * MB },
      { offset: String(16 * MB), session: SESSION, bytes: 4 * MB },
    ]);
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['X-Upload-Total-Bytes']).toBe(String(20 * MB));
    expect(progress).toEqual([0.4, 0.8, 1]);
  });

  it('after a dropped connection, asks where Drive got to and carries on from there', async () => {
    const blob = new Blob([new Uint8Array(20 * MB)], { type: 'audio/webm' });
    fetchMock
      .mockResolvedValueOnce(incomplete(8 * MB))
      // The lid closes: the second piece never gets an answer...
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      // ...but Drive did receive it.
      .mockResolvedValueOnce(incomplete(16 * MB))
      .mockResolvedValueOnce(json({ audioFileId: 'f1' }));

    const upload = uploadObservationAudio({ observationId: 'obs1', blob, mimeType: 'audio/webm' });
    await vi.runAllTimersAsync();

    await expect(upload).resolves.toEqual({ audioFileId: 'f1' });
    expect(sent()).toEqual([
      { offset: '0', session: undefined, bytes: 8 * MB },
      { offset: String(8 * MB), session: SESSION, bytes: 8 * MB },
      { offset: String(8 * MB), session: SESSION, bytes: 0 },
      { offset: String(16 * MB), session: SESSION, bytes: 4 * MB },
    ]);
  });

  it('starts over when the server says the session expired', async () => {
    const blob = new Blob([new Uint8Array(10 * MB)], { type: 'audio/webm' });
    fetchMock
      .mockResolvedValueOnce(incomplete(8 * MB))
      .mockResolvedValueOnce(new Response('expired', { status: 410 }))
      .mockResolvedValueOnce(incomplete(8 * MB))
      .mockResolvedValueOnce(json({ audioFileId: 'f1' }));

    const upload = uploadObservationAudio({ observationId: 'obs1', blob, mimeType: 'audio/webm' });
    await vi.runAllTimersAsync();

    await expect(upload).resolves.toEqual({ audioFileId: 'f1' });
    expect(sent().map((r) => r.offset)).toEqual(['0', String(8 * MB), '0', String(8 * MB)]);
    expect(sent()[2]?.session).toBeUndefined();
  });

  it('gives up with a plain message when the server stays unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const upload = uploadObservationAudio({
      observationId: 'obs1',
      blob: new Blob(['x']),
      mimeType: 'audio/webm',
    });
    const assertion = expect(upload).rejects.toThrow(/Couldn't reach the server/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('does not retry a refusal such as a finalized observation', async () => {
    fetchMock.mockResolvedValue(new Response('Observation is not in Draft state', { status: 409 }));
    await expect(
      uploadObservationAudio({
        observationId: 'obs1',
        blob: new Blob(['x']),
        mimeType: 'audio/webm',
      }),
    ).rejects.toThrow(/409/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses audio over the size cap before sending anything', async () => {
    const blob = { size: 201 * MB } as Blob;
    await expect(
      uploadObservationAudio({ observationId: 'obs1', blob, mimeType: 'audio/webm' }),
    ).rejects.toThrow(/too large/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
